#!/usr/bin/env python3
"""Сюжет-Студия: раздача статики + запись общего списка имён (POST /names.json).

Запуск: python3 server.py [порт] [--open]
  --open — открыть страницу в браузере автоматически (для Windows-версии)
"""
import json
import os
import shutil
import socket
import sys
import tempfile
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

args = [a for a in sys.argv[1:] if a != "--open"]
OPEN_BROWSER = "--open" in sys.argv[1:]
PORT = int(args[0]) if args else 8765
ROOT = os.path.dirname(os.path.abspath(__file__))
NAMES_FILE = os.path.join(ROOT, "names.json")
ROLES = ("fioReporter", "fioCam", "fioEditor")
MAX_PER_ROLE = 200
MAX_BODY = 64 * 1024


def clean_lists(payload):
    if not isinstance(payload, dict):
        raise ValueError("ожидался JSON-объект")
    out = {}
    for role in ROLES:
        arr = payload.get(role, [])
        if not isinstance(arr, list):
            raise ValueError(role + ": ожидался массив")
        seen, names = set(), []
        for n in arr:
            if not isinstance(n, str):
                raise ValueError(role + ": имена должны быть строками")
            n = " ".join(n.split())
            if n and n not in seen:
                seen.add(n)
                names.append(n)
        if len(names) > MAX_PER_ROLE:
            raise ValueError(role + ": слишком много имён (максимум %d)" % MAX_PER_ROLE)
        out[role] = names
    return out


class Handler(SimpleHTTPRequestHandler):

    @staticmethod
    def _forbidden(path):
        parts = [p for p in path.replace("\\", "/").split("/") if p]
        return any(p == ".git" or p.startswith(".") or p.endswith(".bak") for p in parts)

    def do_GET(self):
        if self._forbidden(self.path.split("?", 1)[0]):
            return self._json(403, {"error": "доступ запрещён"})
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0].lstrip("/")
        if path != "names.json":
            return self._json(405, {"error": "этот адрес не доступен для записи"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY:
                raise ValueError("некорректный размер запроса")
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            clean = clean_lists(data)
        except Exception as e:
            return self._json(400, {"error": str(e)})
        try:
            if os.path.exists(NAMES_FILE):
                shutil.copy2(NAMES_FILE, NAMES_FILE + ".bak")
            fd, tmp = tempfile.mkstemp(dir=ROOT, suffix=".names.tmp")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    f.write(json.dumps(clean, ensure_ascii=False, indent=2) + "\n")
                os.replace(tmp, NAMES_FILE)
            finally:
                if os.path.exists(tmp):
                    os.unlink(tmp)
        except Exception as e:
            return self._json(500, {"error": "запись не удалась: %s" % e})
        self._json(200, {"ok": True})

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def lan_ip():
    """Сетевой адрес для коллег (UDP-connect не отправляет трафик)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(errors="replace")   # консоль Windows может не любить кириллицу
    except Exception:
        pass
    os.chdir(ROOT)
    handler = lambda *a, **kw: Handler(*a, directory=ROOT, **kw)  # noqa: E731
    try:
        httpd = ThreadingHTTPServer(("", PORT), handler)
    except OSError as e:
        print("Не удалось запустить сервер на порту %d: %s" % (PORT, e), flush=True)
        print("Скорее всего порт занят — закройте другое окно Сюжет-Студии или поменяйте порт.")
        sys.exit(1)
    print("Сюжет-Студия запущена (Ctrl+C или закрытие окна — остановка)", flush=True)
    print("  На этом компьютере:  http://localhost:%d" % PORT, flush=True)
    ip = lan_ip()
    if ip:
        print("  В сети для коллег:    http://%s:%d" % (ip, PORT), flush=True)
    if OPEN_BROWSER:
        webbrowser.open("http://localhost:%d" % PORT)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
