$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$releaseScript = Join-Path $scriptDir "build-release.ps1"
$issPath = Join-Path $scriptDir "installer\GufoEFactura.iss"
$brandingIcon = Join-Path $scriptDir "branding\gufo-efactura.ico"
$setupIcon = Join-Path $scriptDir "branding\gufo-efactura-setup.ico"

if (-not (Test-Path $brandingIcon)) {
  throw "Lipseste branding\gufo-efactura.ico. Pune iconul in format .ico in acest folder inainte de build."
}

Add-Type -AssemblyName System.Drawing

function New-OptimizedSetupIcon {
  param(
    [string]$SourcePath,
    [string]$OutputPath
  )

  $image = [System.Drawing.Image]::FromFile($SourcePath)
  try {
    $bitmap = New-Object System.Drawing.Bitmap 256, 256
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($image, 0, 0, 256, 256)
      } finally {
        $graphics.Dispose()
      }

      $pngStream = New-Object System.IO.MemoryStream
      try {
        $bitmap.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
        $pngBytes = $pngStream.ToArray()

        $fileStream = [System.IO.File]::Create($OutputPath)
        try {
          $writer = New-Object System.IO.BinaryWriter($fileStream)
          try {
            $writer.Write([UInt16]0)
            $writer.Write([UInt16]1)
            $writer.Write([UInt16]1)
            $writer.Write([byte]0)
            $writer.Write([byte]0)
            $writer.Write([byte]0)
            $writer.Write([byte]0)
            $writer.Write([UInt16]1)
            $writer.Write([UInt16]32)
            $writer.Write([UInt32]$pngBytes.Length)
            $writer.Write([UInt32]22)
            $writer.Write($pngBytes)
          } finally {
            $writer.Dispose()
          }
        } finally {
          $fileStream.Dispose()
        }
      } finally {
        $pngStream.Dispose()
      }
    } finally {
      $bitmap.Dispose()
    }
  } finally {
    $image.Dispose()
  }
}

New-OptimizedSetupIcon -SourcePath $brandingIcon -OutputPath $setupIcon

& powershell -ExecutionPolicy Bypass -File $releaseScript

$candidates = @(
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
  "${env:LOCALAPPDATA}\Programs\Inno Setup 6\ISCC.exe"
)

$iscc = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $iscc) {
  $registryKeys = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )

  foreach ($key in $registryKeys) {
    $entry = Get-ItemProperty $key -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -like "*Inno Setup*" } |
      Select-Object -First 1

    if ($entry) {
      $installLocation = ""
      $displayIcon = ""
      if ($null -ne $entry.InstallLocation) {
        $installLocation = [string]$entry.InstallLocation
      }
      if ($null -ne $entry.DisplayIcon) {
        $displayIcon = [string]$entry.DisplayIcon
      }

      $fromLocation = if ($installLocation) { Join-Path $installLocation "ISCC.exe" } else { "" }
      $fromIcon = $displayIcon
      if ((Test-Path $fromLocation)) {
        $iscc = $fromLocation
        break
      }
      if ($fromIcon -and (Test-Path $fromIcon)) {
        $iscc = $fromIcon
        break
      }
    }
  }
}

if (-not $iscc) {
  Write-Host ""
  Write-Host "Release folder pregatit, dar Inno Setup nu este instalat." -ForegroundColor Yellow
  Write-Host "Instaleaza Inno Setup 6 si ruleaza din nou acest script."
  Write-Host "Script Inno: $issPath"
  exit 0
}

$null = & $iscc $issPath
if ($LASTEXITCODE -ne 0) {
  throw "Build-ul installerului a esuat. Verifica erorile ISCC de mai sus."
}

Write-Host ""
Write-Host "Installerul Gufo e-Factura a fost generat." -ForegroundColor Green
Write-Host "Folder output: $(Join-Path $scriptDir 'release')"
