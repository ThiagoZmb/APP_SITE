@echo off
rem Inicia o serviço que grava os PDFs em C:\Programa Elegance\<pasta>. Requer o Node.js instalado.
rem Para iniciar com o Windows: Win+R > shell:startup > coloque aqui um atalho para este arquivo.
cd /d "%~dp0"
node salvador_pdf.js
pause
