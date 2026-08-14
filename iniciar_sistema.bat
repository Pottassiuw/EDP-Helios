@echo off
:: =======================================================================
:: EDP Verify - Script de Inicializacao Automatizado
:: =======================================================================
chcp 65001 > nul
title EDP Verify - De olho no Problema

setlocal enabledelayedexpansion

set "PROJECT_ROOT=%~dp0"
cd /d "%PROJECT_ROOT%"

:: Adiciona caminhos do Node.js e FNM ao PATH da sessao caso necessario
if exist "%USERPROFILE%\Node" set "PATH=%USERPROFILE%\Node;!PATH!"
if exist "%USERPROFILE%\AppData\Roaming\fnm\current" set "PATH=%USERPROFILE%\AppData\Roaming\fnm\current;!PATH!"
if exist "%USERPROFILE%\Node\fnm.exe" (
    for /f "tokens=*" %%i in ('"%USERPROFILE%\Node\fnm.exe" env --shell cmd') do %%i
)

:: Identifica o executavel do Python pelo caminho absoluto
if exist "%PROJECT_ROOT%backend\.venv\Scripts\python.exe" (
    set "PYTHON_EXE=%PROJECT_ROOT%backend\.venv\Scripts\python.exe"
) else if exist "%PROJECT_ROOT%.venv\Scripts\python.exe" (
    set "PYTHON_EXE=%PROJECT_ROOT%.venv\Scripts\python.exe"
) else (
    set "PYTHON_EXE=python"
)

echo =======================================================================
echo                 EDP VERIFY - DE OLHO NO PROBLEMA
echo =======================================================================
echo.
echo  [1] Iniciar Sistema (Recomendado - http://localhost:8000)
echo  [2] Iniciar Modo Desenvolvedor (Backend :8000 + Frontend Vite :5173)
echo  [3] Recompilar Frontend (npm run build)
echo  [4] Sair
echo.
echo =======================================================================

choice /C 1234 /T 5 /D 1 /M "Selecione uma opcao (Iniciando modo padrao em 5s):"

if errorlevel 4 goto SAIR
if errorlevel 3 goto REBUILD
if errorlevel 2 goto DEV_MODE
if errorlevel 1 goto PROD_MODE

:PROD_MODE
cls
echo.
echo [1/2] Compilando arquivos do Frontend (dist)...
cd /d "%PROJECT_ROOT%frontend"
call npm run build

echo [2/2] Iniciando o servidor EDP Verify (Backend + Frontend)...
echo.
echo -----------------------------------------------------------------------
echo  O sistema abrira automaticamente no navegador: http://localhost:8000
echo  Para encerrar o sistema, feche esta janela ou pressione Ctrl+C.
echo -----------------------------------------------------------------------
echo.

start "" "http://localhost:8000"

cd /d "%PROJECT_ROOT%backend"
"!PYTHON_EXE!" -m uvicorn main:app --host 127.0.0.1 --port 8000
goto FIM

:DEV_MODE
cls
echo.
echo =======================================================================
echo                   INICIANDO MODO DESENVOLVEDOR
echo =======================================================================
echo.

echo [1/2] Iniciando Backend FastAPI em segundo plano (:8000)...
start "EDP Verify - Backend" cmd /k "cd /d "%PROJECT_ROOT%backend" && "!PYTHON_EXE!" -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload"

echo [2/2] Iniciando Frontend Vite (:5173)...
start "EDP Verify - Frontend Vite" cmd /k "cd /d "%PROJECT_ROOT%frontend" && npm run dev"

echo.
echo Servidores iniciados em janelas separadas!
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:5173
echo.
goto FIM

:REBUILD
cls
echo.
echo Recompilando o frontend React...
echo.
cd /d "%PROJECT_ROOT%frontend"
call npm run build
echo.
echo Build concluido com sucesso!
echo.
pause
goto PROD_MODE

:SAIR
exit /b 0

:FIM
pause
