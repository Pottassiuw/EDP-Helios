@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "PYTHON_EXE="
if exist "%~dp0.venv\Scripts\python.exe" set "PYTHON_EXE=%~dp0.venv\Scripts\python.exe"
if not defined PYTHON_EXE if exist "%~dp0venv\Scripts\python.exe" set "PYTHON_EXE=%~dp0venv\Scripts\python.exe"
if not defined PYTHON_EXE if exist "%~dp0..\.venv\Scripts\python.exe" set "PYTHON_EXE=%~dp0..\.venv\Scripts\python.exe"

if not defined PYTHON_EXE (
    echo [ERRO] Ambiente virtual .venv nao encontrado no backend. Rode primeiro:
    echo     python -m venv .venv
    echo     .venv\Scripts\python.exe -m pip install -r requirements-sap-robot.txt
    pause
    exit /b 1
)

set PYTHONIOENCODING=utf-8
"!PYTHON_EXE!" "%~dp0Sap_Robot.py" %*

echo.
echo --- Robo finalizado (codigo de saida: !ERRORLEVEL!) ---
pause
