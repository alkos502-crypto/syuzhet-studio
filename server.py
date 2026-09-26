#!/usr/bin/env python3
"""Сюжет-Студия: раздача статики + запись общего списка имён (POST /names.json).

Запуск: python3 server.py [порт] [--open]
  --open — открыть страницу в браузере автоматически (для Windows-версии)
Переменная окружения SS_VERBOSE=1 — подробный лог каждого запроса.

names.json содержит служебное поле "_v" (версия): POST без актуальной версии
получает 409 — так два пользователя не затирают правки друг друга молча.
"""
import json
import os
import shutil
import socket
import sys
import tempfile
import threading
import webbrowser
from io import BytesIO
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
NAMES_FILE = os.path.join(ROOT, "names.json")
ROLES = ("fioReporter", "fioCam", "fioEditor")
MAX_PER_ROLE = 200
MAX_BODY = 64 * 1024
MAX_AUDIO = 30 * 1024 * 1024
VKEY = "_v"

# ThreadingHTTPServer обслуживает запросы в потоках; версия «прочитал — сравнил —
# записал» должна быть атомарной, иначе два одновременных POST с одним _v оба
# проходят проверку и последний молча затирает первый (потерянное обновление).
NAMES_LOCK = threading.Lock()


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


def read_names():
    """Текущие списки и их версия (у файла без _v считаем версию 0)."""
    try:
        with open(NAMES_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return {r: [] for r in ROLES}, 0
    except Exception:
        raise ValueError("names.json повреждён — почините его или удалите (есть names.json.bak)")
    if not isinstance(data, dict):
        raise ValueError("names.json должен содержать JSON-объект")
    ver = data.get(VKEY) if isinstance(data.get(VKEY), int) else 0
    return clean_lists(data), ver


def write_names(out):
    """Атомарная запись на диск (tmp в той же папке + os.replace) с .bak."""
    if os.path.exists(NAMES_FILE):
        shutil.copy2(NAMES_FILE, NAMES_FILE + ".bak")
    fd, tmp = tempfile.mkstemp(dir=ROOT, suffix=".names.tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
        os.replace(tmp, NAMES_FILE)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def save_names(clean, client_v):
    """Атомарно: чтение версии → проверка client_v → запись. Возвращает
    (new_v, None) при успехе или (None, (code, json_obj)) при конфликте/ошибке.
    Защищено NAMES_LOCK, чтобы конкурентные POST не теряли обновления."""
    with NAMES_LOCK:
        try:
            _, cur_v = read_names()
        except Exception as e:
            return None, (500, {"error": str(e)})
        if isinstance(client_v, int) and client_v != cur_v:
            return None, (409, {"error": "список имён изменён другим пользователем — обновите страницу (F5) и повторите",
                                "conflict": True, VKEY: cur_v})
        out = dict(clean)
        out[VKEY] = cur_v + 1
        try:
            write_names(out)
        except Exception as e:
            return None, (500, {"error": "запись не удалась: %s" % e})
        return cur_v + 1, None


# ---------- офлайн-распознавание речи (faster-whisper) ----------
# Устанавливается отдельно:  pip install faster-whisper
# Модель (по умолчанию base) скачается при первом вызове — нужен интернет один раз.
WHISPER_MODEL = os.environ.get("SS_WHISPER_MODEL", "base")
_whisper = {"model": None, "name": None}


def transcribe_wav(data):
    """WAV-байты фрагмента -> текст (русский). Бросает RuntimeError с понятной причиной."""
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise RuntimeError("faster-whisper не установлен: выполните на сервере "
                           "'pip install faster-whisper' и перезапустите его")
    if _whisper["model"] is None or _whisper["name"] != WHISPER_MODEL:
        _whisper["model"] = WhisperModel(WHISPER_MODEL, device="auto", compute_type="int8")
        _whisper["name"] = WHISPER_MODEL
    segments, _info = _whisper["model"].transcribe(BytesIO(data), language="ru", vad_filter=True)
    return " ".join(seg.text.strip() for seg in segments).strip()


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"   # keep-alive; все ответы с Content-Length

    @staticmethod
    def _forbidden(path):
        parts = [p for p in path.replace("\\", "/").split("/") if p]
        return any(p == ".git" or p == "__pycache__" or p.startswith(".")
                   or p.endswith((".bak", ".tmp")) for p in parts)

    def log_message(self, fmt, *a):
        if os.environ.get("SS_VERBOSE"):
            super().log_message(fmt, *a)

    # ---------- отправка ----------
    def _send(self, code, ctype, body, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code, obj, extra=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self._send(code, "application/json; charset=utf-8", body, extra)

    # ---------- GET ----------
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if self._forbidden(path):
            return self._json(403, {"error": "доступ запрещён"})
        if path in ("/names.json", "names.json"):
            return self._serve_names()
        return super().do_GET()

    def _serve_names(self):
        try:
            names, ver = read_names()
        except Exception as e:
            return self._json(500, {"error": str(e)})
        names[VKEY] = ver
        etag = '"v%d"' % ver
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        body = json.dumps(names, ensure_ascii=False, indent=2).encode("utf-8")
        self._send(200, "application/json; charset=utf-8", body,
                   {"Cache-Control": "no-store", "ETag": etag})

    # ---------- POST ----------
    def _read_body(self, limit=MAX_BODY):
        """Всегда дочитывает тело (иначе keep-alive «поплывёт»).
        Возвращает (body, None) или (None, (code, obj))."""
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > limit:
            self.close_connection = True
            return None, (400, {"error": "некорректный размер запроса"})
        return (self.rfile.read(length) if length else b""), None

    def _transcribe(self, body):
        """POST /transcribe: WAV-фрагмент -> текст (офлайн, faster-whisper)."""
        ctype = (self.headers.get("Content-Type") or "").lower()
        if "audio/wav" not in ctype:
            return self._json(415, {"error": "подайте WAV (audio/wav)"})
        if not self.headers.get("X-Requested-With"):
            return self._json(415, {"error": "запись только из интерфейса Сюжет-Студии"})
        try:
            text = transcribe_wav(body)
        except Exception as e:
            return self._json(500, {"error": str(e)})
        return self._json(200, {"ok": True, "text": text})

    def do_POST(self):
        path = self.path.split("?", 1)[0].lstrip("/")
        if path == "transcribe":
            body, err = self._read_body(MAX_AUDIO)
            if err:
                return self._json(*err)
            return self._transcribe(body)
        body, err = self._read_body()
        if err:
            return self._json(*err)
        if path != "names.json":
            return self._json(405, {"error": "этот адрес не доступен для записи"})
        # защита от межсайтовых запросов: нет preflight — нет записи из чужой страницы
        ctype = (self.headers.get("Content-Type") or "").lower()
        if "application/json" not in ctype or not self.headers.get("X-Requested-With"):
            return self._json(415, {"error": "запись только из интерфейса Сюжет-Студии"})
        try:
            data = json.loads(body.decode("utf-8"))
            client_v = data.get(VKEY) if isinstance(data, dict) else None
            clean = clean_lists(data)
        except Exception as e:
            return self._json(400, {"error": str(e)})
        new_v, err = save_names(clean, client_v)
        if err:
            return self._json(*err)
        self._json(200, {"ok": True, VKEY: new_v})


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
    argv = sys.argv[1:]
    open_browser = "--open" in argv
    argv = [a for a in argv if a != "--open"]
    port = int(argv[0]) if argv else 8765   # CLI-аргументы не видны при импорте (тесты)
    try:
        sys.stdout.reconfigure(errors="replace")   # консоль Windows может не любить кириллицу
    except Exception:
        pass
    os.chdir(ROOT)
    handler = lambda *a, **kw: Handler(*a, directory=ROOT, **kw)  # noqa: E731
    try:
        httpd = ThreadingHTTPServer(("", port), handler)
    except OSError as e:
        print("Не удалось запустить сервер на порту %d: %s" % (port, e), flush=True)
        print("Скорее всего порт занят — закройте другое окно Сюжет-Студии или поменяйте порт.")
        sys.exit(1)
    print("Сюжет-Студия запущена (Ctrl+C или закрытие окна — остановка)", flush=True)
    print("  На этом компьютере:  http://localhost:%d" % port, flush=True)
    ip = lan_ip()
    if ip:
        print("  В сети для коллег:    http://%s:%d" % (ip, port), flush=True)
    if open_browser:
        webbrowser.open("http://localhost:%d" % port)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
