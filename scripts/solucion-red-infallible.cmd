@echo off
chcp 65001 >nul
echo ============================================================
echo   SOLUCION RED BARRIL - Meseros y Cocina
echo   Ejecutar como ADMINISTRADOR
echo ============================================================
echo.

net session >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Abre este archivo con clic derecho - Ejecutar como administrador
  pause
  exit /b 1
)

echo [1/4] WiFi como red PRIVADA (Windows deja pasar conexiones)...
powershell -NoProfile -Command "Get-NetConnectionProfile | Set-NetConnectionProfile -NetworkCategory Private" 2>nul
echo Hecho.

echo.
echo [2/4] Reglas de firewall para puerto 4000...
netsh advfirewall firewall delete rule name="Barril API 4000" >nul 2>&1
netsh advfirewall firewall delete rule name="Barril Node 4000" >nul 2>&1
netsh advfirewall firewall add rule name="Barril API 4000" dir=in action=allow protocol=TCP localport=4000 profile=domain,private,public enable=yes
if exist "%ProgramFiles%\nodejs\node.exe" (
  netsh advfirewall firewall add rule name="Barril Node 4000" dir=in action=allow program="%ProgramFiles%\nodejs\node.exe" profile=domain,private,public enable=yes
)
echo Hecho.

echo.
echo [3/4] Comprobando que el servidor escucha en 4000...
netstat -an | findstr ":4000.*LISTENING"
if errorlevel 1 (
  echo [AVISO] No hay nada escuchando en 4000. Primero ejecuta: npm run dev:hub
) else (
  echo Puerto 4000 activo.
)

echo.
echo [4/4] IP de esta laptop para meseros/cocina:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do echo   http://%%b:4000
)

echo.
echo ============================================================
echo   PRUEBA EN EL CELULAR (misma WiFi, datos apagados):
echo   http://TU_IP:4000/health
echo   Debe salir: {"ok":true,...}
echo.
echo   Si NO carga - PLAN B infalible:
echo   En Conectividad copia la URL del tunel (https://....trycloudflare.com)
echo   y pegala en mesero/cocina en lugar de la IP local.
echo ============================================================
pause
