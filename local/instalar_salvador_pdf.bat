@echo off
rem Instalador do salvador de PDF: duplo clique. Instala o Node.js se faltar e configura o inicio com o Windows.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar_salvador_pdf.ps1"
echo.
pause
