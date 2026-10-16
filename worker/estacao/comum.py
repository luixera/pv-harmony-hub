"""Funções comuns da estação local: gravação no GD Manager e normalização de status.

Desde 16/10/2026 as leituras vão para o Supabase (tabelas eletroposto_* do GD
Manager) pela RPC eletropostos_gravar_local, como o usuário da estação (estacao.py).
O SQLite (dados/leituras.db) deixou de ser usado e NÃO é apagado.
"""
import datetime as dt
from pathlib import Path
import estacao

BASE = Path(__file__).resolve().parent


def agora():
    """(instante UTC, janela de 5 min) — só para log; o banco calcula a janela sozinho."""
    t = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    slot = t.replace(minute=t.minute - t.minute % 5, second=0)
    return t.isoformat(), slot.isoformat()


MAPA_STATUS = {
    "available": "livre",
    "charging": "ocupado", "preparing": "ocupado", "finishing": "ocupado",
    "suspendedev": "ocupado", "suspendedevse": "ocupado", "occupied": "ocupado",
    "faulted": "fora", "unavailable": "fora",
    "disponível": "livre", "disponivel": "livre", "livre": "livre",
    "carregando": "ocupado", "ocupado": "ocupado", "em uso": "ocupado", "em carregamento": "ocupado",
    "indisponível": "fora", "indisponivel": "fora", "manutenção": "fora", "manutencao": "fora",
    "offline": "fora", "falha": "fora",
    # palavras vistas nos apps (ATM EVs / Cury)
    "liberado": "livre", "liberada": "livre",
    "em carga": "ocupado", "em preparação": "ocupado", "em preparacao": "ocupado", "preparando": "ocupado", "reservado": "ocupado", "reservada": "ocupado",
    "inativo": "fora", "inativa": "fora", "em manutenção": "fora", "em manutencao": "fora",
    "fora de serviço": "fora", "fora de servico": "fora", "desconectado": "fora",
}


def normalizar(s):
    return MAPA_STATUS.get((s or "").strip().lower(), "desconhecido")


def linha(local_fonte, local_nome, conector="*", potencia_kw=None, status_bruto=None,
          lat=None, lng=None, upstream_ts=None, passo_min=None):
    """Uma leitura no formato que a RPC espera. Só estado do conector: nada de usuário.
    `passo_min`: de quanto em quanto tempo ESTE carregador é lido (ex.: 16 para os AC de 7 kW);
    sem ele, o banco usa o passo da fonte."""
    d = {
        "local_fonte": str(local_fonte), "local_nome": local_nome, "lat": lat, "lng": lng,
        "conector": str(conector or "*"), "potencia_kw": potencia_kw,
        "status_bruto": status_bruto, "status": normalizar(status_bruto),
        "upstream_ts": upstream_ts,
    }
    if passo_min:
        d["passo_min"] = int(passo_min)
    return d


def gravar(fonte, linhas, erro=None, falhas=None):
    """Grava a varredura de uma fonte (leituras + linha em eletroposto_varredura).

    O banco faz o vínculo automático com o cadastro (≤ 150 m) no primeiro avistamento,
    arredonda a janela e marca o batimento da estação. Devolve o nº de leituras.
    `falhas`: [{"nome": local_nome, "erro": texto curto}] — os locais que o ciclo tentou e não
    leu, para a assertividade da leitura (o `erro` resumido continua indo, truncado a 300).
    Se o banco ainda não tiver a RPC com p_falhas, grava sem ela.
    """
    args = {"p_fonte": fonte, "p_linhas": linhas, "p_erro": (erro or None) and str(erro)[:300]}
    funcao = "eletropostos_gravar" if estacao.modo_servico() else "eletropostos_gravar_local"
    if falhas:
        try:
            return estacao.rpc(funcao, {**args, "p_falhas": falhas})
        except RuntimeError as e:
            if "PGRST202" not in str(e) and "Could not find the function" not in str(e):
                raise
    return estacao.rpc(funcao, args)
