$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$releaseRoot = Join-Path $scriptDir "release"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$appDir = Join-Path $releaseRoot "Gufo e-Factura $timestamp"
$repoRoot = Split-Path -Parent $scriptDir
$vendorDir = Join-Path $appDir "vendor"
$nodeSource = (Get-Command node -ErrorAction Stop).Source
$admZipSource = Join-Path $repoRoot "backend\node_modules\adm-zip"

New-Item -ItemType Directory -Force -Path $appDir | Out-Null
New-Item -ItemType Directory -Force -Path $vendorDir | Out-Null

$files = @(
  "bridge.js",
  "package.json",
  ".env.example",
  "README.md",
  "install-agent.ps1",
  "start-agent.ps1",
  "uninstall-agent.ps1"
)

foreach ($file in $files) {
  Copy-Item (Join-Path $scriptDir $file) (Join-Path $appDir $file) -Force
}

Copy-Item $nodeSource (Join-Path $appDir "node.exe") -Force
Copy-Item $admZipSource (Join-Path $vendorDir "adm-zip") -Recurse -Force

$brandingDir = Join-Path $scriptDir "branding"
if (Test-Path $brandingDir) {
  Copy-Item $brandingDir (Join-Path $appDir "branding") -Recurse -Force
}

Write-Host ""
Write-Host "Release folder pregatit:" -ForegroundColor Green
Write-Host $appDir
Write-Host ""
Write-Host "Pasul urmator: impachetare installer sau arhiva."
