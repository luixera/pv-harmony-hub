"""Espelho por fotos do que a estação faz (quadro "Estação ao vivo" da aba Coleta).

Só no modo serviço (VPS): sem SUPABASE_SERVICE_ROLE_KEY tudo aqui vira no-op. Nada derruba o
ciclo: qualquer erro de rede, de Storage ou de RPC é engolido (o passo vai sem foto, ou nem vai).

  registrar(passo, situacao="info", fonte=None, mensagem=None, foto=None)
      situacao: 'info' | 'ok' | 'falha' | 'fim'
      foto: None = decide sozinho (atual no máximo a cada FOTO_MIN_S, sempre em falha e no fim);
            True/False força.
  Em falha a foto do momento também fica em <ESTACAO_ID>/<AAAAMMDD>/<ciclo>/<n>.png.
  limpar_antigas(): apaga as pastas de falha com mais de 3 dias (uma vez por ciclo).

Bucket privado 'eletropostos-espelho' (3 MB, png/jpeg); as linhas o banco apaga sozinho (3 dias).
"""
import datetime as dt, json, time, urllib.error, urllib.request
import estacao

BUCKET = "eletropostos-espelho"
FOTO_MIN_S = 20          # no máximo uma foto "atual" a cada 20 s (falha, abrir app e fim sempre têm)
RETENCAO_DIAS = 3
CICLO = dt.datetime.now().strftime("%Y%m%d-%H%M")
_estado = {"ultima_foto": 0.0, "n_falha": 0, "limpou": False}


def ativo():
    try:
        return estacao.modo_servico() and bool(estacao.config().get("ESTACAO_ID"))
    except Exception:
        return False


def _cfg():
    c = estacao.config()
    return c["SUPABASE_URL"], c["SUPABASE_SERVICE_ROLE_KEY"], c["ESTACAO_ID"]


def _req(metodo, caminho, corpo=None, tipo="application/json", extra=None, timeout=20):
    url, chave, _ = _cfg()
    dados = corpo if isinstance(corpo, (bytes, type(None))) else json.dumps(corpo).encode("utf-8")
    h = {"Authorization": f"Bearer {chave}", "apikey": chave}
    if dados is not None:
        h["Content-Type"] = tipo
    h.update(extra or {})
    req = urllib.request.Request(url + caminho, data=dados, method=metodo, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        t = r.read().decode("utf-8", "replace")
        return json.loads(t) if t.strip().startswith(("{", "[")) else t


def _screencap():
    import coletor_tela as c
    return c.adb("exec-out", "screencap", "-p", binario=True, timeout=20)


def _subir(caminho, png, upsert):
    _req("POST", f"/storage/v1/object/{BUCKET}/{caminho}", png, tipo="image/png",
         extra={"x-upsert": "true"} if upsert else None, timeout=30)


def registrar(passo, situacao="info", fonte=None, mensagem=None, foto=None):
    if not ativo():
        return
    try:
        _, _, est = _cfg()
        agora = time.time()
        quer_foto = foto if foto is not None else (
            situacao in ("falha", "fim") or agora - _estado["ultima_foto"] >= FOTO_MIN_S)
        foto_atual, foto_falha = False, None
        if quer_foto:
            try:
                png = _screencap()
                if png and len(png) < 3 * 1024 * 1024:
                    _subir(f"{est}/atual.png", png, upsert=True)
                    foto_atual = True
                    _estado["ultima_foto"] = agora
                    if situacao == "falha":
                        _estado["n_falha"] += 1
                        foto_falha = f"{est}/{CICLO[:8]}/{CICLO}/{_estado['n_falha']}.png"
                        _subir(foto_falha, png, upsert=False)
            except Exception:
                foto_atual, foto_falha = foto_atual, None
        estacao.rpc("eletropostos_espelho_registrar", {
            "p_estacao": est, "p_ciclo": CICLO, "p_passo": str(passo)[:200], "p_situacao": situacao,
            "p_fonte": fonte, "p_mensagem": (str(mensagem)[:300] if mensagem else None),
            "p_foto": foto_falha, "p_foto_atual": foto_atual})
    except Exception:
        pass


def limpar_antigas():
    """Apaga as pastas de falha (<est>/<AAAAMMDD>/) com mais de RETENCAO_DIAS dias. Uma vez por ciclo."""
    if not ativo() or _estado["limpou"]:
        return
    _estado["limpou"] = True
    try:
        _, _, est = _cfg()
        limite = (dt.date.today() - dt.timedelta(days=RETENCAO_DIAS)).strftime("%Y%m%d")
        dias = _req("POST", f"/storage/v1/object/list/{BUCKET}",
                    {"prefix": f"{est}/", "limit": 100, "offset": 0, "sortBy": {"column": "name", "order": "asc"}}) or []
        velhas = [d["name"] for d in dias if isinstance(d, dict) and str(d.get("name", "")).isdigit()
                  and len(d["name"]) == 8 and d["name"] < limite]
        for dia in velhas:
            ciclos = _req("POST", f"/storage/v1/object/list/{BUCKET}", {"prefix": f"{est}/{dia}/", "limit": 1000}) or []
            arquivos = []
            for cic in ciclos:
                nomes = _req("POST", f"/storage/v1/object/list/{BUCKET}",
                             {"prefix": f"{est}/{dia}/{cic['name']}/", "limit": 1000}) or []
                arquivos += [f"{est}/{dia}/{cic['name']}/{n['name']}" for n in nomes if n.get("name")]
            if arquivos:
                _req("DELETE", f"/storage/v1/object/{BUCKET}", {"prefixes": arquivos})
    except Exception:
        pass
