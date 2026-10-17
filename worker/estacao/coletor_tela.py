"""Lê a disponibilidade em apps de celular rodando no BlueStacks (ATM EVs, Cury...).
Só automatiza o uso normal do app: abre a tela, lê os textos visíveis (uiautomator) e grava
no GD Manager. Nunca digita senha, nunca guarda dado de motorista.
Uso:
  py -3 coletor_tela.py ver              -> mostra os textos da tela atual (calibração rápida)
  py -3 coletor_tela.py descobrir NOME   -> salva a tela atual (xml + png + txt) em capturas/
  py -3 coletor_tela.py ensaiar [fonte]  -> executa os roteiros e mostra as leituras SEM gravar
  py -3 coletor_tela.py coletar          -> executa os roteiros de config/telas.json e grava
"""
import json, os, pathlib, re, subprocess, sys, time, datetime as dt, xml.etree.ElementTree as ET
from pathlib import Path
from comum import BASE, linha, gravar
import estacao

CAPT = BASE / "capturas"
SEM_JANELA = getattr(subprocess, "CREATE_NO_WINDOW", 0)   # adb/taskkill sem piscar console na tela
CFG = BASE / "config" / "telas.json"


def achar_adb():
    """platform-tools oficial, instalado por instalar.ps1 em ferramentas\\platform-tools (dentro
    desta pasta). O HD-Adb.exe do BlueStacks é 1.0.36 e não fala com o Android 11 da instância
    ('error: closed'), por isso não serve de reserva. Os outros caminhos são reservas."""
    if os.name != "nt":
        import shutil
        for c in (BASE / "ferramentas" / "platform-tools" / "adb", shutil.which("adb")):
            if c and pathlib.Path(c).exists():
                return str(c)
        return "adb"
    candidatos = [BASE / "ferramentas" / "platform-tools" / "adb.exe"]
    for raiz in (os.environ.get("LOCALAPPDATA"), os.environ.get("USERPROFILE"), str(Path.home()),
                 r"C:\Users\luiza", r"C:\Users\luiza\AppData\Local"):
        if not raiz:
            continue
        candidatos.append(Path(raiz) / "Android/Sdk/platform-tools/adb.exe")
        candidatos.append(Path(raiz) / "AppData/Local/Android/Sdk/platform-tools/adb.exe")
    for c in candidatos:
        if c.exists():
            return str(c)
    return "adb"


ADB = achar_adb()
ANDROID = (estacao.config().get("ANDROID") or "bluestacks").strip().lower()   # bluestacks | vmos
ALVO = estacao.config().get("ADB_ALVO") or "127.0.0.1:5555"


class AndroidTravado(RuntimeError):
    """O Android dentro do BlueStacks parou de responder (device offline, shell em timeout,
    conexão recusada). Visto em 16/10/2026: HD-Player aberto, Android travado; só reiniciar
    o BlueStacks resolve. O coletor reinicia sozinho uma vez por ciclo e repete."""


SINAIS_TRAVADO = ("device offline", "not found", "error: closed", "no devices", "cannot connect",
                  "actively refused", "connection reset", "protocol fault")


def adb(*args, binario=False, timeout=30):
    try:
        r = subprocess.run([ADB, "-s", ALVO, *args], capture_output=True, timeout=timeout, creationflags=SEM_JANELA)
    except FileNotFoundError:
        raise RuntimeError(f"adb não encontrado em {ADB!r} (rode instalar.ps1)") from None
    except subprocess.TimeoutExpired:
        raise AndroidTravado(f"adb {' '.join(map(str, args[:3]))}: sem resposta em {timeout} s") from None
    if r.returncode != 0:
        erro = (r.stderr or r.stdout).decode("utf-8", "replace").strip()[:200]
        if any(x in erro.lower() for x in SINAIS_TRAVADO):
            raise AndroidTravado(f"adb {' '.join(map(str, args[:3]))}: {erro}")
        raise RuntimeError(f"adb {' '.join(map(str, args[:3]))}: {erro}")
    return r.stdout if binario else r.stdout.decode("utf-8", "replace")


def memoria_do_pc():
    """(MB de RAM livre, MB de memória comprometível livre) do Windows, ou (None, None).
    Visto em 16/10/2026: com o PC quase sem memória (Chrome, WSL, Steam…), o Android do
    BlueStacks congela e reiniciá-lo não adianta. O número vai junto do erro, para a aba
    Coleta mostrar a causa real."""
    if os.name != "nt":
        try:
            info = {}
            for l in pathlib.Path("/proc/meminfo").read_text().splitlines():
                k, v = l.split(":", 1); info[k] = int(v.split()[0]) // 1024
            return info.get("MemAvailable"), info.get("CommitLimit", 0) - info.get("Committed_AS", 0)
        except Exception:
            return None, None
    try:
        import ctypes
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
        m = MEMORYSTATUSEX(); m.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m)):
            return None, None
        return m.ullAvailPhys // 2**20, m.ullAvailPageFile // 2**20
    except Exception:
        return None, None


