#!/usr/bin/env bash
# Instalação/atualização da Ludmilla na VPS. Idempotente: rodar de novo só
# atualiza o que mudou. Chamado pelo workflow ludmilla-worker.yml por SSH,
# com o código já sincronizado em /opt/ludmilla e as variáveis de ambiente
# SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SIMULAR exportadas.
#
# Sem `set -e` nas partes de diagnóstico (lição do workflow do Nginx: errexit
# mata o script antes de dizer o que aconteceu). As partes que alteram a
# máquina checam o retorno explicitamente.

APP=/opt/ludmilla
ENV_DIR=/etc/ludmilla
UNIT=/etc/systemd/system/ludmilla-worker.service
USUARIO=ludmilla

falhar() { echo "ERRO: $*" >&2; exit 1; }
passo()  { echo; echo "── $*"; }

passo "diagnóstico"
echo "host: $(hostname) · $(lsb_release -ds 2>/dev/null || cat /etc/os-release | head -1)"
echo "node: $(node -v 2>/dev/null || echo 'ausente')"
echo "unit: $([ -f "$UNIT" ] && echo 'existe' || echo 'não existe')"
echo "serviço: $(systemctl is-active ludmilla-worker 2>/dev/null || echo 'inativo')"
[ -d "$APP" ] && echo "código: $(ls "$APP" | tr '\n' ' ')" || echo "código: pasta ausente"

echo "navegadores: $(ls /home/ludmilla/.cache/ms-playwright 2>/dev/null | tr '
' ' ')"
echo "últimas linhas do log:"; journalctl -u ludmilla-worker -n 12 --no-pager 2>/dev/null

if [ "${SIMULAR:-false}" = "true" ]; then
  echo; echo "SIMULAÇÃO — nada foi alterado."; exit 0
fi

[ -n "$SUPABASE_URL" ] || falhar "SUPABASE_URL vazio"
[ -n "$SUPABASE_SERVICE_ROLE_KEY" ] || falhar "SUPABASE_SERVICE_ROLE_KEY vazio"
[ -f "$APP/package.json" ] || falhar "código não está em $APP (o rsync rodou?)"

