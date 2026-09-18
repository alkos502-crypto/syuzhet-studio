#!/usr/bin/env python3
# Эталонные CSV для фикстуры mTest — порт buildCsv/buildMogrtCsv из js/app.js,
# чтобы проверить байт-в-байт, что VBA-экспорт идентичен экспортю Студии.
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import unittest
from unittest.mock import patch

DATE = "2026-05-01"
TITLE = "Про ремонт дорог"
REQ = ("А. Иванов", "П. Сидоров", "С. Монтажный")
FPS = "25"

B = [
    ("headline", None, ["Про ремонт дорог"], []),
    ("vo", None, ["Осенью в городе начнут ремонтировать четыре магистрали."], []),
    ("sync", ("Иван Петров", "директор завода"),
     ["Мы уже подали документы в администрацию."],
     [("A001C003.mov", "00:00:10:00", "00:00:14:12", "sub/A001C003.mov"),
      ("B mov.mov", "00:01:00:00", "00:01:05:00", "B mov.mov")]),
    ("standup", ("А. Иванов", "корреспондент"), ["Корреспондент у катка."],
     [("C1.mxf", "00:02:00:00", "00:02:03:00", "C1.mxf")]),
    ("life", None, [],
     [("D.mts", "00:03:00:00", "00:03:02:11", "archive/2025/D.mts")]),
    ("spiegel", None, [],
     [("E.mp4", "00:00:05:00", "00:00:09:00", "E.mp4"),
      ("E.mp4", "00:00:20:00", "00:00:23:00", "E.mp4")]),
    ("vod", None, ["Директор завода — о планах."], []),
    ("vo", None, ["Работы обещают закончить к декабрю."], []),
    ("sync", ("Анна Сергеевна Иванова", ""), [],
     [("F.mov", "00:00:01:00", "00:00:04:00", "F.mov")]),
]

def cell(s, sep):
    s = str(s)
    return '"' + s.replace('"', '""') + '"' if (sep in s or any(c in s for c in '"\n\r')) else s

def row(sep, *cols):
    return (("; " if sep == ";" else sep)).join(cell(c, sep) for c in cols)

def build_fish(sep):
    L = []
    L.append("# Fish Cutter — сценарий, собранный в «Сюжет-Word»")
    L.append("# Сюжет: " + (TITLE or "—"))
    L.append("# Корреспондент: %s; Оператор: %s; Монтажёр: %s" % REQ)
    L.append("# Таймкод: NDF %s к/с; Дата: %s" % (FPS, DATE))
    L.append("#")
    L.append(row(sep, "файл", "вход", "выход", "подпись", "путь"))
    hd = vo = su = sy = li = 0
    for kind, meta, text, parts in B:
        if kind == "headline":
            hd += 1
            L.append("#"); L.append("# ——— ЗАГОЛОВОК %d ———" % hd)
            L += ["# " + t for t in (text or [""])]
        elif kind == "vo":
            vo += 1
            L.append("#"); L.append("# ——— ЗАКАД %d ———" % vo)
            L += ["# " + t for t in (text or [""])]
        elif kind == "vod":
            L.append("#"); L.append("# ——— ПОДВОДКА ———")
            L += ["# " + t for t in (text or [""])]
        elif kind == "standup":
            su += 1
            L.append("#"); L.append("# ——— СТЕНДАП %d ———" % su)
            L += ["# " + t for t in (text or [""])]
            for pi, p in enumerate(parts):
                lbl = "СТЕНД%d-%d" % (su, pi + 1) if len(parts) > 1 else "СТЕНД%d" % su
                L.append(row(sep, p[0], p[1], p[2], lbl, p[3]))
        elif kind == "life":
            li += 1
            L.append("#"); L.append("# ——— ЛАЙФ %d ———" % li)
            L += ["# " + t for t in text]
            for pi, p in enumerate(parts):
                lbl = "ЛАЙФ%d-%d" % (li, pi + 1) if len(parts) > 1 else "ЛАЙФ%d" % li
                L.append(row(sep, p[0], p[1], p[2], lbl, p[3]))
        elif kind == "spiegel":
            L.append("#"); L.append("# ——— ШПИГЕЛЬ ———")
            L += ["# " + t for t in text]
            for p in parts:
                L.append(row(sep, p[0], p[1], p[2], "ШПИГ", p[3]))
        else:
            spk, role = meta
            sy += 1
            L.append("#")
            L.append("# ——— СИНХРОН %d: %s%s ———" % (sy, spk or "спикер", (", " + role) if role else ""))
            L += ["# " + t for t in (text or [""])]
            for pi, p in enumerate(parts):
                L.append(row(sep, p[0], p[1], p[2], "СИНХ%d-%d %s" % (sy, pi + 1, spk), p[3]))
    return "\ufeff" + "\r\n".join(L)

