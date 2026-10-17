#!/usr/bin/env bash
# Instalação/atualização da estação de telas na VPS (celular na nuvem VMOS).
# Converge para o mesmo estado (seguro repetir). Chamado pelo workflow
# estacao-worker.yml por SSH, com o código já em /opt/gdm-estacao. As variáveis
# (SIMULAR, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VMOS_ACCESS_KEY,
# VMOS_SECRET_KEY) chegam como `export` no início do stdin — nunca na linha de
# comando do ssh (ficariam em /proc/<pid>/cmdline).
#
# Sem `set -e` nas partes de diagnóstico. Comandos que leem o stdin levam
# `</dev/null` (o script chega pelo stdin, `bash -s`).

APP=/opt/gdm-estacao
ENV_DIR=/etc/gdm-estacao
USUARIO=gdmestacao
ESTACAO_ID=5e7a0000-e1e7-4000-8000-000000000001   # eletroposto_estacao "VPS + VMOS" (migração 20261017000000)
VMOS_PAD_CODE=ACP25091462JLVCR

falhar() { echo "ERRO: $*" >&2; exit 1; }
passo()  { echo; echo "── $*"; }

passo "diagnóstico"
echo "host: $(hostname) · $(lsb_release -ds 2>/dev/null || head -1 /etc/os-release)"
echo "python3: $(python3 --version 2>/dev/null || echo ausente) · ssh: $(ssh -V 2>&1 | head -1) · adb: $(adb version 2>/dev/null | head -1 || echo ausente)"
echo "timer: $(systemctl is-active gdm-estacao.timer 2>/dev/null || echo inativo) · último ciclo: $(systemctl show gdm-estacao.service -p ExecMainStatus --value 2>/dev/null)"
[ -d "$APP" ] && echo "código: $(ls "$APP" | tr '\n' ' ')" || echo "código: pasta ausente"
echo "últimas linhas do log:"; journalctl -u gdm-estacao -n 15 --no-pager 2>/dev/null

if [ "${SIMULAR:-false}" = "true" ]; then
  echo; echo "SIMULAÇÃO — nada foi alterado."; exit 0
fi

# só o timer (recalibração do aparelho: dois clientes adb brigam pela tela)
case "${TIMER:-instalar}" in
  pausar)
    passo "pausando o timer (e o ciclo em andamento, se houver)"
    systemctl disable --now gdm-estacao.timer 2>&1
    systemctl stop gdm-estacao.service 2>&1
    echo "timer: $(systemctl is-active gdm-estacao.timer) · serviço: $(systemctl is-active gdm-estacao.service)"
    exit 0 ;;
  religar)
    passo "religando o timer"
    systemctl enable --now gdm-estacao.timer 2>&1 || falhar "o timer não subiu"
    systemctl list-timers gdm-estacao.timer --no-pager | head -3
    exit 0 ;;
esac

[ -n "$SUPABASE_URL" ] || falhar "SUPABASE_URL vazio"
[ -n "$SUPABASE_SERVICE_ROLE_KEY" ] || falhar "SUPABASE_SERVICE_ROLE_KEY vazio"
[ -n "$VMOS_ACCESS_KEY" ] || falhar "VMOS_ACCESS_KEY vazio — cadastre o segredo no GitHub (Settings → Secrets → Actions)"
[ -n "$VMOS_SECRET_KEY" ] || falhar "VMOS_SECRET_KEY vazio — cadastre o segredo no GitHub (Settings → Secrets → Actions)"
[ -f "$APP/coletar.py" ] || falhar "código não está em $APP (o rsync rodou?)"
[ -f "$APP/config/telas.json" ] || falhar "config/telas.json ausente em $APP"

export DEBIAN_FRONTEND=noninteractive

passo "pacotes (python3, openssh-client, adb)"
FALTA=""
command -v python3 >/dev/null 2>&1 || FALTA="$FALTA python3"
command -v ssh >/dev/null 2>&1 || FALTA="$FALTA openssh-client"
command -v adb >/dev/null 2>&1 || FALTA="$FALTA android-tools-adb"
if [ -n "$FALTA" ]; then
  apt-get update </dev/null || echo "aviso: apt-get update falhou — sigo com o índice que existe"
  apt-get install -y --no-install-recommends $FALTA </dev/null || falhar "não consegui instalar:$FALTA"
fi
echo "python3: $(python3 --version) · $(ssh -V 2>&1 | head -1) · $(adb version | head -1)"

passo "usuário $USUARIO"
id -u "$USUARIO" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$USUARIO" \
  || falhar "não consegui criar o usuário"
mkdir -p "/home/$USUARIO/.ssh" && chown -R "$USUARIO:$USUARIO" "/home/$USUARIO" && chmod 700 "/home/$USUARIO/.ssh"

passo "código e pasta de dados"
mkdir -p "$APP/dados"
chown -R root:root "$APP"
chmod -R a+rX "$APP"
chown -R "$USUARIO:$USUARIO" "$APP/dados"

passo "ambiente em $ENV_DIR/env (só root lê)"
mkdir -p "$ENV_DIR"
chmod 700 "$ENV_DIR"
( umask 077; cat > "$ENV_DIR/env" <<EOF
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
ESTACAO_ID=$ESTACAO_ID
ANDROID=vmos
VMOS_ACCESS_KEY=$VMOS_ACCESS_KEY
VMOS_SECRET_KEY=$VMOS_SECRET_KEY
VMOS_PAD_CODE=$VMOS_PAD_CODE
VMOS_GPS_LAT=-20.8346
VMOS_GPS_LNG=-49.398
EOF
) || falhar "não consegui gravar $ENV_DIR/env"
chmod 600 "$ENV_DIR/env"
unset SUPABASE_SERVICE_ROLE_KEY VMOS_ACCESS_KEY VMOS_SECRET_KEY

passo "systemd (serviço de um ciclo + timer de 8 min)"
cp "$APP/deploy/gdm-estacao.service" /etc/systemd/system/gdm-estacao.service || falhar "não copiei o service"
cp "$APP/deploy/gdm-estacao.timer" /etc/systemd/system/gdm-estacao.timer || falhar "não copiei o timer"
systemctl daemon-reload
systemctl enable --now gdm-estacao.timer >/dev/null 2>&1 || falhar "o timer não subiu"
# reinicia o timer para valer a regra nova de disparo (o daemon-reload só não basta)
systemctl restart gdm-estacao.timer || falhar "o timer não reiniciou"
systemctl list-timers gdm-estacao.timer --no-pager | head -3

passo "fumaça: estado do aparelho pela API do VMOS (sem abrir o túnel)"
# roda como o usuário do serviço, com o mesmo ambiente; só consulta o aparelho
sudo -u "$USUARIO" -H bash -c "set -a; . $ENV_DIR/env 2>/dev/null; cd $APP && timeout 60 python3 vmos.py estado" </dev/null 2>&1 | tail -n 8 \
  || echo "aviso: não consegui ler o env como $USUARIO (é 600 de root) — a fumaça roda no primeiro ciclo do timer"
echo
echo "Pronto. Próximo ciclo: $(systemctl list-timers gdm-estacao.timer --no-pager | awk 'NR==2{print $1, $2, $3}')"
echo "Log: journalctl -u gdm-estacao -f   ·   arquivo: $APP/dados/coleta.log"
