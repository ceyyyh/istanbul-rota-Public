@echo off
REM Windows: kurulum + ilk tarama + web arayüzü
cd /d "%~dp0"
if not exist .venv (
  py -3 -m venv .venv
  .venv\Scripts\pip install -q -r requirements.txt
)
start "" http://127.0.0.1:8000
.venv\Scripts\python -m isilan serve --crawl-now --crawl-every 6 %*