def build_mogrt(sep=";", blocks=None):
    if sep != ";":
        raise ValueError("MOGRT requires semicolon delimiter")
    lines = ["Имя Фамилия;Должность"]
    for kind, meta, text, parts in B if blocks is None else blocks:
        if kind not in ("sync", "standup") or not meta or not meta[0]:
            continue
        speaker, role = meta
        lines.append(cell(speaker.upper(), ";") + ";" + cell((role or "").upper(), ";"))
    return "\ufeff" + "\r\n".join(lines)


def outputs():
    return {
        "fish.csv": build_fish(";").encode("utf-8"),
        "fish_excel.csv": build_fish(",").encode("utf-8"),
        "mogrt.csv": build_mogrt().encode("utf-8"),
    }


def check_exports(directory):
    errors = []
    for name, expected in outputs().items():
        path = Path(directory) / ("su_" + name)
        try:
            actual = path.read_bytes()
        except OSError as exc:
            errors.append(f"{path}: {exc}")
            continue
        if actual != expected:
            offset = next((i for i, (a, b) in enumerate(zip(actual, expected)) if a != b),
                          min(len(actual), len(expected)))
            errors.append(f"{path}: mismatch at byte {offset}; "
                          f"actual {len(actual)} bytes, expected {len(expected)}")
    return errors


