# Instala o servico local do PC da empresa e faz ele iniciar com o Windows:
#   - grava os PDFs em C:\Programa Elegance\<pasta> (salvador_pdf.js)
#   - busca as NF-e de compra na SEFAZ com o certificado A1 que fica SO neste PC (sefaz.js; veja docs/sefaz_configuracao.md)
# Rode em cada PC (de preferencia pelo instalar_salvador_pdf.bat, duplo clique). Pode rodar de novo para atualizar.
# Nao precisa ser administrador, exceto se o Node.js ainda nao estiver instalado (o Windows pede a confirmacao uma vez).
$ErrorActionPreference = 'Stop'
$destino = 'C:\Programa Elegance\Servico'
$porta   = 3917
$arquivos = @('salvador_pdf.js', 'sefaz.js', 'package.json', 'package-lock.json', 'sefaz.config.exemplo.json')

function Achar-Node {
  $c = Get-Command node -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

foreach ($a in $arquivos) {
  if (-not (Test-Path (Join-Path $PSScriptRoot $a))) { throw "Nao achei $a ao lado deste instalador ($PSScriptRoot)." }
}

# 1) Node.js
$node = Achar-Node
if (-not $node) {
  Write-Host 'Node.js nao encontrado. Instalando (versao LTS) pelo winget...'
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw 'O winget nao existe neste Windows. Instale o Node.js LTS em https://nodejs.org e rode este instalador de novo.'
  }
  winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  $node = Achar-Node
  if (-not $node) { throw 'O Node.js foi instalado, mas nao o encontrei. Feche e abra este instalador de novo.' }
}
Write-Host "Node.js: $node"

# 2) copia o servico para uma pasta fixa (sefaz.config.json, o certificado e o estado NAO sao tocados)
New-Item -ItemType Directory -Force -Path $destino | Out-Null
foreach ($a in $arquivos) { Copy-Item -Force (Join-Path $PSScriptRoot $a) (Join-Path $destino $a) }
Write-Host "Servico copiado para $destino"

# 3) componentes da SEFAZ (node-forge e fast-xml-parser), na versao travada do package-lock.json.
#    Se falhar (sem internet), o salvador de PDF funciona igual; so as notas da SEFAZ ficam indisponiveis.
$npm = Join-Path (Split-Path $node) 'npm.cmd'
if (-not (Test-Path $npm)) { $c = Get-Command npm.cmd -ErrorAction SilentlyContinue; if ($c) { $npm = $c.Source } else { $npm = $null } }
if ($npm) {
  Push-Location $destino
  try {
    & $npm ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { & $npm install --omit=dev --no-audit --no-fund }
    if ($LASTEXITCODE -ne 0) { Write-Host 'AVISO: nao consegui instalar os componentes da SEFAZ (sem internet?). Rode este instalador de novo depois.' }
    else { Write-Host 'Componentes da SEFAZ instalados.' }
  } finally { Pop-Location }
} else {
  Write-Host 'AVISO: npm nao encontrado; as notas da SEFAZ ficam indisponiveis ate rodar este instalador de novo.'
}

# 4) inicio automatico com o Windows (pasta Inicializar do usuario, sem janela)
$inicio = [Environment]::GetFolderPath('Startup')
$vbs = Join-Path $inicio 'Elegance_Salvador_PDF.vbs'
$linha = 's.Run """' + $node + '"" ""' + (Join-Path $destino 'salvador_pdf.js') + '""", 0, False'
Set-Content -Path $vbs -Encoding ASCII -Value @('Set s = CreateObject("WScript.Shell")', $linha)
Write-Host "Inicio automatico criado: $vbs"

# 5) reinicia o servico (uma versao antiga em execucao nao teria as rotas novas)
function Servico-Ativo {
  try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$porta/ping").StatusCode -eq 200 } catch { return $false }
}
try {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop |
    Where-Object { $_.CommandLine -and $_.CommandLine -like '*salvador_pdf.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
} catch { Write-Host 'Nao consegui parar a versao anterior do servico (se estiver rodando, reinicie o Windows).' }
if (-not (Servico-Ativo)) {
  Start-Process -WindowStyle Hidden -FilePath $node -ArgumentList ('"' + (Join-Path $destino 'salvador_pdf.js') + '"') -WorkingDirectory $destino
  Start-Sleep -Seconds 2
}
if (Servico-Ativo) { Write-Host 'PRONTO: o servico esta ativo e vai iniciar sozinho com o Windows.' }
else { Write-Host 'Instalado, mas o servico nao respondeu agora. Reinicie o Windows e teste de novo.' }
if (-not (Test-Path (Join-Path $destino 'sefaz.config.json'))) {
  Write-Host "Notas de compra pela SEFAZ: copie $destino\sefaz.config.exemplo.json para sefaz.config.json e preencha (veja docs\sefaz_configuracao.md)."
}
