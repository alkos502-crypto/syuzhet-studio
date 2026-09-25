#!/usr/bin/env python3
"""Собирает готовый к запуску zip-дистрибутив Сюжет-Студии.

Используется в CI (release.yml) и локально:
    python scripts/make_release_zip.py
Кладёт в dist/syuzhet-studio-<VERSION>.zip то, что нужно журналисту «просто запустить»:
server.py, статику, README, VERSION, лаунчер Windows (.bat — генерится здесь же,
как в make-win.sh) и macOS (.command). Тесты, .github и CONTEXT в дистрибутив не входят.
"""
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FILES = ["server.py", "index.html", "names.json", "VERSION",
         "Запустить сервер.command"]
DIRS = ["css", "js", "word"]
SKIP_DIR_PREFIXES = ("word/build",)   # собранный dotm в src, build — артефакт сборки

# Лаунчер Windows (значения path с \" экранируются автоматически python)
BAT = "@echo off\r\n" \
    "chcp 65001 >nul\r\n" \
    "rem  Сюжет-Студия - запуск сервера (Windows 10/11)\r\n" \
    "cd /d \"%~dp0\"\r\n" \
    "set PORT=8765\r\n" \
    "\r\n" \
    "set \"PY=\"\r\n" \
    "py -3 --version >nul 2>nul && set \"PY=py -3\"\r\n" \
    "if not defined PY (\r\n" \
    "    python --version >nul 2>nul && set \"PY=python\"\r\n" \
    ")\r\n" \
    "if not defined PY (\r\n" \
    "    echo.\r\n" \
    "    echo  Python не найден.\r\n" \
    "    echo  1. Скачайте Python 3 с https://www.python.org/downloads/\r\n" \
    "    echo  2. При установке ОТМЕТЬТЕ галочку \"Add python.exe to PATH\"\r\n" \
    "    echo  3. Запустите этот файл снова.\r\n" \
    "    echo.\r\n" \
    "    pause\r\n" \
    "    exit /b 1\r\n" \
    ")\r\n" \
    "\r\n" \
    "%PY% server.py %PORT% --open\r\n" \
    "pause\r\n"


def version():
    try:
        v = open(os.path.join(ROOT, "VERSION"), encoding="utf-8").read().strip()
        return v or "0"
    except OSError:
        return "0"


def main():
    out_dir = os.path.join(ROOT, "dist")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "syuzhet-studio-%s.zip" % version())
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in FILES:
            p = os.path.join(ROOT, f)
            if os.path.exists(p):
                z.write(p, f)
        # Windows-лаунчер генерим здесь (в репозитории его создаёт make-win.sh)
        z.writestr("Запустить сервер.bat", BAT.encode("utf-8"))
        for d in DIRS:
            for root, _dirs, files in os.walk(os.path.join(ROOT, d)):
                rel = os.path.relpath(root, ROOT).replace(os.sep, "/")
                if any(rel == s or rel.startswith(s + "/") for s in SKIP_DIR_PREFIXES):
                    _dirs[:] = []
                    continue
                for fn in files:
                    ap = os.path.join(root, fn)
                    z.write(ap, os.path.join(rel, fn))
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())