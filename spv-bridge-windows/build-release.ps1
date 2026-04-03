$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$releaseRoot = Join-Path $scriptDir "release"
$appDir = Join-Path $releaseRoot "Gufo e-Factura"

if (Test-Path $appDir) {
  Remove-Item $appDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $appDir | Out-Null

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

$brandingDir = Join-Path $scriptDir "branding"
if (Test-Path $brandingDir) {
  Copy-Item $brandingDir (Join-Path $appDir "branding") -Recurse -Force
}

Write-Host ""
Write-Host "Release folder pregatit:" -ForegroundColor Green
Write-Host $appDir
Write-Host ""
Write-Host "Pasul urmator: impachetare installer sau arhiva."
