"""Тесты для server.py: чистка списков, запрещённые пути, атомарность записи.

Покрытие фокусируем на том, что не покрыто браузерными тестами:
конкурентный POST в names.json не должен терять обновления (P0-2).
"""
import json
import os
import sys
import threading
import urllib.error
import urllib.request

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server as S  # noqa: E402

ROLES = list(S.ROLES)


def seed(tmp_path, version):
    data = {S.VKEY: version, **{r: [] for r in ROLES}}
    f = tmp_path / "names.json"
    f.write_text(json.dumps(data), encoding="utf-8")
    return f


@pytest.fixture
def env(tmp_path, monkeypatch):
    """Реальный ThreadingHTTPServer на эфемерном порту + NAMES_FILE в tmp."""
    monkeypatch.setattr(S, "ROOT", str(tmp_path))
    f = tmp_path / "names.json"
    monkeypatch.setattr(S, "NAMES_FILE", str(f))
    httpd = S.ThreadingHTTPServer(("127.0.0.1", 0), S.Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield {"tmp": tmp_path, "file": f, "port": httpd.server_address[1]}
    finally:
        httpd.shutdown()
        httpd.server_close()


def post(port, body, headers=None, csrf=True):
    h = {"Content-Type": "application/json"}
    if csrf:
        h["X-Requested-With"] = "XMLHttpRequest"
    h.update(headers or {})
    req = urllib.request.Request(
        "http://127.0.0.1:%d/names.json" % port,
        data=json.dumps(body).encode("utf-8"), headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


def clean_payload(extra=None):
    p = {r: [] for r in ROLES}
    p.update(extra or {})
    return p


# ---------- чистая логика ----------

def test_clean_lists_dedup_normalizes_and_limits():
    p = {"fioReporter": ["  Иван  Петров ", "Иван Петров", "", "Анна", 7],
         "fioCam": [], "fioEditor": []}
    with pytest.raises(ValueError):
        S.clean_lists(p)  # не-строка отклоняется

    ok = S.clean_lists({"fioReporter": ["  А ", "А", "", "Б", "А"], "fioCam": [], "fioEditor": []})
    assert ok["fioReporter"] == ["А", "Б"]  # нормализация пробелов + дедупликация

    many = {r: (["X%03d" % i for i in range(S.MAX_PER_ROLE + 1)]) if r == "fioReporter" else [] for r in ROLES}
    with pytest.raises(ValueError):
        S.clean_lists(many)

    with pytest.raises(ValueError):
        S.clean_lists(["не объект"])


def test_forbidden_paths():
    assert S.Handler._forbidden("/.git/config")
    assert S.Handler._forbidden("/js/__pycache__/x.py")
    assert S.Handler._forbidden("/names.json.bak")
    assert S.Handler._forbidden("//.profile")
    assert not S.Handler._forbidden("/names.json")
    assert not S.Handler._forbidden("/css/style.css")
    assert not S.Handler._forbidden("/")


def test_save_names_success_and_version_grows(tmp_path, monkeypatch):
    monkeypatch.setattr(S, "ROOT", str(tmp_path))
    monkeypatch.setattr(S, "NAMES_FILE", str(seed(tmp_path, 5)))
    clean = clean_payload({"fioReporter": ["Иван"]})
    v1, err = S.save_names(clean, 5)
    assert err is None and v1 == 6
    seen = json.loads(open(S.NAMES_FILE, encoding="utf-8").read())
    assert seen[S.VKEY] == 6 and seen["fioReporter"] == ["Иван"]
    # повторная запись с актуальной версией проходит
    v2, err = S.save_names(clean_payload(), 6)
    assert err is None and v2 == 7


def test_save_names_stale_version_conflict(tmp_path, monkeypatch):
    monkeypatch.setattr(S, "ROOT", str(tmp_path))
    monkeypatch.setattr(S, "NAMES_FILE", str(seed(tmp_path, 9)))
    v, err = S.save_names(clean_payload(), 9)
    assert err is None and v == 10
    # устаревший клиент не затирает
    _, err = S.save_names(clean_payload({"fioReporter": ["Кто-то"]}), 9)
    assert err is not None and err[0] == 409
    assert json.loads(open(S.NAMES_FILE, encoding="utf-8").read())[S.VKEY] == 10

    # версия отсутствует (не _v) — не конфликт
    v2, err = S.save_names({"a": 1}, None)
    assert err is None and v2 == 11


# ---------- поверх реального сервера ----------

def test_post_concurrent_single_winner_over_http(env):
    """Сердце P0-2: N одновременных POST с одним _v -> ровно один 200, остальные 409."""
    seed(env["tmp"], 3)
    barrier = threading.Barrier(8)
    results, rlock = [], threading.Lock()

    def worker():
        payload = clean_payload({"fioReporter": ["Оперативник"]})
        payload[S.VKEY] = 3
        barrier.wait()
        status, _ = post(env["port"], payload)
        with rlock:
            results.append(status)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert results.count(200) == 1, "успешный POST должен быть ровно один: %r" % results
    assert results.count(409) == 7
    final = json.loads(env["file"].read_text(encoding="utf-8"))
    assert final[S.VKEY] == 4, "версия должна вырасти ровно на 1"  # не 11, т.е. без потерянных обновлений


def test_get_etag_304_and_no_store(env):
    seed(env["tmp"], 7)

    def get(headers=None):
        req = urllib.request.Request("http://127.0.0.1:%d/names.json" % env["port"], headers=headers or {})
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, dict(r.headers)

    status, headers = get()
    assert status == 200
    assert headers.get("ETag") == '"v7"'
    assert headers.get("Cache-Control") == "no-store"

    try:
        status, headers = get({"If-None-Match": '"v7"'})
    except urllib.error.HTTPError as e:   # urllib трактует 304 как ошибку
        assert e.code == 304
        status = e.code
    assert status == 304


def test_post_requires_header_and_json(env):
    seed(env["tmp"], 1)
    # без X-Requested-With — отказ (защита от межсайтовых запросов)
    status, body = post(env["port"], clean_payload(), headers={"Content-Type": "application/json"}, csrf=False)
    assert status == 415
    # не JSON — 400
    req = urllib.request.Request("http://127.0.0.1:%d/names.json" % env["port"],
        data=b"not-json", headers={"Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest"},
        method="POST")
    with pytest.raises(urllib.error.HTTPError) as ex:
        urllib.request.urlopen(req, timeout=5)
    assert ex.value.code == 400