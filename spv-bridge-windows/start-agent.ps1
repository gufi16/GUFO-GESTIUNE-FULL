$ErrorActionPreference = "Stop"

$taskName = "Gufo e-Factura"

try {
  Start-ScheduledTask -TaskName $taskName
  Write-Host "Gufo e-Factura a fost pornit." -ForegroundColor Green
} catch {
  throw "Task-ul '$taskName' nu este instalat. Ruleaza mai intai .\install-agent.ps1"
}

Start-Sleep -Seconds 2

try {
  $health = Invoke-RestMethod -Method GET -Uri "http://127.0.0.1:48521/health"
  $health | Format-List
} catch {
  Write-Warning "Agentul a fost pornit, dar health check-ul nu a raspuns inca."
}
