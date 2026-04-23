$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$logsDir = Join-Path $projectRoot "logs"

if (-not (Test-Path $logsDir)) {
  New-Item -ItemType Directory -Path $logsDir | Out-Null
}

function Test-PortListening {
  param ([int]$Port)

  try {
    $result = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop | Select-Object -First 1
    return $null -ne $result
  } catch {
    return $false
  }
}

function Start-NpmScriptHidden {
  param (
    [string]$Script,
    [string]$LogFile
  )

  $command = "cd /d `"$projectRoot`" && npm run $Script >> `"$LogFile`" 2>&1"
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $command -WindowStyle Hidden
}

$serverLog = Join-Path $logsDir "server.log"
$laptopLog = Join-Path $logsDir "laptop.log"

if (-not (Test-PortListening -Port 4000)) {
  Start-NpmScriptHidden -Script "dev:server" -LogFile $serverLog
}

if (-not (Test-PortListening -Port 5173)) {
  Start-NpmScriptHidden -Script "dev:laptop" -LogFile $laptopLog
}
