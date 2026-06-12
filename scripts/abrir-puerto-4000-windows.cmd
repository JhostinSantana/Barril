@echo off
echo Abriendo puerto 4000 para meseros y cocina (todos los perfiles de red)...
netsh advfirewall firewall delete rule name="Barril API 4000" >nul 2>&1
netsh advfirewall firewall delete rule name="Barril Node 4000" >nul 2>&1

netsh advfirewall firewall add rule name="Barril API 4000" dir=in action=allow protocol=TCP localport=4000 profile=any enable=yes
netsh advfirewall firewall add rule name="Barril Node 4000" dir=in action=allow program="%ProgramFiles%\nodejs\node.exe" profile=any enable=yes

if %errorlevel%==0 (
  echo.
  echo Listo. Reinicia Barril: npm run dev:hub
  echo Prueba EN ESTA LAPTOP: http://TU_IP_WIFI:4000/health
  echo Luego prueba en el celular con la misma URL.
) else (
  echo No se pudo crear la regla. Ejecuta como Administrador.
)
pause
