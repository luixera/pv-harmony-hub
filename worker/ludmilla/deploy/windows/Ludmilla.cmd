@echo off
rem Ludmilla — estacao local. Inicia junto com o Windows (atalho na pasta
rem Inicializar, criado pelo instalar.ps1). Se o robo parar, tenta de novo
rem em 30 s; feche esta janela para parar a Ludmilla nesta maquina.
title Ludmilla - estacao local
set LUDMILLA_MODO=local
cd /d "%LOCALAPPDATA%\Ludmilla\app"
:de_novo
node dist\index.js
echo.
echo [Ludmilla] parou (codigo %errorlevel%). Tenta de novo em 30 s. Feche esta janela para parar.
timeout /t 30 /nobreak >nul
goto de_novo
