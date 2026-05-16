@echo off
setlocal

set "ROOT_DIR=%~dp0"
set "ANDROID_DIR=%ROOT_DIR%apps\CocinaNative\android"
set "APK_PATH=%ANDROID_DIR%\app\build\outputs\apk\release\app-release.apk"

if not exist "%ANDROID_DIR%\gradlew.bat" (
  echo No se encontro gradlew.bat en "%ANDROID_DIR%".
  exit /b 1
)

cd /d "%ANDROID_DIR%"
call .\gradlew.bat assembleRelease
if errorlevel 1 (
  echo.
  echo La compilacion fallo.
  exit /b 1
)

echo.
echo APK generado correctamente.
echo Ruta: %APK_PATH%

endlocal