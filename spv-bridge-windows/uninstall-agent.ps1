$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$taskName = "Gufo SPV Agent"
$launcherPath = Join-Path $scriptDir "bridge-launcher.vbs"

try {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null
} catch {
}

try {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
} catch {
}

if (Test-Path $launcherPath) {
  Remove-Item $launcherPath -Force
}

Write-Host "Gufo SPV Agent a fost dezinstalat." -ForegroundColor Yellow
