@echo off
echo Cerrando procesos Barril/Node anteriores...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul
echo Listo. Ahora ejecuta INSTALAR.bat o Iniciar Barril.bat
pause
