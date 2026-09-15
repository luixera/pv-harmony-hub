#Requires -Version 5.1
<#
  Ludmilla — estação local (Windows).

  Instala (ou atualiza) o robô no perfil do usuário logado, faz o login no
  GD Manager com o usuário operador da estação (uma vez) e deixa a Ludmilla
  iniciando junto com o Windows. Não precisa de administrador.

  Como usar: extraia o ludmilla-local.zip, clique com o botão direito neste
  arquivo → "Executar com o PowerShell". Ou, num terminal:
      powershell -ExecutionPolicy Bypass -File .\instalar.ps1

  Para ATUALIZAR: extraia o zip novo e rode este mesmo arquivo de novo — a
  sessão, o arquivo env e os perfis do Chrome ficam; só o código é trocado.

  O que fica nesta máquina (%LOCALAPPDATA%\Ludmilla):
    app\            código do robô
    env             SUPABASE_URL e SUPABASE_ANON_KEY (valores públicos)
    sessao.json     sessão do usuário operador (NUNCA a senha)
    chrome-elektro\ perfil do Chrome usado só pela Ludmilla no Portal GD
#>
param(
  [string]$SupabaseUrl,
  [string]$SupabaseAnonKey
)
$ErrorActionPreference = 'Stop'
$Dir = Join-Path $env:LOCALAPPDATA 'Ludmilla'
$App = Join-Path $Dir 'app'
$Origem = $PSScriptRoot

function Diga($t) { Write-Host "[Ludmilla] $t" -ForegroundColor Cyan }

# ── 1. Node 22 ou mais novo ────────────────────────────────────────────────
function VersaoNode {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) { return 0 }
  $v = (& node -v) 2>$null
  if (-not $v) { return 0 }
  return [int]($v.TrimStart('v').Split('.')[0])
}
if ((VersaoNode) -lt 22) {
  Diga 'Node.js 22+ não encontrado. Instalando o Node.js LTS pelo winget...'
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  if ((VersaoNode) -lt 22) { throw 'O Node.js não ficou disponível neste terminal. Feche e abra o terminal de novo e rode o instalar.ps1 outra vez.' }
}
Diga "Node.js $(& node -v)"

# ── 2. Google Chrome (o Portal GD só abre para um Chrome de verdade) ─────────
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Google Chrome não encontrado. Instale o Chrome (google.com/chrome) e rode o instalar.ps1 de novo.' }
Diga "Chrome em $chrome"

# ── 3. Para a Ludmilla, se estiver rodando (atualização) ────────────────────
$rodando = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*Ludmilla\app\dist\index.js*' -or $_.CommandLine -like '*Ludmilla.cmd*' }
if ($rodando) {
  Diga 'Parando a Ludmilla que está rodando...'
  $rodando | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}

# ── 4. Código ───────────────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
if (Test-Path $App) { Remove-Item -Recurse -Force $App }
Copy-Item -Recurse -Path (Join-Path $Origem 'app') -Destination $App
Copy-Item -Path (Join-Path $Origem 'Ludmilla.cmd') -Destination $Dir -Force
Copy-Item -Path (Join-Path $Origem 'instalar.ps1') -Destination $Dir -Force
Diga 'Instalando as dependências (npm)...'
Push-Location $App
try {
  & npm ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci falhou.' }
} finally { Pop-Location }

# ── 5. env da estação (valores públicos do projeto; segredo nenhum) ──────────
$envArq = Join-Path $Dir 'env'
if (-not (Test-Path $envArq)) {
  $padrao = @{}
  $padraoArq = Join-Path $Origem 'env.padrao'
  if (Test-Path $padraoArq) {
    Get-Content $padraoArq | ForEach-Object {
      if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { $padrao[$matches[1]] = $matches[2].Trim().Trim('"') }
    }
  }
  if (-not $SupabaseUrl) { $SupabaseUrl = $padrao['SUPABASE_URL'] }
  if (-not $SupabaseAnonKey) { $SupabaseAnonKey = $padrao['SUPABASE_ANON_KEY'] }
  if (-not $SupabaseUrl) { $SupabaseUrl = Read-Host 'SUPABASE_URL (https://....supabase.co)' }
  if (-not $SupabaseAnonKey) { $SupabaseAnonKey = Read-Host 'SUPABASE_ANON_KEY (chave pública, a mesma do site)' }
  Set-Content -Path $envArq -Value @("SUPABASE_URL=$SupabaseUrl", "SUPABASE_ANON_KEY=$SupabaseAnonKey") -Encoding ASCII
  Diga "Arquivo env gravado em $envArq"
}

# ── 6. Login do usuário operador (uma vez; a senha vai direto para o Supabase) ─
if (-not (Test-Path (Join-Path $Dir 'sessao.json'))) {
  Diga 'Entre com o usuário da estação no GD Manager (o "operador local" escolhido na conta da Elektro):'
  $env:LUDMILLA_MODO = 'local'
  Push-Location $App
  try {
    & node dist\index.js --login
    if ($LASTEXITCODE -ne 0) { throw 'O login não foi concluído. Rode o instalar.ps1 de novo.' }
  } finally { Pop-Location }
}

# ── 7. Iniciar junto com o Windows (atalho minimizado na pasta Inicializar) ──
$startup = [Environment]::GetFolderPath('Startup')
$atalho = Join-Path $startup 'Ludmilla.lnk'
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($atalho)
$s.TargetPath = Join-Path $Dir 'Ludmilla.cmd'
$s.WorkingDirectory = $App
$s.WindowStyle = 7
$s.Description = 'Ludmilla — estação local (GD Manager)'
$s.Save()
Diga "Atalho de inicialização em $atalho"

# ── 8. Iniciar agora ────────────────────────────────────────────────────────
Start-Process -FilePath (Join-Path $Dir 'Ludmilla.cmd') -WorkingDirectory $App -WindowStyle Minimized
Diga 'Pronto. A Ludmilla está rodando (janela minimizada "Ludmilla - estacao local").'
Diga 'Quando a Elektro pedir o código da imagem, um balão avisa aqui na tela; o Chrome da Ludmilla abre sozinho.'
Diga 'Para parar: feche a janela da Ludmilla. Para tirar da inicialização: apague o atalho acima.'
