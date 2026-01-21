@echo off
cd /d "%~dp0"
start "Raffaello" cmd /c "cd /d %~dp0 && npm start"