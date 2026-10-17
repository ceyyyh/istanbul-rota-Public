@echo off
REM Windows: tarayıcı desteğini kurar, tüm iyileştirme adımlarını sırayla çalıştırır, sonra arayüzü açar
cd /d "%~dp0"
if not exist .venv py -3 -m venv .venv
.venv\Scripts\pip install -q -r requirements.txt playwright
.venv\Scripts\python -m playwright install chromium
.venv\Scripts\python -m isilan tam %*
start "" http://127.0.0.1:8000
.venv\Scripts\python -m isilan serve
