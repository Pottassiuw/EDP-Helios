@echo off
:: =======================================================================
:: Helios - Script de Inicializacao Automatizado
:: =======================================================================
:: AVISO PARA OUTRAS IAs E MANTENEDORES:
:: - Nao altere, substitua ou remova executaveis do sistema.
:: - Nao altere Node, npm, FNM, suas versoes ou caminhos sem pedido explicito.
:: - O frontend deve usar exclusivamente Node/npm gerenciados pelo FNM.
:: - Nao instale outro Node/npm nem crie fallback para o executavel do sistema.
:: =======================================================================
chcp 65001 > nul
title Helios - A luz do seu setor

setlocal enabledelayedexpansion

set "PROJECT_ROOT=%~dp0"
cd /d "%PROJECT_ROOT%"

:: Inicializa o FNM antes de qualquer chamada ao Node/npm.
:: O npm correto vem da versao Node selecionada pelo FNM, nunca do PATH do Windows.
set "FNM_EXE="
if exist "%USERPROFILE%\Documents\fnm-windows\fnm.exe" set "FNM_EXE=%USERPROFILE%\Documents\fnm-windows\fnm.exe"
if not defined FNM_EXE if exist "%USERPROFILE%\AppData\Local\fnm\fnm.exe" set "FNM_EXE=%USERPROFILE%\AppData\Local\fnm\fnm.exe"
if not defined FNM_EXE (
    for /f "delims=" %%i in ('where fnm 2^>nul') do if not defined FNM_EXE set "FNM_EXE=%%i"
)
if not defined FNM_EXE (
    echo ERRO: FNM nao encontrado.
    echo Instale/configure o FNM em %%USERPROFILE%%\Documents\fnm-windows ou adicione-o ao PATH.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('"%FNM_EXE%" env --shell cmd') do %%i
if errorlevel 1 (
    echo ERRO: nao foi possivel inicializar o ambiente do FNM.
    pause
    exit /b 1
)

where node >nul 2>&1 || (
    echo ERRO: Node nao foi disponibilizado pelo FNM.
    pause
    exit /b 1
)
where npm >nul 2>&1 || (
    echo ERRO: npm nao foi disponibilizado pelo FNM.
    pause
    exit /b 1
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
echo                 Helios - A luz do seu setor
echo =======================================================================
echo  Node ativo: & node --version
echo  npm ativo:  & call npm --version
echo.
echo  [1] Produção (Backend + Frontend compilado - :6328)
echo  [2] Desenvolvimento (Backend :6328 + Frontend Vite :5173)
echo  [3] Build Frontend (npm run build, sem iniciar servidor)
echo  [4] Apenas Backend (com reload - :6328)
echo  [5] Sair
echo.
echo =======================================================================

choice /C 12345 /T 5 /D 1 /M "Selecione uma opcao (Iniciando modo padrao em 5s):"

if errorlevel 5 goto SAIR
if errorlevel 4 goto BACKEND_ONLY
if errorlevel 3 goto REBUILD
if errorlevel 2 goto DEV_MODE
if errorlevel 1 goto PROD_MODE

:PROD_MODE
cls
echo [1/2] Compilando a versao mais recente do Frontend (dist)...
cd /d "%PROJECT_ROOT%frontend"
call npm run build
if errorlevel 1 (
    echo.
    echo Build falhou. O servidor nao sera iniciado.
    pause
    goto FIM
)

echo [2/2] Iniciando o servidor EDP-Helios (Backend + Frontend)...
echo.
echo -----------------------------------------------------------------------
echo  O sistema abrira automaticamente no navegador: http://localhost:6328
echo  Para encerrar o sistema, feche esta janela ou pressione Ctrl+C.
echo -----------------------------------------------------------------------
echo.

start "" "http://localhost:6328"

cd /d "%PROJECT_ROOT%backend"
"!PYTHON_EXE!" -m uvicorn main:app --host 0.0.0.0 --port 6328
goto FIM

:DEV_MODE
cls
echo.
echo =======================================================================
echo                   INICIANDO MODO DESENVOLVEDOR
echo =======================================================================
echo.

echo [1/2] Iniciando Backend FastAPI em segundo plano (:6328)...
start "EDP-Helios - Backend" cmd /k "cd /d "%PROJECT_ROOT%backend" && "!PYTHON_EXE!" -m uvicorn main:app --host 0.0.0.0 --port 6328 --reload"

echo [2/2] Iniciando Frontend Vite (:5173)...
start "EDP-Helios - Frontend Vite" cmd /k "cd /d "%PROJECT_ROOT%frontend" && npm run dev"

echo.
echo Servidores iniciados em janelas separadas!
echo Backend:  http://localhost:6328
echo Frontend: http://localhost:5173
echo.
goto FIM

:BACKEND_ONLY
cls
echo.
echo =======================================================================
echo                    APENAS BACKEND (:6328)
echo =======================================================================
echo.
echo Backend FastAPI com reload. Pressione Ctrl+C para encerrar.
echo.
cd /d "%PROJECT_ROOT%backend"
"!PYTHON_EXE!" -m uvicorn main:app --host 0.0.0.0 --port 6328 --reload
goto FIM

:REBUILD
cls
echo.
echo Recompilando o frontend React...
echo.
cd /d "%PROJECT_ROOT%frontend"
call npm run build
if errorlevel 1 (
    echo.
    echo Build falhou. O servidor nao sera iniciado.
    pause
    goto FIM
)
echo.
echo Build concluido com sucesso!
echo.
pause
goto FIM

:SAIR
exit /b 0

:FIM
pause
