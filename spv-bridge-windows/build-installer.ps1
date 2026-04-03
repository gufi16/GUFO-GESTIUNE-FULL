$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$releaseScript = Join-Path $scriptDir "build-release.ps1"
$issPath = Join-Path $scriptDir "installer\GufoEFactura.iss"
$brandingIcon = Join-Path $scriptDir "branding\gufo-efactura.ico"

if (-not (Test-Path $brandingIcon)) {
  throw "Lipseste branding\gufo-efactura.ico. Pune iconul in format .ico in acest folder inainte de build."
}

& powershell -ExecutionPolicy Bypass -File $releaseScript

$candidates = @(
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles}\Inno Setup 6\ISCC.exe"
)

$iscc = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $iscc) {
  Write-Host ""
  Write-Host "Release folder pregatit, dar Inno Setup nu este instalat." -ForegroundColor Yellow
  Write-Host "Instaleaza Inno Setup 6 si ruleaza din nou acest script."
  Write-Host "Script Inno: $issPath"
  exit 0
}

& $iscc $issPath

Write-Host ""
Write-Host "Installerul Gufo e-Factura a fost generat." -ForegroundColor Green
Write-Host "Folder output: $(Join-Path $scriptDir 'release')"
