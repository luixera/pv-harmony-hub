"""Aparelho Android na nuvem (VMOS Cloud) para a estação de eletropostos — só biblioteca padrão.

O coletor (coletor_tela.py) fala `adb` com o aparelho. No VMOS o ADB chega por um túnel SSH:
a Open API devolve o comando do túnel (`ssh ... -L <porta local>:adb-proxy:<porta> -N`) e a
chave de conexão; aqui o túnel é aberto em segundo plano numa porta local livre, vive enquanto o
processo da coleta vive e é encerrado no fim (cada ciclo abre o seu — leva poucos segundos).

Configuração (variáveis de ambiente ou config/vmos.env, linhas CHAVE=valor):
  VMOS_ACCESS_KEY, VMOS_SECRET_KEY   chaves da Open API (segredos: nunca no repositório nem no chat)
  VMOS_PAD_CODE                      código do aparelho (ex.: ACP25091462JLVCR)
  VMOS_GPS_LAT, VMOS_GPS_LNG         posição fixa do aparelho (padrão: Rio Preto Shopping)
  VMOS_API                           (opcional) https://api.vmoscloud.com

Uso manual:
  py -3 vmos.py estado     -> padDetails do aparelho (rodando? online?)
  py -3 vmos.py adb        -> abre o túnel, conecta o adb e mostra modelo/tela
  py -3 vmos.py gps        -> injeta a posição configurada
  py -3 vmos.py reiniciar  -> pede o reinício pela API
"""
import atexit, hashlib, json, os, re, shlex, socket, stat, subprocess, sys, time, urllib.error, urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent
CFG = BASE / "config" / "vmos.env"
DADOS = BASE / "dados"
_TUNEL = {"proc": None, "porta": None}


def config():
    out = {}
    if CFG.exists():
        for linha in CFG.read_text(encoding="utf-8-sig").splitlines():
            linha = linha.strip()
            if linha and not linha.startswith("#") and "=" in linha:
                k, v = linha.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    for k in ("VMOS_ACCESS_KEY", "VMOS_SECRET_KEY", "VMOS_PAD_CODE", "VMOS_GPS_LAT", "VMOS_GPS_LNG", "VMOS_API"):
        if os.environ.get(k):
            out[k] = os.environ[k]
    for k in ("VMOS_ACCESS_KEY", "VMOS_SECRET_KEY", "VMOS_PAD_CODE"):
        if not out.get(k):
            raise RuntimeError(f"falta {k} (variável de ambiente ou config/vmos.env)")
    out.setdefault("VMOS_API", "https://api.vmoscloud.com")
    out.setdefault("VMOS_GPS_LAT", "-20.8346")
    out.setdefault("VMOS_GPS_LNG", "-49.398")
    return out


