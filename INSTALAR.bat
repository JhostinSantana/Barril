@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

:: Pedir permisos de administrador (firewall + red local).
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo.
echo ============================================================
echo   INSTALADOR BARRIL - Descarga ZIP desde GitHub
echo   Carpeta: %~dp0
echo ============================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Instala Node.js LTS desde https://nodejs.org
  echo Luego vuelve a ejecutar INSTALAR.bat
  pause
  exit /b 1
)

echo [1/5] Instalando dependencias (5-10 min la primera vez)...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install fallo.
  pause
  exit /b 1
)
echo OK.

echo.
echo [2/5] Red local para meseros y cocina (firewall)...
powershell -NoProfile -Command "Get-NetConnectionProfile | Set-NetConnectionProfile -NetworkCategory Private" 2>nul
netsh advfirewall firewall delete rule name="Barril API 4000" >nul 2>&1
netsh advfirewall firewall add rule name="Barril API 4000" dir=in action=allow protocol=TCP localport=4000 profile=domain,private,public enable=yes
if exist "%ProgramFiles%\nodejs\node.exe" (
  netsh advfirewall firewall delete rule name="Barril Node 4000" >nul 2>&1
  netsh advfirewall firewall add rule name="Barril Node 4000" dir=in action=allow program="%ProgramFiles%\nodejs\node.exe" profile=domain,private,public enable=yes
)
netsh advfirewall firewall set rule group="Network Discovery" new enable=Yes profile=private >nul 2>&1
echo OK.

echo.
echo [3/5] Archivo .env (panel del dueno - opcional)...
set "ENV_FILE=%~dp0apps\server\.env"
if not exist "%ENV_FILE%" (
  (
    echo GITHUB_TUNNEL_GIST_ID=f2ce64f6b6c35caafac2dfbc99c45677
    echo GITHUB_TUNNEL_GIST_TOKEN=PEGA_AQUI_TU_TOKEN
    echo TUNNEL_REGISTRY_PUBLIC_URL=https://gist.githubusercontent.com/JhostinSantana/f2ce64f6b6c35caafac2dfbc99c45677/raw/barril-tunnel-urls.json
    echo BARRIL_AUTO_START_TUNNEL=0
  ) > "%ENV_FILE%"
  echo Creado apps\server\.env
  echo Cambia PEGA_AQUI_TU_TOKEN si quieres el panel del dueno en el celular.
) else (
  echo Ya existe apps\server\.env - no se modifico.
)

echo.
echo [4/5] Acceso directo en el Escritorio...
set "DESKTOP=%USERPROFILE%\Desktop"
(
  echo @echo off
  echo cd /d "%~dp0"
  echo call start-hub-produccion.bat
) > "%DESKTOP%\Iniciar Barril.bat"
echo Creado: Iniciar Barril.bat

echo.
echo [5/5] Arranque automatico al encender Windows...
choice /C SN /M "Instalar arranque automatico"
if not errorlevel 2 call "%~dp0install-autostart.bat"

echo.
echo ============================================================
echo   INSTALACION LISTA
echo ============================================================
echo.
echo 1. Se abrira Barril ahora.
echo 2. En el navegador: Conectividad -^> elige sede -^> Confirmar sede
echo 3. Meseros/cocina: escanean el QR o usan la URL local
echo 4. Prueba en celular: http://IP_WIFI:4000/health
echo.
echo Cada dia: doble clic en "Iniciar Barril" del Escritorio.
echo.
pause

call "%~dp0start-hub-produccion.bat"
