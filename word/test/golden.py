#!/usr/bin/env python3
# Эталонные CSV для фикстуры mTest — порт buildCsv/buildMogrtCsv из js/app.js,
# чтобы проверить байт-в-байт, что VBA-экспорт идентичен экспортю Студии.
import io, sys

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
    ("standup", None, ["Корреспондент у катка."],
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

def parse_fio(s):
    w = [x for x in " ".join((s or "").split()).split(" ") if x]
    return (w[1] if len(w) > 1 else "", w[0] if w else "", " ".join(w[2:]))

def build_mogrt(sep):
    L = []
    L.append("# MOGRT — нижние титры, собрано в «Сюжет-Word»")
    L.append("# Сюжет: " + (TITLE or "—"))
    L.append("# Таймкод: NDF %s к/с; Дата: %s" % (FPS, DATE))
    L.append("# Порядок = появление синхронов в сценарии; «вход» = таймкод первого фрагмента")
    L.append("#")
    L.append(row(sep, "№", "фамилия", "имя", "отчество", "должность", "вход",
                 "спикер целиком", "файл входа", "путь"))
    sy = 0
    for kind, meta, text, parts in B:
        if kind != "sync":
            continue
        sy += 1
        spk, role = meta
        last, first, mid = parse_fio(spk)
        p0 = parts[0] if parts else None
        L.append(row(sep, sy, last, first, mid, role, p0[1] if p0 else "", spk,
                     p0[0] if p0 else "", p0[3] if p0 else ""))
    return "\ufeff" + "\r\n".join(L)

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp"
    io.open(out + "/golden_fish.csv", "w", encoding="utf-8", newline="").write(build_fish(";"))
    io.open(out + "/golden_fish_excel.csv", "w", encoding="utf-8", newline="").write(build_fish(","))
    io.open(out + "/golden_mogrt.csv", "w", encoding="utf-8", newline="").write(build_mogrt(";"))
    print("golden written to", out)
