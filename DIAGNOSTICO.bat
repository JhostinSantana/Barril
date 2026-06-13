@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo ============================================================
echo   DIAGNOSTICO BARRIL - Por que no conectan los celulares
echo ============================================================
echo.

echo [A] Perfil de red Windows (debe decir Privada):
powershell -NoProfile -Command "Get-NetConnectionProfile | Format-Table Name, NetworkCategory, InterfaceAlias -AutoSize"
echo.

echo [B] IPs de esta laptop:
ipconfig | findstr /i /c:"adaptador" /c:"IPv4"
echo.

echo [C] Procesos Node corriendo (debe haber maximo 2 al usar Barril):
tasklist | findstr /i node.exe
echo.

echo [D] Puerto 4000 - quien escucha:
netstat -ano | findstr ":4000"
echo.

echo [E] Reglas firewall Barril:
netsh advfirewall firewall show rule name="Barril API 4000" verbose
echo.

echo [F] Prueba servidor en ESTA laptop:
curl -s -m 3 http://127.0.0.1:4000/health
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do (
    echo Probando http://%%b:4000/health
    curl -s -m 3 http://%%b:4000/health
    echo.
  )
)

echo.
echo ============================================================
echo   QUE REVISAR EN EL CELULAR
echo ============================================================
echo.
echo 1. WiFi conectada a la MISMA red: Jael_la_bestia-2.4G
echo    (no otra banda 5G si el router las separa)
echo 2. Datos moviles APAGADOS
echo 3. Chrome: http://192.168.100.17:4000/health
echo.
echo Si [F] funciona aqui pero el celular NO:
echo   - Router bloquea dispositivos entre si (aislamiento AP)
echo   - O WiFi en Windows esta como PUBLICA arriba en [A]
echo.
echo SOLUCION RAPIDA:
echo   1. Cierra TODAS las ventanas Node (Ctrl+C)
echo   2. Clic derecho INSTALAR.bat - Ejecutar como administrador
echo   3. En Windows: WiFi Jael_la_bestia - Perfil de red - PRIVADA
echo.
pause
