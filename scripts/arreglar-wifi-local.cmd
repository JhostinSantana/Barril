@echo off
chcp 65001 >nul
echo ============================================================
echo   ARREGLAR CONEXION LOCAL - Meseros y Cocina (sin tunel)
echo   Ejecutar como ADMINISTRADOR
echo ============================================================
echo.

net session >nul 2>&1
if errorlevel 1 (
  echo Clic derecho en este archivo - Ejecutar como administrador
  pause
  exit /b 1
)

echo [1] Red WiFi como PRIVADA...
powershell -NoProfile -Command "Get-NetConnectionProfile | Set-NetConnectionProfile -NetworkCategory Private"

echo [2] Firewall puerto 4000...
netsh advfirewall firewall delete rule name="Barril API 4000" >nul 2>&1
netsh advfirewall firewall add rule name="Barril API 4000" dir=in action=allow protocol=TCP localport=4000 profile=domain,private,public enable=yes
if exist "%ProgramFiles%\nodejs\node.exe" (
  netsh advfirewall firewall delete rule name="Barril Node 4000" >nul 2>&1
  netsh advfirewall firewall add rule name="Barril Node 4000" dir=in action=allow program="%ProgramFiles%\nodejs\node.exe" profile=domain,private,public enable=yes
)

echo [3] Descubrimiento de red en Windows (permite LAN entre dispositivos)...
netsh advfirewall firewall set rule group="Network Discovery" new enable=Yes profile=private >nul 2>&1
netsh advfirewall firewall set rule group="Archivos e impresoras compartidos" new enable=Yes profile=private >nul 2>&1
netsh advfirewall firewall set rule group="File and Printer Sharing" new enable=Yes profile=private >nul 2>&1

echo.
echo [4] IPs de ESTA laptop - usa la de Wi-Fi para meseros/cocina:
echo.
ipconfig | findstr /i "adaptador IPv4"
echo.
echo IMPORTANTE:
echo - La laptop debe estar en Wi-Fi (no solo cable), igual que los celulares.
echo - En el celular: Ajustes - Wi-Fi - DNS privado = DESACTIVADO.
echo - Reinicia Barril: npm run dev:hub
echo - Prueba en celular: http://IP_WIFI:4000/health
echo.
pause
