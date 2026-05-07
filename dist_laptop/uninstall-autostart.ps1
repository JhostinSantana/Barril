$taskName = "BarrilHubAutoStart"

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "Tarea '$taskName' eliminada."
} else {
  Write-Host "La tarea '$taskName' no existe."
}
