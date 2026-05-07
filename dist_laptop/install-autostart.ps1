$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$runnerScript = Join-Path $projectRoot "start-hub-silent.ps1"
$taskName = "BarrilHubAutoStart"

if (-not (Test-Path $runnerScript)) {
  Write-Error "No se encontro start-hub-silent.ps1 en $projectRoot"
  exit 1
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runnerScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel LeastPrivilege

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null

Write-Host "Tarea '$taskName' instalada."
Write-Host "El hub iniciara automaticamente al encender e iniciar sesion en Windows."
