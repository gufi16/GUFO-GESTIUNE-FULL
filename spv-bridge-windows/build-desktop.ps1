$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Set-Location $scriptDir

function Test-IcoFile {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return $false
  }

  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -lt 4) {
    return $false
  }

  return ($bytes[0] -eq 0 -and $bytes[1] -eq 0 -and $bytes[2] -eq 1 -and $bytes[3] -eq 0)
}

if (-not (Test-Path (Join-Path $scriptDir "node_modules\electron"))) {
  throw "Lipsesc dependintele desktop. Ruleaza mai intai 'npm install' in spv-bridge-windows."
}

$iconPath = Join-Path $scriptDir "branding\gufo-efactura.ico"
$iconArg = @()

if (Test-IcoFile $iconPath) {
  $iconArg = @("--icon=$iconPath")
} elseif (Test-Path $iconPath) {
  Write-Warning "branding\gufo-efactura.ico exista, dar nu este un icon Windows valid. Continui buildul desktop fara icon personalizat."
} else {
  Write-Warning "Lipseste branding\gufo-efactura.ico. Continui buildul desktop fara icon personalizat."
}

Write-Host ""
Write-Host "Build desktop Gufo e-Factura..." -ForegroundColor Cyan
& ".\node_modules\.bin\electron-packager.cmd" `
  "." `
  "Gufo e-Factura" `
  "--platform=win32" `
  "--arch=x64" `
  "--out=release-desktop" `
  "--overwrite" `
  "--asar" `
  "--prune=true" `
  "--ignore=release" `
  "--ignore=release-desktop" `
  "--ignore=installer" `
  "--ignore=agent\.stdout\.log" `
  "--ignore=agent\.stderr\.log" `
  @iconArg

if ($LASTEXITCODE -ne 0) {
  throw "Buildul desktop Gufo e-Factura a esuat."
}

Write-Host ""
Write-Host "Build desktop finalizat." -ForegroundColor Green
Write-Host "Folder output: $(Join-Path $scriptDir 'release-desktop')"