def nota_memoria():
    """Texto curto quando o PC está com pouca memória (RAM < 1 GB ou comprometível < 4 GB)."""
    livre, comprometivel = memoria_do_pc()
    if livre is None:
        return ""
    if os.name != "nt":   # Linux promete mais memória do que tem: o "comprometível" negativo é normal
        return f" [servidor com pouca memória: {livre} MB disponíveis]" if livre < 512 else ""
    if livre < 1024 or comprometivel < 4096:
        return f" [PC com pouca memória: {livre} MB de RAM livre, {comprometivel} MB comprometíveis — feche programas]"
    return ""


def adb_ligado_no_bluestacks():
    """Lê bst.enable_adb_access do bluestacks.conf (None se não der para ler)."""
    try:
        conf = pathlib.Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "BlueStacks_nxt" / "bluestacks.conf"
        for linha in conf.read_text(encoding="utf-8", errors="replace").splitlines():
            if linha.startswith("bst.enable_adb_access="):
                return linha.split("=", 1)[1].strip().strip('"') == "1"
    except Exception:
        pass
    return None


def conectar_adb():
    """adb connect no BlueStacks. Erro claro (e curto) quando ele não responde."""
    global ALVO
    if ANDROID == "vmos":
        import vmos
        try:
            ALVO = vmos.alvo_adb()   # sobe/renova o túnel SSH do ADB e devolve 127.0.0.1:porta
        except Exception as e:
            raise AndroidTravado(f"túnel ADB do VMOS indisponível: {e}") from None
    if adb_ligado_no_bluestacks() is False:
        raise RuntimeError("ADB desligado no BlueStacks: ligue 'Android Debug Bridge' em Configurações > Avançado "
                           "(ou bst.enable_adb_access=\"1\" no bluestacks.conf, com o BlueStacks fechado)")
    try:
        r = subprocess.run([ADB, "connect", ALVO], capture_output=True, timeout=30, creationflags=SEM_JANELA)
    except FileNotFoundError:
        raise RuntimeError(f"adb não encontrado em {ADB!r} (rode instalar.ps1)") from None
    except subprocess.TimeoutExpired:
        raise AndroidTravado(f"adb connect {ALVO}: sem resposta em 30 s") from None
    saida = (r.stdout + r.stderr).decode("utf-8", "replace").strip()
    if "connected" not in saida:
        raise AndroidTravado(f"BlueStacks não respondeu em {ALVO} ({saida[:120]}): fechado ou travado")
    try:
        ok = adb("shell", "echo", "ok", timeout=20)
    except RuntimeError as e:
        raise AndroidTravado(f"adb conectou mas o Android não responde ({e})") from None
    if "ok" not in ok:
        raise AndroidTravado(f"shell do BlueStacks estranho: {ok[:80]!r}")


ULTIMO_XML = ""      # último dump (cada dump leva ~2,5 s; reaproveitado quando a tela não mudou)
XML_VALIDO = False   # True entre um dump e a próxima ação de entrada (toque, rolagem, tecla, abrir)
CACHE_LISTA = ""     # último dump de uma lista em que tocar_texto_rolando achou o alvo
ORDEM_LISTA = []     # nomes na ordem em que o app lista (do alvo em execução): rola na direção certa
PASSO_LISTA = 160    # altura de um item da lista, em px de referência (do alvo em execução)
TELA_REF = (900, 1600)   # resolução em que o telas.json foi calibrado (BlueStacks)
_TELA = None


def tela():
    """(largura, altura) do aparelho, pelo `wm size` (o Override vence o Physical)."""
    global _TELA
    if _TELA is None:
        try:
            saida = adb("shell", "wm", "size", timeout=15)
            m = re.findall(r"(\d+)x(\d+)", saida)
            _TELA = (int(m[-1][0]), int(m[-1][1])) if m else TELA_REF
        except Exception:
            _TELA = TELA_REF
    return _TELA


def px(x, y):
    """Coordenada calibrada em TELA_REF -> pixels do aparelho atual."""
    w, h = tela()
    return str(int(round(x * w / TELA_REF[0]))), str(int(round(y * h / TELA_REF[1])))


def rolar_y(y1, y2, ms):
    """Rolagem vertical no meio da tela, com y em px de referência."""
    xa, ya = px(450, y1)
    _, yb = px(450, y2)
    entrada("swipe", xa, ya, xa, yb, str(ms))


def botao_sem_texto(xml, filtro):
    """Centro do primeiro nó clicável sem texto que passa no filtro(cx, cy, w, h)."""
    import xml.etree.ElementTree as ET
    w, h = tela()
    try:
        for n in ET.fromstring(xml).iter("node"):
            if n.get("clickable") == "true" and not (n.get("text") or "").strip() and n.get("bounds"):
                cx, cy = centro(n.get("bounds"))
                if filtro(cx, cy, w, h):
                    return cx, cy
    except ET.ParseError:
        pass
    return None
DEPURAR = bool(os.environ.get("ELETROPOSTOS_DEPURAR"))


def tela_atual():
    """Textos da tela sem dump novo quando nada mudou desde o último."""
    return textos(ULTIMO_XML if XML_VALIDO else tela_xml())


