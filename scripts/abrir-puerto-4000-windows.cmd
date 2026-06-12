@echo off
echo Abriendo puerto 4000 para meseros y cocina en esta laptop...
netsh advfirewall firewall delete rule name="Barril API 4000" >nul 2>&1
netsh advfirewall firewall add rule name="Barril API 4000" dir=in action=allow protocol=TCP localport=4000
if %errorlevel%==0 (
  echo Listo. Reinicia Barril con npm run dev:hub
) else (
  echo No se pudo crear la regla. Ejecuta este archivo como Administrador.
)
pause
