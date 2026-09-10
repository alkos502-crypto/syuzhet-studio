#!/bin/zsh
# Перегенерирует ../Сюжет-Студия-Windows из текущих Mac-исходников.
# Статика копируется 1:1; bat/README/ярлык-правка server.py — свои.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
WIN="$SRC/../Сюжет-Студия-Windows"
mkdir -p "$WIN/css" "$WIN/js"
cp "$SRC/index.html" "$SRC/server.py" "$SRC/names.json" "$WIN/"
cp "$SRC/css/style.css" "$WIN/css/"
cp "$SRC/js/app.js" "$WIN/js/"
cp "$SRC/js/octopus.js" "$WIN/js/"
python3 - "$SRC" "$WIN" <<'PYEOF'
import sys
src, win = sys.argv[1], sys.argv[2]

bat = r'''@echo off
chcp 65001 >nul
rem  Сюжет-Студия — запуск сервера (Windows 10/11)
cd /d "%~dp0"
set PORT=8765

set "PY="
py -3 --version >nul 2>nul && set "PY=py -3"
if not defined PY (
    python --version >nul 2>nul && set "PY=python"
)
if not defined PY (
    echo.
    echo  Python не найден.
    echo  1. Скачайте Python 3 с https://www.python.org/downloads/
    echo  2. При установке ОТМЕТЬТЕ галочку "Add python.exe to PATH"
    echo  3. Запустите этот файл снова.
    echo.
    pause
    exit /b 1
)

%PY% server.py %PORT% --open
pause
'''
# chcp 65001 + UTF-8 без BOM — кириллица корректна на Win10/11 на любой локали;
# на экзотических старых системах ASCII-команды всё равно выполнятся, пострадает только текст подсказок
open(win + "/Запустить сервер.bat", "wb").write(bat.replace("\n", "\r\n").encode("utf-8"))

mac = open(src + "/README.txt").read()
win_zapusk = """ЗАПУСК (Windows)
----------------
1. Один раз на компьютер: установите Python 3 — https://www.python.org/downloads/
   (на первом шаге установки ОТМЕТЬТЕ галочку "Add python.exe to PATH").
2. Двойной клик по «Запустить сервер.bat».
3. Сервер стартует, и браузер откроется сам: http://localhost:8765
4. При первом запуске брандмауэр спросит про Python: отметьте «Частные сети»
   и нажмите «Разрешить» — иначе коллеги не увидят страницу.
5. Коллеги в той же сети открывают адрес вида http://192.168.x.x:8765 —
   он показывается в окне запуска.
6. Остановка — закрыть окно (или Ctrl+C).
7. Если Windows не даёт запустить bat из скачанного архива («Ограничение
   доступа Internet») — свойства файла → «Другие свойства…» → «Разблокировать»,
   либо снимите галочку в поле Internet на вкладке «Общие» и запустите снова.

Рекомендуемый браузер: Edge или Chrome. Файлы никуда не копируются; папку с
видео нужно выбирать заново при каждом открытии страницы (браузер не хранит
доступ к файлам), имя прошлой папки подсказывается на вкладке «Авторы». Папку можно брать
с сетевого диска (\\\\сервер\\шар или диск, подключённый в Проводнике).

"""
out = mac[:mac.index("ЗАПУСК")] + win_zapusk + mac[mac.index("РАБОТА"):]
open(win + "/README.txt", "wb").write(out.replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8-sig"))
print("Windows-папка обновлена:", win)
PYEOF