def entrada(*args):
    """Ação de entrada (tap, swipe, keyevent, text): invalida o dump guardado.
    Rolagem, tecla e texto também invalidam o cache da lista (só um toque o preserva)."""
    global XML_VALIDO, CACHE_LISTA
    XML_VALIDO = False
    if args and args[0] in ("swipe", "keyevent", "text"):
        CACHE_LISTA = ""
    return adb("shell", "input", *args)


BLUESTACKS_EXE = estacao.config().get("BLUESTACKS_EXE") or r"C:\Program Files\BlueStacks_nxt\HD-Player.exe"
BLUESTACKS_INSTANCIA = estacao.config().get("BLUESTACKS_INSTANCIA") or "Rvc64"


def reiniciar_android(espera_boot=30):
    """Reinicia o Android da estação: BlueStacks no PC ou o aparelho VMOS na nuvem (pela API)."""
    if ANDROID == "vmos":
        import vmos
        global CACHE_LISTA, XML_VALIDO, ALVO
        CACHE_LISTA = ""; XML_VALIDO = False
        vmos.reiniciar()
        fim = time.time() + 300
        while time.time() < fim:
            time.sleep(15)
            try:
                ALVO = vmos.alvo_adb()          # o túnel pode ter mudado de porta
                conectar_adb()
                if adb("shell", "getprop", "sys.boot_completed", timeout=15).strip() == "1":
                    break
            except Exception:
                continue
        else:
            raise RuntimeError("aparelho VMOS não voltou em 5 min depois do reinício")
        time.sleep(espera_boot)
        return
    reiniciar_bluestacks(espera_boot)


