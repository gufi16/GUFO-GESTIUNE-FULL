$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$desktopOutputRoot = Join-Path $scriptDir "release-desktop"
$desktopOutputDir = Join-Path $desktopOutputRoot $timestamp
$desktopInstallerOutputDir = Join-Path $desktopOutputRoot "installer"
$desktopInstallerIss = Join-Path $scriptDir "installer\GufoEFacturaDesktop.iss"

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
New-Item -ItemType Directory -Force -Path $desktopOutputDir | Out-Null
& ".\node_modules\.bin\electron-packager.cmd" `
  "." `
  "Gufo e-Factura" `
  "--platform=win32" `
  "--arch=x64" `
  "--out=$desktopOutputDir" `
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

$desktopAppDir = Join-Path $desktopOutputDir "Gufo e-Factura-win32-x64"

if (-not (Test-Path $desktopAppDir)) {
  throw "Nu am gasit folderul aplicatiei desktop generate."
}

function Find-InnoCompiler {
  $candidates = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
    "${env:LOCALAPPDATA}\Programs\Inno Setup 6\ISCC.exe"
  )

  $found = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($found) {
    return $found
  }

  $registryKeys = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )

  foreach ($key in $registryKeys) {
    $entry = Get-ItemProperty $key -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -like "*Inno Setup*" } |
      Select-Object -First 1

    if (-not $entry) {
      continue
    }

    $installLocation = if ($null -ne $entry.InstallLocation) { [string]$entry.InstallLocation } else { "" }
    $displayIcon = if ($null -ne $entry.DisplayIcon) { [string]$entry.DisplayIcon } else { "" }
    $fromLocation = if ($installLocation) { Join-Path $installLocation "ISCC.exe" } else { "" }

    if ($fromLocation -and (Test-Path $fromLocation)) {
      return $fromLocation
    }

    if ($displayIcon -and (Test-Path $displayIcon)) {
      return $displayIcon
    }
  }

  return $null
}

$iscc = Find-InnoCompiler

if ($iscc) {
  New-Item -ItemType Directory -Force -Path $desktopInstallerOutputDir | Out-Null
  $env:DesktopReleaseSource = $desktopAppDir
  $env:DesktopInstallerOutputDir = $desktopInstallerOutputDir
  $env:DesktopInstallerBaseName = "Gufo-eFactura-Setup-$timestamp"
  $env:DesktopSetupIcon = if (Test-IcoFile $iconPath) { $iconPath } else { "" }

  $null = & $iscc $desktopInstallerIss
  if ($LASTEXITCODE -ne 0) {
    throw "Buildul installerului desktop Gufo e-Factura a esuat."
  }

  Write-Host "Installer output: $(Join-Path $desktopInstallerOutputDir ($env:DesktopInstallerBaseName + '.exe'))"
} else {
  Write-Host "Installer desktop: Inno Setup nu este instalat, am generat doar folderul aplicatiei." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Build desktop finalizat." -ForegroundColor Green
Write-Host "Folder output: $desktopOutputDir"
