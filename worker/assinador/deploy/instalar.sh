#!/usr/bin/env bash
# Instalação/atualização do assinador na VPS. Idempotente: rodar de novo só
# atualiza o que mudou. Chamado pelo workflow assinador-worker.yml por SSH,
# com o código já sincronizado em /opt/gdm-assinador e as variáveis
# SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SIMULAR exportadas.
#
# Sem `set -e` nas partes de diagnóstico (lição do deploy do Nginx: errexit
# mata o script antes de ele dizer o que aconteceu). As partes que alteram a
# máquina checam o retorno explicitamente.
#
# O workflow entrega este arquivo pelo stdin (`bash -s`): comandos que podem ler
# o stdin (apt-get, npm, soffice) levam `</dev/null`, senão engolem o resto do script.

APP=/opt/gdm-assinador
ENV_DIR=/etc/gdm-assinador
UNIT=/etc/systemd/system/gdm-assinador.service
USUARIO=gdmassinador

falhar() { echo "ERRO: $*" >&2; exit 1; }
passo()  { echo; echo "── $*"; }

passo "diagnóstico"
echo "host: $(hostname) · $(lsb_release -ds 2>/dev/null || head -1 /etc/os-release)"
echo "node: $(node -v 2>/dev/null || echo 'ausente')"
if command -v soffice >/dev/null 2>&1; then
  echo "soffice: $(soffice --version 2>/dev/null | head -1)"
else
  echo "soffice: ausente"
fi
echo "unit: $([ -f "$UNIT" ] && echo 'existe' || echo 'não existe')"
echo "serviço: $(systemctl is-active gdm-assinador 2>/dev/null || echo 'inativo')"
[ -d "$APP" ] && echo "código: $(ls "$APP" | tr '\n' ' ')" || echo "código: pasta ausente"
echo "últimas linhas do log:"; journalctl -u gdm-assinador -n 12 --no-pager 2>/dev/null

if [ "${SIMULAR:-false}" = "true" ]; then
  echo; echo "SIMULAÇÃO — nada foi alterado."; exit 0
fi

[ -n "$SUPABASE_URL" ] || falhar "SUPABASE_URL vazio"
[ -n "$SUPABASE_SERVICE_ROLE_KEY" ] || falhar "SUPABASE_SERVICE_ROLE_KEY vazio"
[ -f "$APP/package.json" ] || falhar "código não está em $APP (o rsync rodou?)"
[ -f "$APP/dist/index.js" ] || falhar "dist/index.js ausente em $APP (o workflow compila antes do rsync)"

passo "Node 22"
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')
if [ "${NODE_MAJOR:-0}" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - || falhar "não consegui preparar o repositório do Node"
  apt-get install -y nodejs || falhar "não consegui instalar o Node"
fi
echo "node agora: $(node -v)"

passo "LibreOffice (conversão de planilha e .docx para PDF)"
# só os filtros de escritório, sem a interface gráfica inteira
apt-get install -y --no-install-recommends libreoffice-calc libreoffice-writer </dev/null \
  || falhar "não consegui instalar o LibreOffice"
echo "soffice: $(soffice --version 2>/dev/null | head -1)"

passo "usuário $USUARIO"
id -u "$USUARIO" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$USUARIO" \
  || falhar "não consegui criar o usuário"

passo "dependências"
cd "$APP" || falhar "sem $APP"
npm ci --omit=dev --no-audit --no-fund </dev/null || falhar "npm ci falhou"
chown -R "$USUARIO:$USUARIO" "$APP"

passo "ambiente em $ENV_DIR/env (só root lê)"
mkdir -p "$ENV_DIR"
chmod 700 "$ENV_DIR"
# umask 077 antes de criar: o arquivo nunca existe legível por outros, nem por um instante
( umask 077; cat > "$ENV_DIR/env" <<EOF
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
ASSINADOR_POLL_SECONDS=15
EOF
) || falhar "não consegui gravar $ENV_DIR/env"
chmod 600 "$ENV_DIR/env"

passo "fumaça: o LibreOffice instalado converte?"
# Só confere o binário do LibreOffice, com um arquivo de texto qualquer — NÃO é
# a lista do que o assinador aceita (o worker converte .xlsx/.xls/.docx/.doc;
# CSV é recusado de propósito). Perfil isolado e pasta própria, como o worker faz.
FUMACA=/tmp/gdm-assinador-fumaca
rm -rf "$FUMACA"
sudo -u "$USUARIO" -H mkdir -p "$FUMACA" || falhar "não consegui criar $FUMACA"
sudo -u "$USUARIO" -H bash -c '
  cd /tmp/gdm-assinador-fumaca &&
  printf "a;b\n1;2\n" > fumaca.txt &&
  timeout 120 soffice -env:UserInstallation=file:///tmp/gdm-assinador-fumaca/perfil \
    --headless --norestore --convert-to pdf --outdir /tmp/gdm-assinador-fumaca \
    /tmp/gdm-assinador-fumaca/fumaca.txt >/dev/null 2>&1 &&
  head -c 5 /tmp/gdm-assinador-fumaca/fumaca.pdf' </dev/null | grep -q '%PDF-' \
  && echo "conversão ok" \
  || echo "aviso: a conversão de fumaça falhou — o serviço sobe, mas planilhas e .docx não serão convertidos (PDF já pronto continua assinável)"
rm -rf "$FUMACA"

passo "serviço systemd"
cp "$APP/deploy/gdm-assinador.service" "$UNIT" || falhar "não consegui copiar a unit"
systemctl daemon-reload
systemctl enable gdm-assinador >/dev/null 2>&1
systemctl restart gdm-assinador || falhar "o serviço não subiu"
sleep 3
systemctl status gdm-assinador --no-pager -l | head -20
echo
echo "últimas linhas do log:"
journalctl -u gdm-assinador -n 10 --no-pager