class GoldenTests(unittest.TestCase):
    def test_fixture_mogrt_bytes(self):
        self.assertEqual(build_mogrt().encode("utf-8"), (
            "\ufeffИмя Фамилия;Должность\r\n"
            "ИВАН ПЕТРОВ;ДИРЕКТОР ЗАВОДА\r\n"
            "А. ИВАНОВ;КОРРЕСПОНДЕНТ\r\n"
            "АННА СЕРГЕЕВНА ИВАНОВА;"
        ).encode("utf-8"))

    def test_empty_and_separator(self):
        self.assertEqual(build_mogrt(blocks=[]), "\ufeffИмя Фамилия;Должность")
        with self.assertRaises(ValueError):
            build_mogrt(",")

    def test_filter_order_duplicates_and_escaping(self):
        blocks = [
            ("vo", ("лишний", "текст"), [], []),
            ("sync", ("", "без имени"), [], []),
            ("standup", None, [], []),
            ("standup", ('Ёлка; "имя"', "строка\nдва\rтри"), [], []),
            ("sync", ("Анна, Мария", None), [], []),
            ("sync", ("Анна, Мария", ""), [], []),
            ("standup", ("  ", " роль "), [], []),
        ]
        actual = build_mogrt(blocks=blocks)
        self.assertEqual(actual, '\ufeffИмя Фамилия;Должность\r\n'
                         '"ЁЛКА; ""ИМЯ""";"СТРОКА\nДВА\rТРИ"\r\n'
                         'АННА, МАРИЯ;\r\nАННА, МАРИЯ;\r\n  ; РОЛЬ ')
        rows = list(csv.reader(io.StringIO(actual.lstrip("\ufeff"), newline=""), delimiter=";"))
        self.assertTrue(all(len(row) == 2 for row in rows))
        self.assertEqual(rows[1], ['ЁЛКА; "ИМЯ"', "СТРОКА\nДВА\rТРИ"])

    def test_fish_unchanged(self):
        hashes = {
            ";": "ab43d127402689a40d0621f9181ab9fa68da40eef50724fced5faad1acfdb673",
            ",": "b87d5eae21ad06b96118991771d623aa4898d677178e8fbbbfaf18a852a49c26",
        }
        for sep, expected in hashes.items():
            with self.subTest(sep=sep):
                self.assertEqual(hashlib.sha256(build_fish(sep).encode("utf-8")).hexdigest(), expected)

    def test_check_exports(self):
        expected = list(outputs().values())
        with patch.object(Path, "read_bytes", side_effect=expected):
            self.assertEqual(check_exports("unused"), [])
        for damaged in (expected[0][3:], expected[0].replace(b"\r\n", b"\n"), expected[0] + b"\n"):
            with self.subTest(damaged=damaged), patch.object(
                    Path, "read_bytes", side_effect=[damaged, *expected[1:]]):
                self.assertEqual(len(check_exports("unused")), 1)
        with patch.object(Path, "read_bytes", side_effect=FileNotFoundError("missing")):
            self.assertEqual(len(check_exports("unused")), 3)

    def test_check_mode_does_not_write(self):
        with patch.object(Path, "write_bytes", side_effect=AssertionError("write")), \
                patch.object(unittest.TextTestRunner, "run") as run, \
                patch.object(Path, "read_bytes", side_effect=list(outputs().values())):
            run.return_value.wasSuccessful.return_value = True
            self.assertEqual(main(["--check"]), 0)
            self.assertEqual(main(["unused", "--check"]), 0)

    @unittest.skipUnless(shutil.which("node"), "Node.js unavailable: actual buildMogrtCsv not executed")
    def test_actual_js_contract(self):
        source = (Path(__file__).resolve().parents[2] / "js" / "app.js").read_text(encoding="utf-8")
        kinds = re.search(r"^const TITR_KINDS = .*;$", source, re.MULTILINE)
        function = re.search(r"^function buildMogrtCsv\(\) \{.*?^\}", source, re.MULTILINE | re.DOTALL)
        self.assertIsNotNone(kinds)
        self.assertIsNotNone(function)
        cases = [[], B, [
            (kind, meta, [], [])
            for kind in ("sync", "standup", "vo", "life", "headline", "vod", "spiegel")
            for meta in (None, ("", "роль"), (" ", ""), ('Ёж; "Иван"', "а\nб\rв"),
                         ("Анна, Мария", None), ("straße", "роль"))
        ]]
        data = [[dict(kind=kind, speaker=meta[0] if meta else "", role=meta[1] if meta else "")
                 for kind, meta, text, parts in blocks] for blocks in cases]
        script = (kinds.group() + "\n" + function.group() + "\n"
                  'const cases = JSON.parse(require("fs").readFileSync(0, "utf8"));\n'
                  'let state; process.stdout.write(JSON.stringify(cases.map(blocks => {\n'
                  'state = {blocks}; return buildMogrtCsv(); })));')
        result = subprocess.run(["node", "-e", script], input=json.dumps(data),
                                capture_output=True, text=True, check=True, timeout=10)
        self.assertEqual(json.loads(result.stdout), [build_mogrt(blocks=blocks) for blocks in cases])


def main(argv=None):
    parser = argparse.ArgumentParser(description="Word CSV golden files and read-only contract checks")
    parser.add_argument("directory", nargs="?", help="output directory; with --check compare existing su_*.csv")
    parser.add_argument("--check", action="store_true", help="run tests without writing; optionally compare Word exports")
    args = parser.parse_args(argv)
    if args.check:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(GoldenTests)
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        errors = check_exports(args.directory) if args.directory is not None else []
        for error in errors:
            print(error, file=sys.stderr)
        return 0 if result.wasSuccessful() and not errors else 1
    directory = Path(args.directory or "/tmp")
    try:
        for name, content in outputs().items():
            (directory / ("golden_" + name)).write_bytes(content)
    except OSError as exc:
        print(exc, file=sys.stderr)
        return 1
    print("golden written to", directory)
    return 0


if __name__ == "__main__":
    sys.exit(main())
