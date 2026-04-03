$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Set-Location $scriptDir

if (-not (Test-Path (Join-Path $scriptDir "node_modules\electron"))) {
  throw "Lipsesc dependintele desktop. Ruleaza mai intai 'npm install' in spv-bridge-windows."
}

if (-not (Test-Path (Join-Path $scriptDir "branding\gufo-efactura.ico"))) {
  throw "Lipseste branding\gufo-efactura.ico pentru buildul desktop."
}

Write-Host ""
Write-Host "Build desktop Gufo e-Factura..." -ForegroundColor Cyan
cmd /c npm run desktop:dist

if ($LASTEXITCODE -ne 0) {
  throw "Buildul desktop Gufo e-Factura a esuat."
}

Write-Host ""
Write-Host "Build desktop finalizat." -ForegroundColor Green
Write-Host "Folder output: $(Join-Path $scriptDir 'release-desktop')"
