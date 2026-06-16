@echo off
cd /d "%~dp0"
echo Starting StepWong Web...
start "StepWong Web" cmd /k "python app.py"
timeout /t 2 >nul
echo Done! Open http://127.0.0.1:5800 in your browser
pause
