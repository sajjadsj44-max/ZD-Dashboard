@echo off
rem AutoCAD helper for PDF Takeoff: set it up on this computer (double-click). It then starts with Windows, and the takeoff
rem starts it itself when it is not running. "cad-bridge-setup.cmd -Remove" takes it away again. See cad-bridge-setup.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cad-bridge-setup.ps1" %*
echo.
pause
