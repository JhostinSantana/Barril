@echo off
setlocal
cd /d %~dp0

echo ==============================================
echo  Asados en el Barril - Primera ejecucion
echo ==============================================
echo.
echo 1) Instalando dependencias de server y laptop...
call npm run setup
if errorlevel 1 (
  echo.
  echo Error instalando dependencias. Revisa internet y Node.js 20+.
  pause
  exit /b 1
)

echo.
echo 2) Iniciando API y panel de laptop...
call start-hub.bat

endlocal
