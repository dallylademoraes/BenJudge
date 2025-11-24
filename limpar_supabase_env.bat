@echo off
echo ============================================
echo       Limpando variáveis Supabase...
echo ============================================

REM --- REMOVER VARIÁVEIS DE USUÁRIO ---
setx SUPABASE_URL ""
setx SUPABASE_KEY ""
setx SUPABASE_SERVICE_ROLE ""

REM --- REMOVER VARIÁVEIS DE SISTEMA (via registry) ---
reg delete "HKCU\Environment" /F /V SUPABASE_URL 2>nul
reg delete "HKCU\Environment" /F /V SUPABASE_KEY 2>nul
reg delete "HKCU\Environment" /F /V SUPABASE_SERVICE_ROLE 2>nul

reg delete "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /F /V SUPABASE_URL 2>nul
reg delete "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /F /V SUPABASE_KEY 2>nul
reg delete "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /F /V SUPABASE_SERVICE_ROLE 2>nul

echo Variáveis apagadas!

echo.
echo ============================================
echo          Limpando caches do Windows
echo ============================================

REM --- MATAR PROCESSOS QUE GUARDAM ENV ---
taskkill /f /im code.exe >nul 2>&1
taskkill /f /im powershell.exe >nul 2>&1
taskkill /f /im cmd.exe >nul 2>&1
taskkill /f /im node.exe >nul 2>&1

REM --- REINICIAR EXPLORER PARA CARREGAR AMBIENTE NOVO ---
taskkill /f /im explorer.exe
start explorer.exe

echo.
echo ============================================
echo       Ambiente limpo com sucesso!
echo.
echo Abra um NOVO terminal e rode:
echo    node index.js
echo ============================================
pause
