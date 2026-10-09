#!/usr/bin/env bash
# Instalação/atualização do assinador na VPS. Rodar de novo converge para o
# mesmo estado (é seguro repetir), mas não é incremental: o `npm ci` reinstala as
# dependências, o arquivo de ambiente é regravado e o serviço sempre reinicia.
# Chamado pelo workflow assinador-worker.yml por SSH, com o código já
# sincronizado em /opt/gdm-assinador. SIMULAR / SUPABASE_URL /
# SUPABASE_SERVICE_ROLE_KEY chegam como `export` no início do mesmo stdin que
# traz este script (nunca na linha de comando do ssh: lá a service role ficaria
# legível em /proc/<pid>/cmdline durante o deploy).
#
# Sem `set -e` nas partes de diagnóstico (lição do deploy do Nginx: errexit
# mata o script antes de ele dizer o que aconteceu). As partes que alteram a
# máquina checam o retorno explicitamente.
#
# Como o script chega pelo stdin (`bash -s`), comandos que podem ler o stdin
# (apt-get, npm, soffice) levam `</dev/null`, senão engolem o resto do script.

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

# sem perguntas do dpkg/needrestart no meio do deploy
export DEBIAN_FRONTEND=noninteractive

passo "Node 22"
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')
if [ "${NODE_MAJOR:-0}" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - || falhar "não consegui preparar o repositório do Node"
  apt-get install -y nodejs </dev/null || falhar "não consegui instalar o Node"
fi
echo "node agora: $(node -v)"

passo "LibreOffice (conversão de planilha e .docx para PDF)"
# Índice do apt em dia: o LibreOffice puxa centenas de dependências e, com índice
# velho, o install dá 404. Falha do update é só aviso (o install diz se faltou).
apt-get update </dev/null || echo "aviso: 'apt-get update' falhou — sigo com o índice que existe"
# Só os filtros de escritório, sem a interface gráfica inteira. Sem os
# "recommends" o LibreOffice pode ficar sem fontes de texto (PDF válido, mas com
# glifos em branco): por isso as fontes entram explícitas.
apt-get install -y --no-install-recommends libreoffice-calc libreoffice-writer \
  fonts-liberation fonts-dejavu-core </dev/null \
  || falhar "não consegui instalar o LibreOffice"
echo "soffice: $(soffice --version 2>/dev/null | head -1)"

passo "usuário $USUARIO"
id -u "$USUARIO" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$USUARIO" \
  || falhar "não consegui criar o usuário"

passo "dependências"
cd "$APP" || falhar "sem $APP"
npm ci --omit=dev --no-audit --no-fund </dev/null || falhar "npm ci falhou"
# O código é do root e só leitura para o serviço (a unit repete isso com
# ReadOnlyPaths): um worker comprometido não consegue reescrever o próprio código.
chown -R root:root "$APP"
chmod -R a+rX "$APP"

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
# a partir daqui a chave só existe no arquivo: não herdada por nenhum comando filho
unset SUPABASE_SERVICE_ROLE_KEY

passo "fumaça: o LibreOffice instalado converte?"
# Só confere o LibreOffice, com um arquivo de texto qualquer — NÃO é a lista do
# que o assinador aceita (o worker converte .xlsx/.xls/.docx/.doc; CSV é
# recusado de propósito). Perfil isolado e pasta própria, como o worker faz.
# Passa só com PDF de verdade: >= 1000 bytes, começa em %PDF- e termina com
# %%EOF (o mesmo critério do validarPdf do worker). O que sobra do stderr do
# soffice é impresso quando falha, que é onde aparece biblioteca/fonte faltando.
SCRIPT_FUMACA=$(cat <<'SH'
D=/tmp/gdm-assinador-fumaca
rm -rf "$D"
mkdir -p "$D" || { echo "FUMACA_FALHOU: /tmp nao e gravavel"; exit 1; }
trap 'rm -rf "$D"' EXIT
cd "$D" || exit 1
printf 'Teste de fumaca do assinador.\nSegunda linha de texto.\n' > fumaca.txt
timeout 120 soffice "-env:UserInstallation=file://$D/perfil" --headless --norestore \
  --convert-to pdf --outdir "$D" "$D/fumaca.txt" >saida.txt 2>erro.txt </dev/null
RC=$?
TAM=0
[ -f fumaca.pdf ] && TAM=$(wc -c < fumaca.pdf)
if [ "$TAM" -ge 1000 ] && [ "$(head -c 5 fumaca.pdf)" = "%PDF-" ] && tail -c 1024 fumaca.pdf | grep -aq '%%EOF'; then
  echo "FUMACA_OK ($TAM bytes)"
else
  echo "FUMACA_FALHOU: soffice saiu com $RC e o PDF tem $TAM bytes"
  echo "--- stderr do soffice (ultimas linhas):"; tail -n 15 erro.txt
  echo "--- stdout do soffice:"; tail -n 5 saida.txt
fi
SH
)

# Fora do sandbox da unit (usuário comum, /tmp do host).
fumaca_no_host() {
  sudo -u "$USUARIO" -H bash -c "$SCRIPT_FUMACA" </dev/null 2>&1
}

SAIDA=""
if command -v systemd-run >/dev/null 2>&1; then
  # Sob o MESMO sandbox da unit: se o endurecimento atrapalhar o LibreOffice, é
  # aqui que aparece, e não na primeira conversão em produção.
  SAIDA=$(systemd-run --quiet --pipe --wait --collect \
    -p "User=$USUARIO" -p "Group=$USUARIO" \
    -p NoNewPrivileges=yes -p PrivateTmp=yes -p ProtectSystem=full -p ProtectHome=read-only \
    -p "ReadWritePaths=/home/$USUARIO" -p "ReadOnlyPaths=$APP" \
    --setenv="HOME=/home/$USUARIO" --setenv=PATH=/usr/local/bin:/usr/bin:/bin \
    bash -c "$SCRIPT_FUMACA" </dev/null 2>&1)
else
  echo "systemd-run ausente"
fi

if echo "$SAIDA" | grep -q 'FUMACA_'; then
  MODO="sob o sandbox da unit"
else
  [ -n "$SAIDA" ] && echo "systemd-run: $(echo "$SAIDA" | tail -n 5)"
  echo "aviso: não consegui rodar a fumaça sob o sandbox — o endurecimento da unit NÃO foi exercitado; testando fora dele"
  SAIDA=$(fumaca_no_host)
  MODO="fora do sandbox (sem o endurecimento da unit)"
fi
echo "$SAIDA" | tail -n 25

if echo "$SAIDA" | grep -q 'FUMACA_OK'; then
  echo "conversão ok — $MODO"
else
  echo "aviso: a conversão de fumaça falhou ($MODO) — o serviço sobe, mas planilhas e .docx não serão convertidos (PDF já pronto continua assinável)"
  if [ "$MODO" = "sob o sandbox da unit" ]; then
    # distingue "o LibreOffice não funciona" de "o endurecimento da unit atrapalha"
    if fumaca_no_host | grep -q 'FUMACA_OK'; then
      echo "aviso: fora do sandbox a conversão FUNCIONA — o endurecimento da unit é que está atrapalhando o LibreOffice"
    fi
  fi
fi

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
