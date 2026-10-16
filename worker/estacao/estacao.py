"""Sessão da estação local no GD Manager (Supabase), só com a biblioteca padrão.

A estação entra como um usuário "staff" do tenant GD Manager, registrado em
eletroposto_estacao. A senha NUNCA fica em arquivo nem em argumento: na primeira
vez a pessoa digita e-mail e senha no terminal e só a sessão (tokens) é guardada
em dados/sessao.json. A cada corrida o token é renovado quando está perto de vencer.

Na VPS (aparelho na nuvem, VMOS) não há login de pessoa: com SUPABASE_SERVICE_ROLE_KEY no
ambiente a estação usa a chave de serviço (a mesma do coletor da Tupi) e grava pelas RPCs
que aceitam service role. ESTACAO_ID identifica a estação no batimento.

Uso:
  py -3 estacao.py login    -> pede e-mail e senha no terminal e guarda a sessão
  py -3 estacao.py testar   -> renova a sessão e dá o batimento (eletropostos_estacao_pulsa)
  py -3 estacao.py sair     -> apaga a sessão guardada
"""
import json, os, sys, time, getpass, urllib.request, urllib.error
from pathlib import Path

BASE = Path(__file__).resolve().parent
CFG = BASE / "config" / "supabase.env"
SESSAO = BASE / "dados" / "sessao.json"
FOLGA_S = 120  # renova o access token quando faltar menos que isso para vencer


VARIAVEIS = ("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ESTACAO_ID", "ADB_ALVO", "ANDROID")


def config():
    """config/supabase.env (linhas CHAVE=valor; # comenta) e, por cima, as variáveis de ambiente."""
    out = {}
    if CFG.exists():
        for linha in CFG.read_text(encoding="utf-8-sig").splitlines():
            linha = linha.strip()
            if not linha or linha.startswith("#") or "=" not in linha:
                continue
            k, v = linha.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    for k in VARIAVEIS:
        if os.environ.get(k):
            out[k] = os.environ[k]
    if not out.get("SUPABASE_URL"):
        raise RuntimeError(f"falta SUPABASE_URL ({CFG} ou variável de ambiente)")
    if not (out.get("SUPABASE_ANON_KEY") or out.get("SUPABASE_SERVICE_ROLE_KEY")):
        raise RuntimeError("falta SUPABASE_ANON_KEY (PC) ou SUPABASE_SERVICE_ROLE_KEY (VPS)")
    out["SUPABASE_URL"] = out["SUPABASE_URL"].rstrip("/")
    return out


def _http(url, corpo, cabecalhos, timeout=30):
    dados = json.dumps(corpo).encode("utf-8") if corpo is not None else None
    req = urllib.request.Request(url, data=dados, method="POST",
                                 headers={"Content-Type": "application/json", **cabecalhos})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            texto = r.read().decode("utf-8")
            return json.loads(texto) if texto.strip() else None
    except urllib.error.HTTPError as e:
        texto = e.read().decode("utf-8", "replace")[:300]
        raise RuntimeError(f"HTTP {e.code} em {url.split('/rest/')[-1].split('/auth/')[-1]}: {texto}") from None


def _auth(cfg, grant, corpo):
    return _http(f"{cfg['SUPABASE_URL']}/auth/v1/token?grant_type={grant}", corpo,
                 {"apikey": cfg["SUPABASE_ANON_KEY"]})


def _guardar(sessao):
    SESSAO.parent.mkdir(exist_ok=True)
    SESSAO.write_text(json.dumps({
        "refresh_token": sessao["refresh_token"],
        "access_token": sessao["access_token"],
        "expira_em": int(time.time()) + int(sessao.get("expires_in") or 3600),
        "usuario": (sessao.get("user") or {}).get("email"),
    }, ensure_ascii=False, indent=1), encoding="utf-8")


def login():
    """Pede e-mail e senha NO TERMINAL (nada vai para arquivo além da sessão)."""
    cfg = config()
    email = input("E-mail do usuário da estação: ").strip()
    senha = getpass.getpass("Senha (não aparece ao digitar): ")
    sessao = _auth(cfg, "password", {"email": email, "password": senha})
    del senha
    _guardar(sessao)
    print(f"sessão guardada em {SESSAO} para {email}")


def token():
    """Access token válido: reaproveita o guardado ou renova pelo refresh token.

    Guardar também o access token evita renovar a cada corrida: o Supabase gira o
    refresh token a cada uso e revoga a sessão inteira se um token antigo for
    reusado depois de alguns segundos — o que aconteceria quando a coleta agendada
    e uma coleta manual rodassem juntas.
    """
    cfg = config()
    if not SESSAO.exists():
        raise RuntimeError("estação sem sessão: rode  py -3 estacao.py login")
    s = json.loads(SESSAO.read_text(encoding="utf-8"))
    if s.get("access_token") and s.get("expira_em", 0) - time.time() > FOLGA_S:
        return s["access_token"]
    try:
        nova = _auth(cfg, "refresh_token", {"refresh_token": s["refresh_token"]})
    except RuntimeError as e:
        raise RuntimeError(f"sessão da estação inválida ({e}); rode  py -3 estacao.py login") from None
    _guardar(nova)
    return nova["access_token"]


def modo_servico():
    """True na VPS: chave de serviço no ambiente, sem login de pessoa."""
    return bool(config().get("SUPABASE_SERVICE_ROLE_KEY"))


def rpc(nome, args=None):
    """Chama uma RPC do PostgREST como o usuário da estação (PC) ou com a chave de serviço (VPS)."""
    cfg = config()
    if cfg.get("SUPABASE_SERVICE_ROLE_KEY"):
        chave = cfg["SUPABASE_SERVICE_ROLE_KEY"]
        return _http(f"{cfg['SUPABASE_URL']}/rest/v1/rpc/{nome}", args or {},
                     {"apikey": chave, "Authorization": f"Bearer {chave}"})
    return _http(f"{cfg['SUPABASE_URL']}/rest/v1/rpc/{nome}", args or {},
                 {"apikey": cfg["SUPABASE_ANON_KEY"], "Authorization": f"Bearer {token()}"})


def pulsar():
    """Batimento: o console mostra a estação 'Em dia' enquanto isso chega.
    Na VPS (chave de serviço) informa qual estação pelo ESTACAO_ID."""
    if modo_servico():
        return rpc("eletropostos_estacao_pulsa", {"p_estacao": config().get("ESTACAO_ID")})
    rpc("eletropostos_estacao_pulsa")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "testar"
    if cmd == "login":
        login()
    elif cmd == "sair":
        SESSAO.unlink(missing_ok=True); print("sessão apagada")
    else:
        pulsar()
        print("estação ok: sessão válida e batimento registrado no GD Manager")
