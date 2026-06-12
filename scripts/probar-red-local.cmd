@echo off
chcp 65001 >nul
echo === DIAGNOSTICO RED BARRIL ===
echo.

echo [1] IP de esta laptop:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo   %%a
echo.

echo [2] Puerto 4000 escuchando:
netstat -an | findstr ":4000"
echo.

echo [3] Prueba local health:
curl -s http://127.0.0.1:4000/health
echo.
echo.

echo [4] Prueba por IP LAN (cambia la IP si hace falta):
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  set "IP=%%a"
  goto :testlan
)
:testlan
for /f "tokens=* delims= " %%b in ("%IP%") do set "IP=%%b"
echo   http://%IP%:4000/health
curl -s http://%IP%:4000/health
echo.
echo.
echo Si [3] funciona pero el celular no: WiFi distinta o router con aislamiento.
echo Si [4] falla en la laptop: firewall o servidor mal arrancado.
pause
