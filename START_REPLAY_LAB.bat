@echo off
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 launch_replay_lab.py
) else (
  python launch_replay_lab.py
)
pause
