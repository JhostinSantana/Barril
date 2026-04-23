@echo off
setlocal
start "Barril API" cmd /k "cd /d %~dp0 && npm run dev:server"
start "Barril Laptop" cmd /k "cd /d %~dp0 && npm run dev:laptop"
endlocal