def reiniciar_bluestacks(espera_boot=30):
    """Fecha e reabre o BlueStacks e espera o Android terminar de subir (sys.boot_completed=1).
    Usado quando o Android trava (AndroidTravado) e quando o GPS da instância para (a ATM
    lista tudo com 0.00 km): nos dois casos só o reinício resolve."""
    global CACHE_LISTA, XML_VALIDO
    CACHE_LISTA = ""; XML_VALIDO = False
    subprocess.run(["taskkill", "/IM", "HD-Player.exe"], capture_output=True, timeout=30, creationflags=SEM_JANELA)
    time.sleep(8)
    subprocess.run(["taskkill", "/IM", "HD-Player.exe", "/F"], capture_output=True, timeout=30, creationflags=SEM_JANELA)
    time.sleep(3)
    subprocess.run([ADB, "kill-server"], capture_output=True, timeout=30, creationflags=SEM_JANELA)
    subprocess.Popen([BLUESTACKS_EXE, "--instance", BLUESTACKS_INSTANCIA],
                     creationflags=getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    fim = time.time() + 240
    while time.time() < fim:
        time.sleep(10)
        try:
            conectar_adb()
            if adb("shell", "getprop", "sys.boot_completed", timeout=15).strip() == "1":
                break
        except Exception:
            continue
    else:
        raise RuntimeError("BlueStacks não voltou em 4 min depois do reinício")
    time.sleep(espera_boot)


def tela_xml(tentativas=4):
    """XML da tela num só comando (uiautomator dump /dev/tty). O dump falha quando a tela ainda
    anima (app abrindo, mapa carregando): repete algumas vezes até vir uma hierarquia com texto."""
    global ULTIMO_XML, XML_VALIDO
    xml = ""
    for _ in range(tentativas):
        bruto = adb("exec-out", "uiautomator", "dump", "/dev/tty")
        xml = bruto[bruto.find("<?xml"):bruto.rfind("</hierarchy>") + len("</hierarchy>")] if "</hierarchy>" in bruto else ""
        if "<hierarchy" in xml and 'text="' in xml and textos(xml):
            ULTIMO_XML, XML_VALIDO = xml, True
            return xml
        time.sleep(2)
    ULTIMO_XML, XML_VALIDO = xml, bool(xml)
    return xml


def textos(xml):
    """Lista (texto, bounds) de todos os elementos visíveis com texto ou descrição, na ordem da tela."""
    out = []
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return out
    for n in root.iter("node"):
        t = (n.get("text") or n.get("content-desc") or "").strip()
        if t:
            out.append((t, n.get("bounds")))
    return out


def salvar_captura(nome):
    CAPT.mkdir(exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    xml = tela_xml()
    (CAPT / f"{stamp}_{nome}.xml").write_text(xml, encoding="utf-8")
    (CAPT / f"{stamp}_{nome}.png").write_bytes(adb("exec-out", "screencap", "-p", binario=True))
    (CAPT / f"{stamp}_{nome}.txt").write_text("\n".join(f"{t}\t{b}" for t, b in textos(xml)), encoding="utf-8")
    return stamp


def centro(bounds):
    x1, y1, x2, y2 = map(int, re.findall(r"-?\d+", bounds))
    return (x1 + x2) // 2, (y1 + y2) // 2


def executar_passo(p):
    tipo = p["tipo"]
    global CACHE_LISTA, XML_VALIDO
    t0 = time.time()
    if tipo == "abrir":
        CACHE_LISTA = ""; XML_VALIDO = False
        if p.get("activity"):   # reinício quente: só a activity, com a pilha limpa (processo continua carregado)
            adb("shell", "am", "start", "--activity-clear-task", "-n", f"{p['pacote']}/{p['activity']}")
        else:                   # frio: mata o app e abre de novo
            adb("shell", "am", "force-stop", p["pacote"]); time.sleep(1)
            adb("shell", "monkey", "-p", p["pacote"], "-c", "android.intent.category.LAUNCHER", "1")
    elif tipo == "toque":
        entrada("tap", *px(p["x"], p["y"]))
    elif tipo == "deslizar":
        entrada("swipe", *px(p["x1"], p["y1"]), *px(p["x2"], p["y2"]), str(p.get("ms", 400)))
    elif tipo == "voltar":
        entrada("keyevent", "4")
    elif tipo == "digitar":      # texto num campo já focado (sem acento: o input text não aceita)
        entrada("text", p["texto"].replace(" ", "%s"))
    elif tipo == "fechar_ficha":   # X da ficha da ATM, só se a ficha estiver aberta
        itens = tela_atual()
        if any("Clique na tomada" in t for t, _ in itens):
            selo = next((b for t, b in itens if re.match(r"^\d+[.,]\d+ km$", t.strip())), None)
            alvo_x = None
            if selo:
                kx, ky = centro(selo)
                alvo_x = botao_sem_texto(ULTIMO_XML, lambda cx, cy, w, h: abs(cy - ky) < h * 0.05 and cx > kx)
            if alvo_x:
                entrada("tap", *map(str, alvo_x))
            else:
                entrada("tap", *px(p.get("x", 852), p.get("y", 781)))
            time.sleep(1)
    elif tipo == "ir_ao_mapa":     # seta "voltar" da busca da ATM até o campo "Pesquisar" aparecer
        for _ in range(3):
            if any(t == "Pesquisar" for t, _ in tela_atual()):
                break
            seta = botao_sem_texto(ULTIMO_XML if XML_VALIDO else tela_xml(), lambda cx, cy, w, h: cx < w * 0.15 and cy < h * 0.12)
            entrada("tap", *(map(str, seta) if seta else px(p.get("x", 60), p.get("y", 96)))); time.sleep(1.2)
    elif tipo == "tocar_ate":     # toca no texto até outro texto aparecer, fechando avisos no caminho
        # Ex.: Cury — tocar "Lista" até ver "Locais de Recarga"; o aviso de boas-vindas
        # ("Encerrar") às vezes surge logo depois de abrir e engole o toque.
        alvo_txt, aparecer = p["texto"].lower(), p["aparecer"].lower()
        fechar = [f.lower() for f in p.get("fechar", [])]
        for _ in range(p.get("tentativas", 4)):
            itens = textos(tela_xml())
            if DEPURAR:
                print("        tocar_ate vê:", [t.replace(chr(10), " / ")[:40] for t, _ in itens][:6], flush=True)
            if any(aparecer in t.lower() for t, _ in itens):
                break
            aviso = next((b for t, b in itens if any(f == t.strip().lower() for f in fechar)), None)
            if aviso:
                entrada("tap", *map(str, centro(aviso))); time.sleep(1.2)
                continue
            botao = next((b for t, b in itens if alvo_txt in t.lower()), None)
            if botao:
                entrada("tap", *map(str, centro(botao)))
            fim = time.time() + p.get("ate", 8)
            time.sleep(0.8)
            while time.time() < fim:
                if any(aparecer in t.lower() for t, _ in textos(tela_xml())):
                    break
                time.sleep(0.8)
            else:
                continue
            break
        else:
            raise RuntimeError(f"'{p['aparecer']}' não apareceu depois de tocar '{p['texto']}' {p.get('tentativas', 4)} vezes")
    elif tipo == "tocar_texto":   # toca no centro do primeiro elemento cujo texto contém o valor
        for t, b in tela_atual():
            if p["texto"].lower() in t.lower():
                entrada("tap", *map(str, centro(b))); CACHE_LISTA = ""; break
        else:
            if not p.get("opcional"):
                raise RuntimeError(f"texto '{p['texto']}' não está na tela")
    elif tipo == "tocar_texto_rolando":  # rola a lista até achar o texto e toca nele
        # Com ORDEM_LISTA (nomes na ordem do app) sabe para que lado e quanto rolar; sem ela, desce e,
        # se não achar, volta ao topo e desce de novo.
        alvo_txt = p["texto"].lower()
        def _no_alvo(xml):
            """Bounds do item; None se não está na tela OU está cortado nas bordas (o toque cairia no vizinho)."""
            _, h = tela()
            for t, b in textos(xml):
                if alvo_txt in t.lower() and not re.search(r", [0-9]+[.][0-9]+ km, ", t):
                    y1, y2 = map(int, re.findall(r"-?\d+", b)[1::2])
                    if y2 >= h * 0.985 or y1 <= h * 0.03:
                        return None            # cortado: rola e tenta de novo
                    return b
            return None
        def _visiveis(xml):
            out = []
            for t, b in textos(xml):
                tl = t.strip().lower()
                for i, nome in enumerate(ORDEM_LISTA):
                    if tl == nome.lower() or tl.startswith(nome.lower() + "\n"):
                        out.append((i, centro(b)[1])); break
            return out
        idx = next((i for i, n in enumerate(ORDEM_LISTA) if alvo_txt in n.lower()), None)
        achou = False
        xml = CACHE_LISTA if CACHE_LISTA else None      # a lista não mudou desde o último toque? poupa um dump
        for tentativa in range(p.get("rolagens", 14)):
            if xml is None:
                xml = ULTIMO_XML if XML_VALIDO else tela_xml()
            b = _no_alvo(xml)
            if b:
                entrada("tap", *map(str, centro(b))); CACHE_LISTA = xml; achou = True; break
            vis = _visiveis(xml) if idx is not None else []
            if vis:
                menor, maior = min(i for i, _ in vis), max(i for i, _ in vis)
                if idx > maior:
                    desloc = min((idx - maior) * PASSO_LISTA + PASSO_LISTA // 2, 900)
                    rolar_y(1250, 1250 - desloc, 400)
                elif idx < menor:
                    desloc = min((menor - idx) * PASSO_LISTA + PASSO_LISTA // 2, 900)
                    rolar_y(400, 400 + desloc, 400)
                else:   # está entre os visíveis mas o nó não casou: rola um pouco
                    rolar_y(1000, 800, 300)
            elif tentativa < p.get("rolagens", 14) // 2:
                rolar_y(1200, 750, 500)
            else:
                for _ in range(8):   # não achou descendo: volta ao topo e desce de novo
                    rolar_y(500, 1300, 250)
            time.sleep(1.2)
            xml = None
        if not achou:
            CACHE_LISTA = ""
            raise RuntimeError(f"texto '{p['texto']}' não apareceu na lista")
    elif tipo == "esperar_texto":  # espera o texto aparecer (apps que carregam da rede)
        fim = time.time() + p.get("ate", 30)
        if not (XML_VALIDO and any(p["texto"].lower() in t.lower() for t, _ in textos(ULTIMO_XML))):
            time.sleep(p.get("antes", 0.5))
            while time.time() < fim:
                if any(p["texto"].lower() in t.lower() for t, _ in textos(tela_xml())):
                    break
                time.sleep(1)
            else:
                if not p.get("opcional"):
                    raise RuntimeError(f"'{p['texto']}' não apareceu em {p.get('ate', 30)} s")
    time.sleep(p.get("espera", 2))
    if DEPURAR:
        print(f"      [{time.time() - t0:4.1f} s] {tipo} {p.get('texto', p.get('pacote', ''))}", flush=True)


def ler(regra, itens):
    """regra: {local_id, local_nome, conector, potencia_kw, lat, lng, ancora, regex}
    Procura o primeiro texto que casa com 'ancora' e, a partir dele, o primeiro que casa com 'regex' (status)."""
    achou = regra.get("ancora") is None
    for t, _ in itens:
        if not achou:
            achou = re.search(regra["ancora"], t, re.I) is not None
            continue
        m = re.search(regra["regex"], t, re.I)
        if m:
            return m.group(1) if m.groups() else m.group(0)
    return None


def config_remota():
    """Periodicidade e cidades definidas na página do GD (/painel › Eletropostos), pela RPC
    eletropostos_coleta_config(). Formato:
      {"faixas": [{"ate_kw": 22, "intervalo_min": 16}, {"ate_kw": null, "intervalo_min": 8}],
       "cidades": ["São José do Rio Preto", ...],
       "fora": [{"fonte": "atm", "local_fonte": "..."}]}   # locais de cidades NÃO monitoradas
    None quando a RPC não existe ou falha: vale o que está no telas.json."""
    try:
        r = estacao.rpc("eletropostos_coleta_config")
        return r if isinstance(r, dict) and r.get("faixas") else None
    except Exception:
        return None


def aplicar_config_remota(cfg, remota, ciclo_min):
    """Reescreve, em memória, intervalo/grupo de cada roteiro pela faixa de potência e marca
    para pular os locais de cidades fora do monitoramento. Devolve um resumo curto."""
    faixas = sorted(remota.get("faixas") or [], key=lambda f: (f.get("ate_kw") is None, f.get("ate_kw") or 0))
    fora = {(f.get("fonte"), f.get("local_fonte")) for f in remota.get("fora") or []}
    def intervalo_de(kw):
        for f in faixas:
            if f.get("ate_kw") is None or kw <= float(f["ate_kw"]):
                return int(f.get("intervalo_min") or ciclo_min)
        return ciclo_min
    contas = {}
    for alvo in cfg["alvos"]:
        por_k = {}
        for lista in ("roteiros", "roteiros_sem_gps"):
            for r in alvo.get(lista, []):
                if not r.get("regras"):
                    continue
                r["fora_do_monitoramento"] = (alvo["fonte"], r["regras"][0]["local_id"]) in fora
                kw = max((x.get("potencia_kw") or 7.2) for x in r["regras"])
                k = max(1, round(intervalo_de(kw) / ciclo_min))
                if k <= 1:
                    r.pop("intervalo_min", None); r.pop("grupo", None)
                else:
                    r["intervalo_min"] = k * ciclo_min
                    if lista == "roteiros":
                        r["grupo"] = por_k.get(k, 0) % k; por_k[k] = por_k.get(k, 0) + 1
                contas[k * ciclo_min] = contas.get(k * ciclo_min, 0) + (lista == "roteiros")
        # roteiros_sem_gps herdam o grupo do roteiro de mesmo local
        grupos = {r["regras"][0]["local_nome"]: r.get("grupo") for r in alvo.get("roteiros", []) if r.get("regras")}
        for r in alvo.get("roteiros_sem_gps", []):
            if r.get("regras") and r.get("intervalo_min"):
                r["grupo"] = grupos.get(r["regras"][0]["local_nome"]) or 0
    cfg["cadencia_ativa"] = True
    return "config do GD: " + ", ".join(f"{n} a cada {m} min" for m, n in sorted(contas.items())) + \
           (f"; {len(fora)} locais fora das cidades monitoradas" if fora else "")


def _espelho(*args, **kw):
    """Registra um passo no quadro "Estação ao vivo" (só na VPS; nunca derruba o ciclo)."""
    if ESPELHO_DESLIGADO:
        return
    try:
        import espelho
        espelho.registrar(*args, **kw)
    except Exception:
        pass


ESPELHO_DESLIGADO = False
DIR_FALHAS = None        # calibração/ensaio: pasta onde guardar a tela de cada falha (xml, png, txt)
_n_falha_capt = [0]


def capturar_falha(rotulo):
    """Guarda a tela do momento (só quando DIR_FALHAS está definido). Nunca levanta."""
    if not DIR_FALHAS:
        return
    try:
        _n_falha_capt[0] += 1
        base = Path(DIR_FALHAS) / f"falha_{_n_falha_capt[0]:02d}_{re.sub(r'[^A-Za-z0-9]+', '_', rotulo)[:40]}"
        xml = tela_xml()
        base.with_suffix(".xml").write_text(xml, encoding="utf-8")
        base.with_suffix(".txt").write_text("\n".join(f"{t}\t{b}" for t, b in textos(xml)), encoding="utf-8")
        base.with_suffix(".png").write_bytes(adb("exec-out", "screencap", "-p", binario=True))
    except Exception:
        pass


class _RepetirAlvo(Exception):
    """Sinal interno: o alvo deve recomeçar do primeiro roteiro (depois de reiniciar o BlueStacks)."""


def coletar(ensaio=False, so_fonte=None):
    """ensaio=True: executa os roteiros e mostra as leituras sem gravar (calibração).
    Roteiros com "opcional": true só rodam enquanto o ciclo está dentro de cfg["orcamento_s"]
    (padrão 270 s): os carregadores do inventário vêm primeiro e sempre são lidos; o resto, se der tempo."""
    if not CFG.exists():
        print("config/telas.json ainda não existe - rode o modo descobrir e calibre primeiro."); return
    cfg = json.loads(CFG.read_text(encoding="utf-8"))
    remota = None if os.environ.get("ELETROPOSTOS_SEM_CONFIG_REMOTA") else config_remota()
    nota_remota = aplicar_config_remota(cfg, remota, cfg.get("ciclo_min", 8)) if remota else None
    alvos = [a for a in cfg["alvos"] if not so_fonte or a["fonte"] == so_fonte]
    orcamento = cfg.get("orcamento_s", 270)
    limite = cfg.get("limite_s", 420)                  # passou disso, nenhum roteiro novo começa
    inicio = time.time()
    resumo_inicial = [nota_remota] if nota_remota else []
    # Cadência por roteiro: com "intervalo_min" (ex.: 16 para os AC de 7 kW) o roteiro roda em 1 de
    # cada intervalo/ciclo ciclos, no grupo "grupo" — as metades se alternam e cada ciclo leva a mesma
    # carga. O índice do ciclo vem do relógio (a tarefa roda a cada ciclo_min), então não guarda estado.
    ciclo_min = cfg.get("ciclo_min", 8)
    cadencia = bool(cfg.get("cadencia_ativa"))
    ciclo_idx = int(inicio // (ciclo_min * 60))

    def na_vez(roteiro):
        if not cadencia or not roteiro.get("intervalo_min"):
            return True
        k = max(1, round(roteiro["intervalo_min"] / ciclo_min))
        return ciclo_idx % k == roteiro.get("grupo", 0) % k

    def passo_de(roteiro):
        return roteiro.get("intervalo_min") if cadencia and roteiro.get("intervalo_min") else None
    max_falhas_seguidas = cfg.get("max_falhas_seguidas", 3)
    resumo = list(resumo_inicial)

    global ESPELHO_DESLIGADO
    ESPELHO_DESLIGADO = bool(ensaio)
    if not ensaio:
        try:
            import espelho
            espelho.limpar_antigas()
        except Exception:
            pass

    def gravar_(fonte, linhas, erro=None, falhas=None):
        if ensaio:
            for l in linhas:
                print(f"  {l['local_fonte']} | {l['conector']} | {l['status_bruto']!r} -> {l['status']}")
            if erro:
                print(f"  ERRO {erro}")
            for f in falhas or []:
                print(f"  FALHA {f['nome']}: {f['erro']}")
            return len(linhas)
        return gravar(fonte, linhas, erro=erro, falhas=falhas) if falhas else gravar(fonte, linhas, erro=erro)

    reinicios = 0   # reinícios do BlueStacks neste ciclo (no máximo 1: Android travado ou GPS parado)

    def reiniciar(motivo, fonte=None):
        """Reinicia o BlueStacks e registra o porquê na varredura (ok=false) da fonte afetada."""
        nonlocal reinicios
        reinicios += 1
        msg = (f"Android reiniciado pela estação: {motivo}"[:220] + nota_memoria())[:300]
        _espelho("reiniciando o aparelho", "falha", fonte, msg)
        resumo.append(msg)
        print("  " + msg, flush=True)
        for f in ([fonte] if fonte else [a["fonte"] for a in alvos]):
            try:
                gravar_(f, [], erro=msg)
            except Exception:
                pass
        reiniciar_android()

    if ANDROID == "vmos":
        try:   # posição fixa do aparelho (Rio Preto): sem ela a lista da ATM vem com "0.00 km"
            import vmos; vmos.gps()
        except Exception as e:
            resumo.append(f"GPS do VMOS não aplicado ({str(e)[:80]})")
    try:
        conectar_adb()
    except AndroidTravado as e:
        try:
            reiniciar(f"Android travado antes do ciclo ({e})")
        except Exception as e2:
            for alvo in alvos:
                gravar_(alvo["fonte"], [], erro=f"Android travado e o reinício falhou: {e2!r}"[:300])
            raise
    except Exception as e:
        for alvo in alvos:
            gravar_(alvo["fonte"], [], erro=repr(e)[:300])
        raise
    global ORDEM_LISTA, PASSO_LISTA, CACHE_LISTA
    rodizio_arq = BASE / "dados" / "rodizio.json"
    try:
        rodizio = json.loads(rodizio_arq.read_text(encoding="utf-8"))
    except Exception:
        rodizio = {}
    for alvo in alvos:
        t0 = time.time()
        _espelho(f"abrindo {alvo.get('app', alvo['fonte'])}", "info", alvo["fonte"], foto=True)
        ORDEM_LISTA = alvo.get("ordem", [])
        PASSO_LISTA = alvo.get("passo_lista_px", 160)
        if cfg.get("tela_ref"):
            globals()["TELA_REF"] = tuple(cfg["tela_ref"])
        # roteiros fixos primeiro; os opcionais em rodízio (começando de onde o ciclo anterior parou)
        fixos = [r for r in alvo["roteiros"] if not r.get("opcional")]
        opcionais = [r for r in alvo["roteiros"] if r.get("opcional")]
        k = rodizio.get(alvo["fonte"], 0) % len(opcionais) if opcionais else 0
        roteiros = fixos + opcionais[k:] + opcionais[:k]
        lidos_opc = 0
        reiniciou = False
        while True:
          try:
            linhas = []
            pulados = 0
            fora_da_vez = 0
            falhas = []
            falhas_local = []   # [{nome, erro}] por local não lido (assertividade); nome = local_nome das linhas
            seguidas = 0

            def nao_lidos(motivo, desde):
                for r in roteiros[desde:]:
                    if r.get("regras") and not r.get("opcional") and na_vez(r) and not r.get("fora_do_monitoramento"):
                        falhas_local.append({"nome": r["regras"][0]["local_nome"], "erro": motivo[:200]})
            i = 0
            while i < len(roteiros):
                roteiro = roteiros[i]; i += 1
                if roteiro.get("regras") and (roteiro.get("fora_do_monitoramento") or not na_vez(roteiro)):
                    fora_da_vez += 1
                    continue
                if roteiro.get("opcional"):
                    if time.time() - inicio > orcamento:
                        pulados += 1
                        continue
                    lidos_opc += 1
                elif roteiro.get("regras") and time.time() - inicio > limite:
                    falhas.insert(0, f"limite de {limite} s do ciclo: {sum(1 for r in roteiros[i - 1:] if r.get('regras') and not r.get('opcional'))} carregadores fixos não lidos")
                    nao_lidos(f"não lido: limite de {limite} s do ciclo", i - 1)
                    break
                if seguidas >= max_falhas_seguidas:
                    falhas.insert(0, f"{seguidas} carregadores seguidos falharam: app desistido neste ciclo")
                    nao_lidos(f"não lido: {seguidas} carregadores seguidos falharam antes", i - 1)
                    break
                if roteiro.get("regras"):
                    _espelho(f"lendo {roteiro['regras'][0]['local_nome'].strip()}", "info", alvo["fonte"])
                try:
                    for p in roteiro["passos"]:
                        if p["tipo"] == "escolher":
                            forcar = os.environ.pop("ELETROPOSTOS_FORCAR_ESCOLHA", None)
                            if forcar or any(re.search(p["regex"], t, re.I) for t, _ in tela_atual()):
                                if p["se_casar"] == "reiniciar_bluestacks" and not reiniciou and reinicios == 0:
                                    reiniciar(p.get("motivo", "GPS parado"), alvo["fonte"])
                                    reiniciou = True
                                    raise _RepetirAlvo()
                                chave = p.get("depois", p["se_casar"]) if p["se_casar"] == "reiniciar_bluestacks" else p["se_casar"]
                                outros = alvo.get(chave, [])
                                resumo.append(f"{alvo['fonte']}: {p.get('motivo', chave)} ({len(outros)} roteiros)")
                                roteiros = roteiros[:i] + outros
                            continue
                        executar_passo(p)
                    itens = tela_atual() if roteiro.get("regras") else []
                    vazias = 0
                    for r in roteiro.get("regras", []):
                        bruto = ler(r, itens)
                        vazias += bruto is None
                        linhas.append(linha(r["local_id"], r["local_nome"], r.get("conector", "*"), r.get("potencia_kw"),
                                            bruto, r.get("lat"), r.get("lng"), passo_min=passo_de(roteiro)))
                    if vazias:
                        capturar_falha(f"{alvo['fonte']}_vazia_{roteiro['regras'][0]['local_nome']}")
                    for p in roteiro.get("depois", []):
                        executar_passo(p)
                    if roteiro.get("regras"):
                        seguidas = 0
                except (_RepetirAlvo, AndroidTravado):
                    raise
                except Exception as e:
                    if not roteiro.get("regras"):
                        raise                      # falhou a abertura do app: o alvo inteiro cai
                    falhas.append(f"{roteiro.get('nome', '?')}: {repr(e)[:80]}")
                    falhas_local.append({"nome": roteiro["regras"][0]["local_nome"], "erro": repr(e)[:200]})
                    _espelho(f"falha em {roteiro['regras'][0]['local_nome'].strip()}", "falha", alvo["fonte"], repr(e)[:200])
                    capturar_falha(f"{alvo['fonte']}_{roteiro['regras'][0]['local_nome']}")
                    seguidas += 1
                    print(f"  roteiro falhou: {falhas[-1]}", flush=True)
                    CACHE_LISTA = ""
            if cfg.get("guardar_capturas"):
                salvar_captura(alvo["fonte"])
            erro = ("; ".join(falhas))[:300] if falhas else None
            # falhas por local só em ciclo que leu algo: ciclo sem leitura nenhuma já conta como falha da fonte
            n = gravar_(alvo["fonte"], linhas, erro=erro, falhas=falhas_local if linhas else None)
            _espelho(f"{alvo['fonte']}: {n} leituras gravadas", "ok" if not falhas else "falha", alvo["fonte"],
                     f"{n} leituras" + (f", {len(falhas_local)} locais não lidos" if falhas_local else ""), foto=False)
            resumo.append(f"{alvo['fonte']} {n} leituras em {time.time() - t0:.0f} s"
                          + (f" ({pulados} roteiros opcionais pulados)" if pulados else "")
                          + (f" ({fora_da_vez} fora da vez)" if fora_da_vez else "")
                          + (f" ({len(falhas)} roteiros falharam)" if falhas else ""))
          except _RepetirAlvo:
            roteiros = fixos + opcionais[k:] + opcionais[:k]
            continue
          except AndroidTravado as e:
            if reinicios == 0:
                try:
                    reiniciar(f"Android travado em {alvo['fonte']} ({e})", alvo["fonte"])
                    reiniciou = True
                    roteiros = fixos + opcionais[k:] + opcionais[:k]
                    continue
                except Exception as e2:
                    e = e2
            gravar_(alvo["fonte"], [], erro=(f"Android travado: {e!r}"[:200] + nota_memoria())[:300])
            resumo.append(f"{alvo['fonte']} ERRO Android travado {repr(e)[:120]} ({time.time() - t0:.0f} s)")
          except Exception as e:
            gravar_(alvo["fonte"], [], erro=repr(e)[:300])
            resumo.append(f"{alvo['fonte']} ERRO {repr(e)[:120]} ({time.time() - t0:.0f} s)")
          break
        if opcionais:
            rodizio[alvo["fonte"]] = (k + lidos_opc) % len(opcionais)
    _espelho("fim do ciclo", "fim", None, "; ".join(resumo)[:300])
    if not ensaio:
        try:
            rodizio_arq.parent.mkdir(exist_ok=True)
            rodizio_arq.write_text(json.dumps(rodizio), encoding="utf-8")
        except Exception:
            pass
    return "; ".join(resumo)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "coletar"
    if cmd == "ver":
        conectar_adb()
        for t, b in textos(tela_xml()):
            print(f"{t}\t{b}")
    elif cmd == "descobrir" and len(sys.argv) >= 3:
        conectar_adb()
        print("captura salva:", salvar_captura(sys.argv[2]))
        for t, b in textos((CAPT / sorted(CAPT.glob("*.xml"))[-1].name).read_text(encoding="utf-8")):
            print(f"{t}\t{b}")
    elif cmd == "ensaiar":
        print(coletar(ensaio=True, so_fonte=sys.argv[2] if len(sys.argv) > 2 else None))
    else:
        print(coletar())