passo "Node 22"
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')
if [ "${NODE_MAJOR:-0}" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - || falhar "não consegui preparar o repositório do Node"
  apt-get install -y nodejs || falhar "não consegui instalar o Node"
fi
echo "node agora: $(node -v)"

passo "usuário $USUARIO"
id -u "$USUARIO" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$USUARIO" || falhar "não consegui criar o usuário"

passo "dependências do Chromium (Playwright)"
# instala as libs de sistema como root; o navegador em si vai no HOME do usuário
cd "$APP" || falhar "sem $APP"
npm ci --omit=dev --no-audit --no-fund || falhar "npm ci falhou"
npx playwright install-deps chromium || falhar "playwright install-deps falhou"
chown -R "$USUARIO:$USUARIO" "$APP"
sudo -u "$USUARIO" -H env PLAYWRIGHT_BROWSERS_PATH=/home/$USUARIO/.cache/ms-playwright \
  npx --prefix "$APP" playwright install chromium || falhar "download do Chromium falhou"

passo "agent-browser (criação de projetos na CPFL)"
# CLI da vercel-labs: o robô a chama por processo, com sessão própria por run.
# Libs de sistema como root; o Chrome for Testing vai no HOME do usuário.
npm i -g agent-browser@latest --no-audit --no-fund || falhar "npm i -g agent-browser falhou"
agent-browser install --with-deps >/dev/null 2>&1 || echo "aviso: 'agent-browser install --with-deps' falhou (as libs do Playwright costumam bastar)"
mkdir -p "/home/$USUARIO/.agent-browser"
chown -R "$USUARIO:$USUARIO" "/home/$USUARIO/.agent-browser"
sudo -u "$USUARIO" -H agent-browser install || falhar "download do Chrome (agent-browser) para o usuário $USUARIO falhou"
echo "agent-browser: $(agent-browser --version 2>/dev/null)"
# Chrome COM janela num display virtual (xvfb): o headless se apresenta como
# "HeadlessChrome" e a Agência da CPFL não mostrava os cartões de perfil
# (18/09/2026). Com --headed a CLI sobe o Xvfb sozinha quando não há DISPLAY.
apt-get install -y xvfb >/dev/null 2>&1 || echo "aviso: não consegui instalar o xvfb"
# fumaça: abre, lê título e a cara do navegador, fecha — com os mesmos argumentos do serviço
AB_ARGS='--no-sandbox,--disable-crashpad,--disable-crash-reporter,--disable-gpu,--disable-dev-shm-usage,--lang=pt-BR,--accept-lang=pt-BR'
if sudo -u "$USUARIO" -H agent-browser --session fumaca --headed --args "$AB_ARGS" open https://example.com >/dev/null 2>&1; then
  echo "fumaça: $(sudo -u "$USUARIO" -H agent-browser --session fumaca get title 2>/dev/null)"
  echo "navegador: $(echo 'navigator.userAgent + " | " + navigator.language' | sudo -u "$USUARIO" -H agent-browser --session fumaca eval --stdin 2>/dev/null)"
  sudo -u "$USUARIO" -H agent-browser --session fumaca close >/dev/null 2>&1
else
  echo "aviso: o Chrome do agent-browser não abriu no teste de fumaça — a criação na CPFL vai falhar até ajustar LUDMILLA_AB_EXEC/LUDMILLA_AB_ARGS"
fi

passo "GDAL (ingestão da BDGD)"
# O ogr2ogr lê o Geodatabase da ANEEL e faz a agregação fora do banco. É
# dependência de SISTEMA, não de npm. O `apt-get update` antes não é opcional:
# sem ele o install falha com 404 em libminizip1t64/libmysqlclient21.
if command -v ogr2ogr >/dev/null 2>&1; then
  echo "ogr2ogr já presente: $(ogr2ogr --version)"
else
  apt-get update -qq || echo "aviso: apt-get update falhou"
  apt-get install -y gdal-bin || falhar "não consegui instalar o gdal-bin (sem ele a ingestão da BDGD não roda)"
  echo "ogr2ogr: $(ogr2ogr --version)"
fi

passo "comando bdgd (/usr/local/bin/bdgd)"
# Três armadilhas que este wrapper resolve, e que um `npm run bdgd` cru não:
#
# 1. As variáveis vivem em /etc/ludmilla/env, que é 600 e só o systemd lê. Um
#    `npm run bdgd` num shell qualquer morre com "Falta SUPABASE_URL".
# 2. TMPDIR=/var/tmp, e não /tmp: a Paulista descompacta ~6,5 GB, e se /tmp for
#    tmpfs isso sai da RAM — a máquina cai em vez de dar erro de disco. O
#    os.tmpdir() do Node honra TMPDIR.
# 3. Roda como o usuário ludmilla, não como root, para o lixo temporário e os
#    logs não ficarem com dono errado.
cat > /usr/local/bin/bdgd <<'WRAP'
#!/usr/bin/env bash
# Ingestão da BDGD de uma distribuidora.  uso: sudo bdgd CPFL_Piratininga
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "rode com sudo: sudo bdgd <SIGLA>" >&2; exit 1; }
[ $# -ge 1 ] || { echo "uso: sudo bdgd CPFL_Piratininga" >&2; exit 1; }
[ -r /etc/ludmilla/env ] || { echo "falta /etc/ludmilla/env — rode o deploy do worker primeiro" >&2; exit 1; }
set -a; . /etc/ludmilla/env; set +a
: "${SUPABASE_URL:?SUPABASE_URL ausente em /etc/ludmilla/env}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY ausente em /etc/ludmilla/env}"
mkdir -p /var/tmp/bdgd && chown ludmilla:ludmilla /var/tmp/bdgd
exec sudo -u ludmilla -H env \
  SUPABASE_URL="$SUPABASE_URL" \
  SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  TMPDIR=/var/tmp/bdgd \
  PATH=/usr/local/bin:/usr/bin:/bin \
  node /opt/ludmilla/dist/bdgd/index.js "$@"
WRAP
chmod 755 /usr/local/bin/bdgd
echo "instalado: sudo bdgd <SIGLA>"
echo "espaço em /var/tmp: $(df -h /var/tmp | awk 'NR==2{print $4}') livre (a Paulista precisa de 10 GB)"

passo "ambiente em $ENV_DIR/env (só root lê)"
mkdir -p "$ENV_DIR"
cat > "$ENV_DIR/env" <<EOF
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
LUDMILLA_POLL_SECONDS=30
LUDMILLA_AB_ARGS=$AB_ARGS
LUDMILLA_AB_HEADED=1
EOF
chmod 600 "$ENV_DIR/env"

passo "serviço systemd"
cp "$APP/deploy/ludmilla-worker.service" "$UNIT" || falhar "não consegui copiar a unit"
systemctl daemon-reload
systemctl enable ludmilla-worker >/dev/null 2>&1
systemctl restart ludmilla-worker || falhar "o serviço não subiu"
sleep 3
systemctl status ludmilla-worker --no-pager -l | head -20
echo
echo "últimas linhas do log:"
journalctl -u ludmilla-worker -n 10 --no-pager
