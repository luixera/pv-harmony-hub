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
# fumaça: abre, lê o título e fecha — com os mesmos argumentos do serviço
# --lang: a Agência/OneTrust mudam de cara com o idioma do navegador; o Playwright roda em pt-BR
AB_ARGS='--no-sandbox,--disable-crashpad,--disable-crash-reporter,--disable-gpu,--disable-dev-shm-usage,--lang=pt-BR,--accept-lang=pt-BR'
if sudo -u "$USUARIO" -H agent-browser --session fumaca --args "$AB_ARGS" open https://example.com >/dev/null 2>&1; then
  echo "fumaça: $(sudo -u "$USUARIO" -H agent-browser --session fumaca get title 2>/dev/null)"
  sudo -u "$USUARIO" -H agent-browser --session fumaca close >/dev/null 2>&1
else
  echo "aviso: o Chrome do agent-browser não abriu no teste de fumaça — a criação na CPFL vai falhar até ajustar LUDMILLA_AB_EXEC/LUDMILLA_AB_ARGS"
fi

passo "ambiente em $ENV_DIR/env (só root lê)"
mkdir -p "$ENV_DIR"
cat > "$ENV_DIR/env" <<EOF
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
LUDMILLA_POLL_SECONDS=30
LUDMILLA_AB_ARGS=$AB_ARGS
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
