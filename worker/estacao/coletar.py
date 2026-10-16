"""Executado pelo Agendador do Windows a cada 8 minutos ("Eletropostos > Coleta a cada 8 min" — o ciclo do ATM EVs leva ~4,5 min; o banco sabe o passo de cada fonte).
Lê os apps no BlueStacks e grava no GD Manager. A Tupi é coletada na VPS, não aqui."""
import traceback, datetime as dt
from pathlib import Path

BASE = Path(__file__).resolve().parent
log = BASE / "dados" / "coleta.log"


def registrar(msg):
    log.parent.mkdir(exist_ok=True)
    with open(log, "a", encoding="utf-8") as f:
        f.write(f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")
    print(msg)


def curto(exc):
    """Mensagem curta + onde estourou (arquivo:linha), para o registro."""
    msg = traceback.format_exception_only(type(exc), exc)[-1].strip()[:300]
    tb = traceback.extract_tb(exc.__traceback__)
    onde = f" @ {Path(tb[-1].filename).name}:{tb[-1].lineno}" if tb else ""
    return msg + onde


def principal():
    try:
        import estacao; estacao.pulsar(); registrar("estação ok")
    except Exception as e:
        registrar("estação ERRO " + curto(e)); return
    try:
        import coletor_tela; registrar("telas: " + str(coletor_tela.coletar()))
    except Exception as e:
        registrar("telas ERRO " + curto(e))


# Tranca: o BlueStacks é uma tela só — duas coletas ao mesmo tempo (agendada + coletar_agora.bat)
# brigam pela tela e uma derruba a outra (visto em 16/10/2026: uma coleta de 22 min e outra que
# começou no meio dela porque a tranca "venceu" aos 10 min). A tranca guarda o PID do dono:
# só vale como abandonada se esse processo não existir mais (ou passados 45 min, por segurança).
import ctypes, os
tranca = BASE / "dados" / "coleta.lock"


def processo_vivo(pid):
    """True se o processo existe (Windows: OpenProcess + GetExitCodeProcess == STILL_ACTIVE;
    Linux: kill(pid, 0))."""
    if os.name != "nt":
        try:
            os.kill(int(pid), 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        except Exception:
            return True
    try:
        k = ctypes.windll.kernel32
        h = k.OpenProcess(0x1000, False, int(pid))   # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return False
        try:
            codigo = ctypes.c_ulong()
            return bool(k.GetExitCodeProcess(h, ctypes.byref(codigo))) and codigo.value == 259
        finally:
            k.CloseHandle(h)
    except Exception:
        return True   # na dúvida, respeita a tranca


def tranca_ocupada():
    if not tranca.exists():
        return False
    try:
        pid = int(tranca.read_text(encoding="utf-8").split()[0])
    except Exception:
        pid = None
    idade = dt.datetime.now().timestamp() - tranca.stat().st_mtime
    if idade > 45 * 60:
        return False
    return processo_vivo(pid) if pid else idade < 600


try:
    tranca.parent.mkdir(exist_ok=True)
    if tranca_ocupada():
        registrar("pulada: outra coleta em andamento (dados/coleta.lock)")
    else:
        tranca.write_text(f"{os.getpid()} {dt.datetime.now():%Y-%m-%d %H:%M:%S}", encoding="utf-8")
        try:
            principal()
        finally:
            try:   # só o dono apaga a tranca
                if tranca.read_text(encoding="utf-8").split()[0] == str(os.getpid()):
                    tranca.unlink(missing_ok=True)
            except Exception:
                pass
except Exception as e:
    registrar("ERRO " + curto(e))
