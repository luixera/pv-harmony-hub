#!/usr/bin/env bash
# Instalação/atualização do coletor de eletropostos na VPS. Rodar de novo
# converge para o mesmo estado (seguro repetir): o `npm ci` reinstala as
# dependências, o arquivo de ambiente é regravado e o serviço sempre reinicia.
# Chamado pelo workflow eletropostos-worker.yml por SSH, com o código já
# sincronizado em /opt/gdm-eletropostos. SIMULAR / SUPABASE_URL /
# SUPABASE_SERVICE_ROLE_KEY chegam como `export` no início do mesmo stdin que
# traz este script (nunca na linha de comando do ssh: lá a service role ficaria
# legível em /proc/<pid>/cmdline durante o deploy).
#
# Sem `set -e` nas partes de diagnóstico (lição do deploy do Nginx). As partes
# que alteram a máquina checam o retorno explicitamente. Como o script chega
# pelo stdin (`bash -s`), comandos que podem ler o stdin levam `</dev/null`.

APP=/opt/gdm-eletropostos
ENV_DIR=/etc/gdm-eletropostos
UNIT=/etc/systemd/system/gdm-eletropostos.service
USUARIO=gdmeletropostos

falhar() { echo "ERRO: $*" >&2; exit 1; }
passo()  { echo; echo "── $*"; }

passo "diagnóstico"
echo "host: $(hostname) · $(lsb_release -ds 2>/dev/null || head -1 /etc/os-release)"
echo "node: $(node -v 2>/dev/null || echo 'ausente')"
echo "unit: $([ -f "$UNIT" ] && echo 'existe' || echo 'não existe')"
echo "serviço: $(systemctl is-active gdm-eletropostos 2>/dev/null || echo 'inativo')"
echo "navegadores: $(ls /home/$USUARIO/.cache/ms-playwright 2>/dev/null | tr '\n' ' ')"
[ -d "$APP" ] && echo "código: $(ls "$APP" | tr '\n' ' ')" || echo "código: pasta ausente"
echo "últimas linhas do log:"; journalctl -u gdm-eletropostos -n 12 --no-pager 2>/dev/null

if [ "${SIMULAR:-false}" = "true" ]; then
  echo; echo "SIMULAÇÃO — nada foi alterado."; exit 0
fi

[ -n "$SUPABASE_URL" ] || falhar "SUPABASE_URL vazio"
[ -n "$SUPABASE_SERVICE_ROLE_KEY" ] || falhar "SUPABASE_SERVICE_ROLE_KEY vazio"
[ -f "$APP/package.json" ] || falhar "código não está em $APP (o rsync rodou?)"
[ -f "$APP/dist/index.js" ] || falhar "dist/index.js ausente em $APP (o workflow compila antes do rsync)"

export DEBIAN_FRONTEND=noninteractive

passo "Node 22"
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')
if [ "${NODE_MAJOR:-0}" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - || falhar "não consegui preparar o repositório do Node"
  apt-get install -y nodejs </dev/null || falhar "não consegui instalar o Node"
fi
echo "node agora: $(node -v)"

passo "usuário $USUARIO"
id -u "$USUARIO" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$USUARIO" \
  || falhar "não consegui criar o usuário"

passo "dependências"
cd "$APP" || falhar "sem $APP"
# `env -u`: o npm roda como root e executa o `postinstall` de cada dependência;
# só este comando perde a service role.
env -u SUPABASE_SERVICE_ROLE_KEY npm ci --omit=dev --no-audit --no-fund </dev/null || falhar "npm ci falhou"
# Chromium headless do Playwright (lê o mapa público da Tupi): libs de sistema
# como root, o navegador no HOME do usuário do serviço (a unit aponta para lá).
npx playwright install-deps chromium </dev/null || falhar "playwright install-deps falhou"
mkdir -p "/home/$USUARIO/.cache" && chown -R "$USUARIO:$USUARIO" "/home/$USUARIO/.cache"
sudo -u "$USUARIO" -H env PLAYWRIGHT_BROWSERS_PATH=/home/$USUARIO/.cache/ms-playwright \
  npx --prefix "$APP" playwright install chromium </dev/null || falhar "download do Chromium falhou"
echo "navegadores: $(ls /home/$USUARIO/.cache/ms-playwright 2>/dev/null | tr '\n' ' ')"
chown -R root:root "$APP"
chmod -R a+rX "$APP"

passo "ambiente em $ENV_DIR/env (só root lê)"
mkdir -p "$ENV_DIR"
chmod 700 "$ENV_DIR"
( umask 077; cat > "$ENV_DIR/env" <<EOF
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
ELETROPOSTOS_PASSO_MIN=5
EOF
) || falhar "não consegui gravar $ENV_DIR/env"
chmod 600 "$ENV_DIR/env"
unset SUPABASE_SERVICE_ROLE_KEY

passo "serviço systemd"
cp "$APP/deploy/gdm-eletropostos.service" "$UNIT" || falhar "não consegui copiar a unit"
systemctl daemon-reload
systemctl enable gdm-eletropostos >/dev/null 2>&1
systemctl restart gdm-eletropostos || falhar "o serviço não subiu"
sleep 3
systemctl status gdm-eletropostos --no-pager -l | head -15
echo
echo "últimas linhas do log:"
journalctl -u gdm-eletropostos -n 10 --no-pager
