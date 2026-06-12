@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

echo ============================================================
echo   INSTALADOR BARRIL - Laptop de produccion (Portoviejo/Chone)
echo ============================================================
echo.

set "INSTALL_DIR=C:\Barril"
set "REPO=https://github.com/JhostinSantana/Barril.git"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado.
  echo Descarga desde https://nodejs.org e instala la version LTS.
  pause
  exit /b 1
)

where git >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git no esta instalado.
  echo Descarga desde https://git-scm.com/download/win
  pause
  exit /b 1
)

echo [1/7] Carpeta de instalacion: %INSTALL_DIR%
if not exist "%INSTALL_DIR%" (
  echo Clonando repositorio...
  git clone "%REPO%" "%INSTALL_DIR%"
  if errorlevel 1 (
    echo [ERROR] No se pudo clonar. Revisa internet.
    pause
    exit /b 1
  )
) else (
  echo Actualizando codigo existente...
  pushd "%INSTALL_DIR%"
  git pull origin master
  if errorlevel 1 (
    echo [AVISO] git pull fallo. Continuando con la copia local...
  )
  popd
)

echo.
echo [2/7] Instalando dependencias (puede tardar varios minutos)...
pushd "%INSTALL_DIR%"
call npm install
if errorlevel 1 (
  echo [ERROR] npm install fallo.
  pause
  exit /b 1
)
popd

echo.
echo [3/7] Abriendo puerto 4000 en el firewall (meseros + cocina)...
netsh advfirewall firewall delete rule name="Barril API 4000" >nul 2>&1
netsh advfirewall firewall add rule name="Barril API 4000" dir=in action=allow protocol=TCP localport=4000
if errorlevel 1 (
  echo [AVISO] No se pudo crear la regla de firewall.
  echo Ejecuta este archivo como Administrador: clic derecho -^> Ejecutar como administrador
) else (
  echo Firewall OK - puerto 4000 abierto.
)

echo.
echo [4/7] Archivo .env del tunel (panel del dueno)...
set "ENV_FILE=%INSTALL_DIR%\apps\server\.env"
if not exist "%ENV_FILE%" (
  (
    echo GITHUB_TUNNEL_GIST_ID=f2ce64f6b6c35caafac2dfbc99c45677
    echo GITHUB_TUNNEL_GIST_TOKEN=PEGA_AQUI_TU_TOKEN
    echo TUNNEL_REGISTRY_PUBLIC_URL=https://gist.githubusercontent.com/JhostinSantana/f2ce64f6b6c35caafac2dfbc99c45677/raw/barril-tunnel-urls.json
    echo BARRIL_AUTO_START_TUNNEL=1
  ) > "%ENV_FILE%"
  echo Creado %ENV_FILE%
  echo IMPORTANTE: Abre ese archivo y cambia PEGA_AQUI_TU_TOKEN por tu token de GitHub.
) else (
  echo Ya existe %ENV_FILE% - no se sobrescribio.
)

echo.
echo [5/7] Acceso directo en el Escritorio...
set "DESKTOP=%USERPROFILE%\Desktop"
set "SHORTCUT=%DESKTOP%\Iniciar Barril.bat"
(
  echo @echo off
  echo cd /d "%INSTALL_DIR%"
  echo start "Barril API" cmd /k npm run dev:server
  echo timeout /t 3 /nobreak ^>nul
  echo start "Barril Laptop" cmd /k npm run dev:laptop
  echo start "" "http://localhost:5173/Barril/"
) > "%SHORTCUT%"
echo Creado: %SHORTCUT%

echo.
echo [6/7] Arranque automatico al encender Windows (opcional)...
choice /C SN /M "Instalar arranque automatico al iniciar sesion"
if errorlevel 2 goto SKIP_AUTOSTART
pushd "%INSTALL_DIR%"
call install-autostart.bat
popd
:SKIP_AUTOSTART

echo.
echo [7/7] Iniciando Barril ahora...
pushd "%INSTALL_DIR%"
start "Barril API" cmd /k npm run dev:server
timeout /t 4 /nobreak >nul
start "Barril Laptop" cmd /k npm run dev:laptop
timeout /t 5 /nobreak >nul
start "" "http://localhost:5173/Barril/"
popd

echo.
echo ============================================================
echo   INSTALACION TERMINADA
echo ============================================================
echo.
echo AHORA EN EL NAVEGADOR:
echo   1. Ve a Conectividad
echo   2. Elige la sede (Portoviejo o Chone)
echo   3. Clic en Confirmar sede
echo   4. Espera Tunel: Activo y Registro GitHub activo
echo.
echo MESEROS Y COCINA:
echo   - Misma WiFi que la laptop
echo   - Escanean el QR de Conectividad
echo   - O escriben manualmente la URL local que muestra la pantalla
echo.
echo PRUEBA RAPIDA desde un celular:
echo   http://TU_IP_WIFI:4000/health
echo   (debe mostrar ok:true)
echo.
echo Panel caja: http://localhost:5173/Barril/
echo Carpeta:    %INSTALL_DIR%
echo.
pause
