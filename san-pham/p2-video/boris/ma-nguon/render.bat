@echo off
rem Double-click to render the showreel (music + 1080x1920 60fps MP4) into the "out" folder.
cd /d "%~dp0reel"
python render.py %*
echo.
echo Xong! Video nam trong thu muc "out".
pause
