# Instala o servico que grava os PDFs em C:\Programa Elegance\<pasta> e faz ele iniciar com o Windows.
# Rode uma vez em cada PC (de preferencia pelo instalar_salvador_pdf.bat, duplo clique). Nao precisa ser administrador,
# exceto se o Node.js ainda nao estiver instalado (o Windows pede a confirmacao uma vez).
$ErrorActionPreference = 'Stop'
$destino = 'C:\Programa Elegance\Servico'
$origem  = Join-Path $PSScriptRoot 'salvador_pdf.js'
$porta   = 3917

function Achar-Node {
  $c = Get-Command node -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

if (-not (Test-Path $origem)) { throw "Nao achei salvador_pdf.js ao lado deste instalador ($origem)." }

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

# 2) copia o servico para uma pasta fixa
New-Item -ItemType Directory -Force -Path $destino | Out-Null
Copy-Item -Force $origem (Join-Path $destino 'salvador_pdf.js')
Write-Host "Servico copiado para $destino"

# 3) inicio automatico com o Windows (pasta Inicializar do usuario, sem janela)
$inicio = [Environment]::GetFolderPath('Startup')
$vbs = Join-Path $inicio 'Elegance_Salvador_PDF.vbs'
$linha = 's.Run """' + $node + '"" ""' + (Join-Path $destino 'salvador_pdf.js') + '""", 0, False'
Set-Content -Path $vbs -Encoding ASCII -Value @('Set s = CreateObject("WScript.Shell")', $linha)
Write-Host "Inicio automatico criado: $vbs"

# 4) liga agora (se ainda nao estiver ligado)
function Servico-Ativo {
  try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$porta/ping").StatusCode -eq 200 } catch { return $false }
}
if (-not (Servico-Ativo)) {
  Start-Process -WindowStyle Hidden -FilePath $node -ArgumentList ('"' + (Join-Path $destino 'salvador_pdf.js') + '"')
  Start-Sleep -Seconds 2
}
if (Servico-Ativo) { Write-Host 'PRONTO: o servico esta ativo e vai iniciar sozinho com o Windows.' }
else { Write-Host 'Instalado, mas o servico nao respondeu agora. Reinicie o Windows e teste de novo.' }