# ── Open API (assinatura V2: X-Sign = sha256(SK + timestamp + caminho + corpo)) ──────────────
def api(acao, corpo=None, assinar_corpo=True, timeout=30):
    """POST em /vcpcloud/api/padApi/<acao>; devolve `data` ou levanta com o code/msg da API."""
    cfg = config()
    caminho = f"/vcpcloud/api/padApi/{acao}"
    texto = json.dumps(corpo, separators=(",", ":"), ensure_ascii=False) if corpo is not None else ""
    ts = str(int(time.time()))
    sign = hashlib.sha256((cfg["VMOS_SECRET_KEY"] + ts + caminho + (texto if assinar_corpo else "")).encode("utf-8")).hexdigest()
    req = urllib.request.Request(cfg["VMOS_API"].rstrip("/") + caminho, data=texto.encode("utf-8"), method="POST",
                                 headers={"X-Access-Key": cfg["VMOS_ACCESS_KEY"], "X-Timestamp": ts,
                                          "X-Sign": sign, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            resp = json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"VMOS {acao}: HTTP {e.code} {e.read().decode('utf-8', 'replace')[:200]}") from None
    if resp.get("code") != 200:
        raise RuntimeError(f"VMOS {acao}: code {resp.get('code')} {str(resp.get('msg'))[:150]}")
    return resp.get("data")


def estado():
    """{padStatus, online, ...} do aparelho (padStatus 10 = rodando)."""
    pad = config()["VMOS_PAD_CODE"]
    d = api("padDetails", {"padCodes": [pad], "rows": 10}) or {}   # /padDetail (singular) dá 404
    for p in d.get("pageData") or []:
        if p.get("padCode") == pad:
            return p
    return {}


def reiniciar():
    pad = config()["VMOS_PAD_CODE"]
    fechar_tunel()
    return api("restart", {"padCodes": [pad]})


def gps(lat=None, lng=None):
    cfg = config()
    return api("gpsInjectInfo", {"padCodes": [cfg["VMOS_PAD_CODE"]],
                                 "latitude": float(lat if lat is not None else cfg["VMOS_GPS_LAT"]),
                                 "longitude": float(lng if lng is not None else cfg["VMOS_GPS_LNG"])})


# ── ADB pelo túnel SSH ────────────────────────────────────────────────────────────────────────
def dados_adb(expira_min=10080):
    """Comando do túnel + chave. Liga o ADB do aparelho se a resposta vier incompleta."""
    pad = config()["VMOS_PAD_CODE"]
    d = api("adb", {"padCode": pad, "enable": True, "expireMinutes": expira_min}) or {}
    if not (d.get("command") and d.get("key")):
        api("openOnlineAdb", {"padCodes": [pad], "openStatus": 1})
        time.sleep(5)
        d = api("adb", {"padCode": pad, "enable": True, "expireMinutes": expira_min}) or {}
    if not (d.get("command") and d.get("key")):
        raise RuntimeError("VMOS não devolveu o comando/chave do ADB")
    return d


def _porta_livre():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _porta_aberta(porta):
    try:
        with socket.create_connection(("127.0.0.1", porta), timeout=1):
            return True
    except OSError:
        return False


def _askpass(chave):
    """Programa que o ssh chama para pedir a "senha" do túnel: devolve a chave de conexão.
    O arquivo fica em dados/ com permissão só do dono e some no fim do processo."""
    DADOS.mkdir(exist_ok=True)
    sufixo = ".cmd" if os.name == "nt" else ".sh"
    arq = DADOS / f"vmos_askpass{sufixo}"
    segredo = DADOS / "vmos_chave.txt"
    segredo.write_text(chave, encoding="utf-8")
    if os.name == "nt":
        arq.write_text(f'@type "{segredo}"\r\n', encoding="utf-8")
    else:
        arq.write_text(f'#!/bin/sh\ncat "{segredo}"\n', encoding="utf-8")
    for f in (arq, segredo):
        try:
            os.chmod(f, stat.S_IRUSR | stat.S_IWUSR | (stat.S_IXUSR if f == arq else 0))
        except OSError:
            pass
    atexit.register(lambda: [p.unlink(missing_ok=True) for p in (arq, segredo)])
    return arq


def abrir_tunel():
    """Abre o túnel SSH do ADB numa porta local livre e devolve a porta."""
    if _TUNEL["proc"] and _TUNEL["proc"].poll() is None and _porta_aberta(_TUNEL["porta"]):
        return _TUNEL["porta"]
    d = dados_adb()
    partes = shlex.split(d["command"])
    m = next((i for i, p in enumerate(partes) if p == "-L"), None)
    if m is None or m + 1 >= len(partes):
        raise RuntimeError(f"comando do túnel sem -L: {d['command'][:120]}")
    destino = partes[m + 1].split(":", 1)[1]          # adb-proxy:<porta remota>
    porta = _porta_livre()
    partes[m + 1] = f"{porta}:{destino}"
    partes = [p for p in partes if p not in ("-Nf", "-fN", "-f")]
    if "-N" not in partes:
        partes.append("-N")
    known = DADOS / "vmos_known_hosts"
    extra = ["-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3",
             "-o", "StrictHostKeyChecking=accept-new", "-o", f"UserKnownHostsFile={known}",
             "-o", "PreferredAuthentications=password,keyboard-interactive", "-o", "NumberOfPasswordPrompts=1"]
    partes = [partes[0]] + extra + partes[1:]
    env = dict(os.environ, SSH_ASKPASS=str(_askpass(d["key"])), SSH_ASKPASS_REQUIRE="force", DISPLAY=os.environ.get("DISPLAY", ":0"))
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    proc = subprocess.Popen(partes, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=subprocess.PIPE, creationflags=flags)
    fim = time.time() + 25
    while time.time() < fim:
        if proc.poll() is not None:
            erro = (proc.stderr.read() or b"").decode("utf-8", "replace").strip()[-200:]
            raise RuntimeError(f"túnel SSH do VMOS caiu ao abrir: {erro}")
        if _porta_aberta(porta):
            _TUNEL.update(proc=proc, porta=porta)
            atexit.register(fechar_tunel)
            return porta
        time.sleep(0.5)
    proc.kill()
    raise RuntimeError("túnel SSH do VMOS não abriu em 25 s")


def fechar_tunel():
    p = _TUNEL.get("proc")
    if p and p.poll() is None:
        p.terminate()
        try:
            p.wait(5)
        except Exception:
            p.kill()
    _TUNEL.update(proc=None, porta=None)


def alvo_adb():
    """Endereço que o adb usa (127.0.0.1:<porta do túnel>), com o túnel aberto."""
    return f"127.0.0.1:{abrir_tunel()}"


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "estado"
    if cmd == "estado":
        print(json.dumps(estado(), ensure_ascii=False, indent=1))
    elif cmd == "gps":
        print("gps:", gps())
    elif cmd == "reiniciar":
        print("restart:", reiniciar())
    elif cmd == "adb":
        alvo = alvo_adb()
        import coletor_tela as c
        c.ALVO = alvo
        c.conectar_adb()
        print("conectado em", alvo)
        print(c.adb("shell", "getprop ro.product.model; getprop ro.build.version.release; wm size; wm density"))
        fechar_tunel()
