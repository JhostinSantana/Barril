@echo off
setlocal
cd /d "%~dp0"

:: Si no es admin, volver a abrir este mismo archivo como administrador (solo una vez).
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo [Barril] Abriendo red local para meseros y cocina...
powershell -NoProfile -Command "Get-NetConnectionProfile | Set-NetConnectionProfile -NetworkCategory Private" 2>nul
netsh advfirewall firewall delete rule name="Barril API 4000" >nul 2>&1
netsh advfirewall firewall add rule name="Barril API 4000" dir=in action=allow protocol=TCP localport=4000 profile=domain,private,public enable=yes
if exist "%ProgramFiles%\nodejs\node.exe" (
  netsh advfirewall firewall delete rule name="Barril Node 4000" >nul 2>&1
  netsh advfirewall firewall add rule name="Barril Node 4000" dir=in action=allow program="%ProgramFiles%\nodejs\node.exe" profile=domain,private,public enable=yes
)

start "Barril API" cmd /k "cd /d %~dp0 && npm run dev:server"
timeout /t 3 /nobreak >nul
start "Barril Laptop" cmd /k "cd /d %~dp0 && npm run dev:laptop"
timeout /t 4 /nobreak >nul
start "" "http://localhost:5173/Barril/"
endlocal
