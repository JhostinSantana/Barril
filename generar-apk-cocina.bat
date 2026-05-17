@echo off
setlocal

set "ROOT_DIR=%~dp0"
set "ANDROID_DIR=%ROOT_DIR%apps\CocinaNative\android"
set "APK_PATH=%ANDROID_DIR%\app\build\outputs\apk\release\app-release.apk"
set "LOG_FILE=%ROOT_DIR%cocina-build.log"

title Generar APK Cocina

echo.
echo Generando APK de CocinaNative...
echo Log: %LOG_FILE%
echo.

if not exist "%ANDROID_DIR%\gradlew.bat" (
  echo No se encontro gradlew.bat en "%ANDROID_DIR%".
  pause
  exit /b 1
)

echo [1/2] npm install...
cd /d "%ROOT_DIR%"
call npm install >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo Fallo npm install. Revisa %LOG_FILE%
  pause
  exit /b 1
)

echo [2/2] gradlew assembleRelease...
cd /d "%ANDROID_DIR%"
call .\gradlew.bat assembleRelease --no-daemon >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo.
  echo La compilacion fallo. Ultimas lineas del log:
  powershell -NoProfile -Command "Get-Content -LiteralPath '%LOG_FILE%' -Tail 30"
  echo.
  echo Log completo: %LOG_FILE%
  pause
  exit /b 1
)

echo.
echo APK generada correctamente.
echo %APK_PATH%
echo.
pause
