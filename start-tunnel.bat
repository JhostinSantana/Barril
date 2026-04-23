@echo off
setlocal
cloudflared tunnel --url http://localhost:4000
endlocal
