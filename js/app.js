/* Сюжет-Студия — фронтенд: блоки сценария, просмотрщик с метками, экспорт */
"use strict";

const $ = id => document.getElementById(id);
const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};

/* ---------- состояние ---------- */
let state = {
    blocks: [],       /* {id, kind: vo|standup|sync|life|spiegel|vod, text, speaker, role, parts:[{file,in,out}]} */
    nextId: 1
};
let videoFiles = [];           /* [{name, relPath, file, url|null}] */
let curFile = "";              /* имя файла в плеере */
let curRelPath = "";           /* путь внутри выбранной папки */
let markIn = null, markOut = null; /* секунды */
let marksSet = false;          /* метки заданы пользователем/фрагментом — дефолт не применять */
let limitToMarks = false;      /* воспроизведение только фрагмента In→Out */
let previewLoop = false;       /* P: циклический предпросмотр In→Out */

const VIDEO_RE = /\.(mp4|mov|mxf|mts|m2ts|m2t|avi|mkv|mpg|mpeg|wmv)$/i;
const DEFAULT_FPS = 25;     /* fps по умолчанию; поле «FPS» в шапке */
function fpsVal() {
    const v = parseFloat($("fpsInput").value);
    return v > 0 && v <= 240 ? v : DEFAULT_FPS;
}

/* ---------- утилиты ---------- */
function toast(msg, cls) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "show" + (cls ? " " + cls : "");
    clearTimeout(t._h);
    t._h = setTimeout(() => (t.className = ""), 2600);
}

/* секунды -> 00:01:12:05 */
function tc(sec) {
    if (sec === null || sec === undefined || isNaN(sec)) return "—";
    const fps = fpsVal();
    let f = Math.round(sec * fps);
    const ff = f % Math.round(fps); f = Math.floor(f / fps);
    const ss = f % 60; f = Math.floor(f / 60);
    const mm = f % 60, hh = Math.floor(f / 60);
    const p = (n, w) => String(n).padStart(w, "0");
    return `${p(hh,2)}:${p(mm,2)}:${p(ss,2)}:${p(ff,2)}`;
}
/* секунды -> "1 мин 05 с" */
function durHuman(sec) {
    if (!sec || sec <= 0) return "";
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return (m ? m + " мин " : "") + s + " с";
}
function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
}

/* ---------- сохранение реквизитов ---------- */
const REQ_IDS = ["storyTitle","fpsInput","fioReporter","fioCam","fioEditor"];
const NAME_IDS = ["fioReporter","fioCam","fioEditor"];
/* фактическое значение select'а ФИО: пункт «+» заменяем сохранённым именем */
function resolveNameValue(id) {
    const v = $(id).value;
    if (v && v !== "+") return v;
    return store.get("ss_req", {})[id] || "";
}
function saveReq() {
    const o = {};
    REQ_IDS.forEach(k => o[k] = $(k).value);
    NAME_IDS.forEach(id => { o[id] = resolveNameValue(id); });
    store.set("ss_req", o);
    /* выбранное ФИО — в локальный список для автоподстановки (без перерисовки) */
    NAME_IDS.forEach(id => {
        const v = resolveNameValue(id);
        if (!v) return;
        const key = "ss_names_" + id;
        const list = store.get(key, []).filter(x => x !== v);
        list.unshift(v);
        store.set(key, list.slice(0, 12));
    });
}
function loadReq() {
    /* сперва наполнить списки опциями, затем восстановить выбор */
    refreshNameSelects();
    const o = store.get("ss_req", {});
    REQ_IDS.forEach(k => { if (o[k]) $(k).value = o[k]; });
}
/* выпадающие списки ФИО: локальные имена + names.json + пункт «+ другое…».
   Перерисовка ТОЛЬКО при реальном изменении набора имён — иначе выбранный
   пункт сбрасывается под рукой у пользователя */
let sharedNames = { fioReporter: [], fioCam: [], fioEditor: [] };
function loadSharedNames(cb) {
    fetch("names.json", { cache: "no-store" })
        .then(r => (r.ok ? r.json() : {}))
        .then(j => {
            NAME_IDS.forEach(id => {
                const arr = j && Array.isArray(j[id]) ? j[id] : [];
                sharedNames[id] = arr.map(String);
            });
            if (cb) cb();
        })
        .catch(() => { if (cb) cb(); });
}
function allNames(id) {
    const local = store.get("ss_names_" + id, []);
    const seen = new Set(), out = [];
    local.concat(sharedNames[id] || []).forEach(n => {
        if (!seen.has(n)) { seen.add(n); out.push(n); }
    });
    return out;
}
function refreshNameSelects() {
    NAME_IDS.forEach(id => {
        const sel = $(id);
        /* сохранённый выбор важнее текущего (при старте select ещё пуст) */
        const saved = store.get("ss_req", {})[id] || "";
        const prev = sel._force || saved || sel.value;
        sel._force = null;
        const names = allNames(id);
        sel.innerHTML = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("") +
            `<option value="+" ${prev === "+" ? "selected" : ""}>+ другое…</option>`;
        if (prev && prev !== "+" && names.includes(prev)) sel.value = prev;
        else if ((!prev || prev === "+") && names.length) sel.value = names[0];
    });
}
NAME_IDS.forEach(id => {
    $(id).addEventListener("change", () => {
        const sel = $(id);
        if (sel.value === "+") {
            const role = sel.dataset.role || "сотрудника";
            const v = (prompt("ФИО (" + role + "):") || "").trim();
            if (v) {
                const key = "ss_names_" + id;
                const list = store.get(key, []).filter(x => x !== v);
                list.unshift(v);
                store.set(key, list.slice(0, 12));
                sel._force = v;
                refreshNameSelects();       /* набор имён изменился — перерисовать */
            } else {
                sel._force = resolveNameValue(id);
                refreshNameSelects();
            }
        } else {
            saveReq();                      /* обычный выбор — только сохранить */
        }
        const sel2 = $(id);
        if (sel2._force && [...sel2.options].some(o => o.value === sel2._force)) sel2.value = sel2._force;
    });
});

/* ---------- управление именами корреспондентов / операторов / монтажёров ---------- */
const NM_TABS = { fioReporter: "Корреспонденты", fioCam: "Операторы", fioEditor: "Монтажёры" };
let nmTab = "fioReporter", nmBusy = false;

function localNames(id) { const a = store.get("ss_names_" + id, []); return Array.isArray(a) ? a : []; }
function setLocalNames(id, arr) { store.set("ss_names_" + id, arr.filter(Boolean).slice(0, 12)); }
/* переименование/удаление выбранного имени не должно «ломать» выбор в шапке */
function nmAdjustSel(id, oldN, newN) {
    const sel = $(id);
    if (sel.value === oldN || sel._force === oldN) sel._force = newN || null;
}
/* запись общего списка на сервер; при неудаче — откат к снимку, UI не врёт.
   onOk/onFail — дополнительная правка локальной копии имени (см. saveReq) */
function saveSharedNames(id, nextArr, successMsg, onOk, onFail) {
    if (nmBusy) return toast("Подождите — сохранение предыдущего изменения ещё идёт", "warn");
    nextArr = nextArr.map(n => n.trim()).filter(Boolean).filter((n, i, a) => a.indexOf(n) === i);
    const snapshot = { fioReporter: sharedNames.fioReporter.slice(),
                       fioCam: sharedNames.fioCam.slice(),
                       fioEditor: sharedNames.fioEditor.slice() };
    sharedNames[id] = nextArr;
    nmBusy = true;
    fetch("names.json", { method: "POST", cache: "no-store",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(sharedNames) })
        .then(r => r.json().catch(() => ({})).then(j => ({ r, j })))
        .then(({ r, j }) => {
            nmBusy = false;
            if (r.ok) {
                if (onOk) onOk();
                refreshNameSelects(); saveReq(); renderNm();
                toast(successMsg || "Общий список обновлён — он виден всем", "ok");
            } else {
                sharedNames = snapshot;
                if (onFail) onFail();
                refreshNameSelects(); renderNm();
                const hint = (r.status === 501 || r.status === 405 || r.status === 404)
                    ? " — запущен старый сервер без поддержки записи: перезапустите «Запустить сервер.command»" : "";
                toast("Сохранение не удалось: " + ((j && j.error) || ("HTTP " + r.status)) + hint, "err");
            }
        })
        .catch(() => {
            nmBusy = false;
            sharedNames = snapshot;
            if (onFail) onFail();
            refreshNameSelects(); renderNm();
            toast("Сохранение не удалось — сервер не принимает имена (запускайте «Запустить сервер.command»)", "err");
        });
}
function renderNm() {
    $("nmTabs").innerHTML = NAME_IDS.map(k =>
        `<button class="${k === nmTab ? "on" : ""}" data-nm-tab="${k}">${NM_TABS[k]}</button>`).join("");
    $("nmTabs").querySelectorAll("[data-nm-tab]").forEach(b =>
        b.onclick = () => { nmTab = b.dataset.nmTab; renderNm(); });
    $("nmHint").textContent =
        "«общее» — хранится в names.json на сервере и видно всем; «локальное» — только в этом браузере.";
    const id = nmTab, host = $("nmList");
    host.innerHTML = "";
    const names = allNames(id);
    if (!names.length) { host.innerHTML = '<div class="muted">Список пуст — добавьте имя ниже.</div>'; return; }
    names.forEach(n => {
        const isShared = (sharedNames[id] || []).includes(n);
        const row = document.createElement("div");
        row.className = "nm-row";
        row.innerHTML = `
            <input value="${esc(n)}">
            <span class="nm-badge ${isShared ? "sh" : "loc"}" title="${isShared ? "На сервере, видят все" : "Только в этом браузере"}">${isShared ? "общее" : "локальное"}</span>
            <button data-nm="rename" title="Переименовать в введённое">✎</button>
            <button data-nm="del" title="Удалить">✕</button>`;
        const inp = row.querySelector("input");
        inp.addEventListener("keydown", e => { if (e.key === "Enter") inp.blur(), row.querySelector('[data-nm=rename]').click(); });
        row.querySelector('[data-nm=rename]').onclick = () => nmRename(id, n, inp.value.trim());
        row.querySelector('[data-nm=del]').onclick = () => nmDelete(id, n, isShared);
        host.appendChild(row);
    });
}
function nmRename(id, oldN, newN) {
    if (!newN) return toast("Введите новое имя", "err");
    if (newN === oldN) return;
    if (allNames(id).includes(newN)) return toast("Такое имя уже есть", "err");
    nmAdjustSel(id, oldN, newN);
    const shared = sharedNames[id] || [];
    if (shared.includes(oldN)) {
        /* имя могло задвоиться в локальном списке (автопамять saveReq) — чиним и его */
        const prevLocal = localNames(id);
        saveSharedNames(id, shared.map(x => x === oldN ? newN : x), "Переименовано в общем списке",
            () => setLocalNames(id, prevLocal.map(x => x === oldN ? newN : x)),
            () => setLocalNames(id, prevLocal));
    } else {
        setLocalNames(id, localNames(id).map(x => x === oldN ? newN : x));
        refreshNameSelects(); saveReq(); renderNm();
        toast("Локальное имя переименовано", "ok");
    }
}
function nmDelete(id, oldN, isShared) {
    if (isShared) {
        if (!confirm("Убрать «" + oldN + "» из общего списка?\nОн исчезнет у всех коллег после обновления страницы.")) return;
        nmAdjustSel(id, oldN, null);
        /* локальная авто-копия (saveReq) тоже мешает — убираем при успехе */
        const prevLocal = localNames(id);
        saveSharedNames(id, (sharedNames[id] || []).filter(x => x !== oldN), "Убрано из общего списка",
            () => setLocalNames(id, prevLocal.filter(x => x !== oldN)),
            () => setLocalNames(id, prevLocal));
    } else {
        if (!confirm("Убрать «" + oldN + "» из локального списка?")) return;
        nmAdjustSel(id, oldN, null);
        setLocalNames(id, localNames(id).filter(x => x !== oldN));
        refreshNameSelects(); saveReq(); renderNm();
        toast("Убрано из локального списка", "ok");
    }
}
function openNmModal(id) {
    nmTab = id || nmTab;
    $("namesModal").hidden = false;
    renderNm();
    $("nmAdd").value = "";
    $("nmAdd").focus();
}
function closeNmModal() { $("namesModal").hidden = true; }
$("nmAddBtn").onclick = () => {
    const v = $("nmAdd").value.trim();
    if (!v) return toast("Введите имя", "err");
    const id = nmTab;
    if (allNames(id).includes(v)) return toast("Такое имя уже есть", "err");
    $("nmAdd").value = "";
    saveSharedNames(id, [...(sharedNames[id] || []), v], "Добавлено в общий список");
};
$("nmAdd").addEventListener("keydown", e => { if (e.key === "Enter") $("nmAddBtn").click(); });
$("nmClose").onclick = closeNmModal;
$("namesModal").addEventListener("mousedown", e => { if (e.target === $("namesModal")) closeNmModal(); });
document.querySelectorAll(".nf-gear").forEach(btn =>
    btn.addEventListener("click", () => openNmModal(btn.dataset.names)));
REQ_IDS.forEach(k => {
    if (NAME_IDS.includes(k) || k === "fpsInput") return;
    $(k).addEventListener("change", () => { saveReq(); renderBlocks(); });
});
/* fps: валидация, пересчёт ТК на экране и в блоках; значение — в черновик/реквизиты */
$("fpsInput").addEventListener("change", () => {
    const inp = $("fpsInput");
    const v = parseFloat(inp.value);
    if (!(v > 0 && v <= 240)) inp.value = store.get("ss_req", {}).fpsInput || DEFAULT_FPS;
    saveReq();
    if ($("player").duration) $("fileDur").textContent = "длительность " + tc($("player").duration);
    updateMarks();
    renderBlocks();
});

/* ---------- выбор папки с видео (включая вложенные подпапки) ---------- */
/* «Исходники»: <input webkitdirectory> — Chrome отдаёт готовые File,
   getFile() не вызывается вовсе. Самый стабильный путь для сетевых томов (SMB). */
$("btnPickFolderCompat").addEventListener("click", pickFolderCompat);
function releaseBlobUrls(keepRelPath) {
    videoFiles.forEach(f => {
        if (f.url && f.relPath !== keepRelPath) { URL.revokeObjectURL(f.url); f.url = null; }
    });
}
function pickFolderCompat() {
    const inp = document.createElement("input");
    inp.type = "file"; inp.webkitdirectory = true;
    inp.onchange = () => {
        /* новый набор файлов — старые blob-URL и кэш миниатюр не нужны
           (URL текущего файла в плеере оставляем до перезагрузки) */
        releaseBlobUrls(curRelPath);
        posterCache.clear();
        videoFiles = [...inp.files].filter(f => VIDEO_RE.test(f.name))
            .map(f => ({
                name: f.name,
                relPath: f.webkitRelativePath || f.name,
                file: f,        /* File уже есть — URL создадим лениво */
                url: null,
                ck: (f.webkitRelativePath || f.name) + "#" + (f.lastModified || 0)
            }));
        afterScan();
    };
    inp.click();
}

/* ленивый blob-URL: создаётся при первом обращении, кэшируется в объекте.
   В compat-режиме File уже есть; при чтении с сетевого тома возможен сбой —
   делаем один повтор через 800 мс и показываем внятную причину */
function explainFileError(e) {
    const name = e && e.name || "Error";
    const msg = e && e.message || "";
    if (name === "NotFoundError")
        return "файл не найден (удалён, перемещён или сетевой диск недоступен)";
    if (name === "NetworkError")
        return "сетевая ошибка чтения";
    return name + (msg ? ": " + msg : "");
}

async function ensureUrl(f) {
    if (f.url) return f.url;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            f.url = URL.createObjectURL(f.file);
            return f.url;
        } catch (e) {
            console.error("ensureUrl fail:", f.relPath, e);
            if (attempt === 0) {                       /* сетевой ретрай */
                await new Promise(r => setTimeout(r, 800));
                continue;
            }
            toast("Не удалось открыть файл: " + f.relPath + " — " + explainFileError(e), "err");
            return null;
        }
    }
    return null;
}

/* общее завершение сканирования: счётчики, список, имя папки для подсказки */
function afterScan() {
    const n = videoFiles.length;
    let msg = "Найдено видео: " + n;
    /* корневое имя из webkitRelativePath («Папка/под/файл.mp4» → «Папка») */
    if (videoFiles.length) {
        const root = (videoFiles[0].relPath.split("/")[0] || "").trim();
        if (root) store.set("ss_dirname", root);
    }
    /* подпапки считаем по путям (имя корневой папки в webkitRelativePath отбрасываем) */
    const dirs = new Set(videoFiles.map(f => {
        const p = f.relPath;
        if (!p.includes("/")) return "";
        const up = p.slice(0, p.lastIndexOf("/"));
        return up.includes("/") ? up.slice(up.indexOf("/") + 1) : "";
    }).filter(Boolean));
    if (dirs.size) msg += " (в " + dirs.size + " подпапк" + (dirs.size % 10 === 1 && dirs.size % 100 !== 11 ? "е" : "ах") + ")";
    $("folderName").textContent = "видео: " + n +
        (dirs.size ? "  ·  подпапок: " + dirs.size : "");
    refreshVideoList();
    toast(msg, "ok");
}

/* ---------- вид списка: список / миниатюры / большие ---------- */
let viewMode = store.get("ss_view", "list");
const VIEW_BTNS = { list: "viewList", thumbs: "viewThumbs", "thumbs-big": "viewBig" };
function setView(mode) {
    viewMode = mode;
    store.set("ss_view", mode);
    Object.entries(VIEW_BTNS).forEach(([m, id]) => $(id).classList.toggle("on", m === mode));
    const host = $("videoList");
    host.className = mode === "list" ? "vl-list" : (mode === "thumbs" ? "vl-thumbs" : "vl-big");
    refreshVideoList();
}
Object.entries(VIEW_BTNS).forEach(([m, id]) => $(id).onclick = () => setView(m));

/* миниатюры: НЕ грузим метаданные всех файлов сразу (по SMB это душит сеть
   и основной плеер). Кадр каждого файла достаётся по одному, в фоне,
   через скрытый <video> + canvas, и кэшируется по пути файла */
const posterCache = new Map();   /* путь+lastModified -> dataURL | "" (ошибка) */
const ckOf = f => f.ck || (f.ck = f.relPath + "#" + ((f.file && f.file.lastModified) || 0));
let posterQueue = [], posterBusy = false;

function queuePoster(file, imgEl, tileEl) {
    if (posterCache.has(ckOf(file))) {
        if (posterCache.get(ckOf(file))) imgEl.style.backgroundImage = `url("${posterCache.get(ckOf(file))}")`;
        else tileEl.classList.add("nothumb");
        return;
    }
    posterQueue.push({ file, imgEl, tileEl });
    pumpPosterQueue();
}
function pumpPosterQueue() {
    if (posterBusy || !posterQueue.length) return;
    posterBusy = true;
    const { file, imgEl, tileEl } = posterQueue.shift();
    grabFrame(file, dataUrl => {
        posterCache.set(ckOf(file), dataUrl || "");
        if (dataUrl && imgEl.isConnected) imgEl.style.backgroundImage = `url("${dataUrl}")`;
        else if (tileEl.isConnected) tileEl.classList.add("nothumb");
        posterBusy = false;
        pumpPosterQueue();
    });
}
async function grabFrame(file, cb) {
    const url = await ensureUrl(file);
    if (!url) return cb("");
    const v = document.createElement("video");
    v.muted = true; v.preload = "auto"; v.playsInline = true;
    const done = url2 => { v.removeAttribute("src"); v.load(); cb(url2); };
    const timer = setTimeout(() => done(""), 20000);   /* файл недоступен/медленный — не ждём вечно */
    v.onloadeddata = () => {
        try { v.currentTime = Math.min(1, (v.duration || 1) / 2); } catch (e) { clearTimeout(timer); done(""); }
    };
    v.onseeked = () => {
        try {
            const c = document.createElement("canvas");
            c.width = 320;
            c.height = Math.max(2, Math.round(320 * (v.videoHeight || 9) / (v.videoWidth || 16)));
            c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
            clearTimeout(timer);
            done(c.toDataURL("image/jpeg", 0.6));
        } catch (e) { clearTimeout(timer); done(""); }
    };
    v.onerror = () => { clearTimeout(timer); done(""); };
    v.src = url;
}

function refreshVideoList() {
    const host = $("videoList");
    host.innerHTML = "";
    if (!videoFiles.length) {
        host.innerHTML = '<div class="muted" style="padding:8px">Папка не выбрана или видео не найдено</div>';
        return;
    }
    /* фильтр по подстроке пути/имени (регистр не важен); videoFiles не мутируется */
    const q = $("videoSearch").value.trim().toLowerCase();
    const shown = q ? videoFiles.filter(f => f.relPath.toLowerCase().includes(q)) : videoFiles;
    if (!shown.length) {
        host.innerHTML = `<div class="muted" style="padding:8px">Не найдено по запросу «${esc(q)}»</div>`;
        return;
    }
    shown.forEach((f, i) => {
        if (viewMode === "list") {
            const el = document.createElement("div");
            el.className = "vl-item" + (f.relPath === curRelPath ? " sel" : "");
            el.textContent = f.relPath;
            el.title = f.relPath + "  (клик — открыть в плеере)";
            el.onclick = () => loadVideo(f);   /* одинарный клик = открыть */
            host.appendChild(el);
        } else {
            /* подпись: basename, а при дублях имён — с подпапкой */
            const base = f.name;
            const dup = shown.filter(x => x.name === f.name).length > 1;
            const label = dup ? f.relPath : base;
            const el = document.createElement("div");
            el.className = "vl-tile" + (f.relPath === curRelPath ? " sel" : "");
            el.title = f.relPath;
            el.innerHTML = `
                <div class="thumb"><div class="thumb-img"></div></div>
                <span>${esc(label)}</span>`;
            el.onclick = () => loadVideo(f);
            host.appendChild(el);
            queuePoster(f, el.querySelector(".thumb-img"), el.querySelector(".thumb"));
        }
    });
}
$("btnRescan").addEventListener("click", () => {
    /* дескриптора папки нет — «обновить» = заново выбрать папку */
    pickFolderCompat();
});
/* поиск по имени файла: мгновенная фильтрация; Esc — очистить */
$("videoSearch").addEventListener("input", refreshVideoList);
$("videoSearch").addEventListener("keydown", e => {
    if (e.key === "Escape") {
        $("videoSearch").value = "";
        refreshVideoList();
        $("videoSearch").blur();
    }
});

/* ---------- плеер и метки (монитор в стиле Source Monitor) ---------- */
async function loadVideo(f) {
    const url = await ensureUrl(f);
    if (!url) return;
    const p = $("player");
    p.src = url;
    curFile = f.name;
    curRelPath = f.relPath;
    limitToMarks = false;
    previewLoop = false;
    marksSet = false;          /* новый файл: дефолтные края приедут в loadedmetadata */
    markIn = markOut = null;   /* дефолт поставится в loadedmetadata по длительности */
    updateMarks();
    /* подсветить текущий файл в списке */
    document.querySelectorAll(".vl-item.sel, .vl-tile.sel").forEach(x => x.classList.remove("sel"));
    const items = $("videoList").children;
    for (const it of items) {
        const nm = it.classList.contains("vl-item") ? it.textContent : it.querySelector("span")?.textContent;
        if (nm === f.relPath || nm === f.name) { it.classList.add("sel"); break; }
    }
    p.play().catch(() => {});
}
/* внятная причина, если браузер не тянет файл (чаще всего DJI в HEVC/H.265) */
$("player").addEventListener("error", () => {
    if (!curFile) return;
    toast("Браузер не воспроизводит «" + curFile +
          "». Вероятно, файл в HEVC (H.265) — откройте его в Safari или перекодируйте.", "err");
});
$("player").addEventListener("stalled", () => {
    if (curFile) toast("Файл читается медленно (сетевой диск) — подождите пару секунд…", "warn");
});
/* длительность файла — в tc-строке; метки по умолчанию на края файла
   (если пользователь/фрагмент уже задал свои — не трогаем) */
$("player").addEventListener("loadedmetadata", () => {
    const p = $("player");
    $("fileDur").textContent = "длительность " + tc(p.duration);
    if (!marksSet) { markIn = 0; markOut = p.duration; }
    updateMarks();
});
$("player").addEventListener("play", () => { $("btnPlay").textContent = "⏸"; });
$("player").addEventListener("pause", () => { $("btnPlay").textContent = "▶"; });
$("player").addEventListener("seeked", () => { $("curTc").textContent = tc($("player").currentTime); });
$("player").addEventListener("dblclick", () => $("btnPlay").click());

function frame() { return 1 / fpsVal(); }
function stepPlayer(sec) { const p = $("player"); p.currentTime = Math.max(0, Math.min(p.duration || 0, p.currentTime + sec)); }

/* --- скраббер: перемотка + зона in→out + ручки --- */
const scrub = $("scrubber");
function scrubFracToSec(frac) {
    const d = $("player").duration || 0;
    return Math.max(0, Math.min(d, frac * d));
}
function secToPct(sec) {
    const d = $("player").duration;
    return d ? (sec / d) * 100 : 0;
}
function seekFromEvent(e) {
    const r = scrub.getBoundingClientRect();
    const p = $("player");
    p.currentTime = scrubFracToSec((e.clientX - r.left) / r.width);
    /* пользователь увёл позицию за Out — ограничение фрагмента снимаем */
    if (markOut !== null && p.currentTime >= markOut) limitToMarks = false;
    updateScrub();
}
function updateScrub() {
    const p = $("player"), d = p.duration;
    const play = $("scrubPlay");
    if (!d) { play.hidden = true; $("scrubSel").hidden = true;
              $("scrubInH").hidden = true; $("scrubOutH").hidden = true; return; }
    play.hidden = false;
    play.style.left = secToPct(p.currentTime) + "%";
    const sel = $("scrubSel"), hIn = $("scrubInH"), hOut = $("scrubOutH");
    if (markIn !== null && markOut !== null) {
        sel.hidden = false;
        sel.style.left = secToPct(markIn) + "%";
        sel.style.width = (secToPct(markOut) - secToPct(markIn)) + "%";
        hIn.hidden = hOut.hidden = false;
        hIn.style.left = secToPct(markIn) + "%";
        hOut.style.left = secToPct(markOut) + "%";
        $("btnGoIn").disabled = $("btnGoOut").disabled = false;
    } else {
        sel.hidden = true; hIn.hidden = hOut.hidden = true;
        $("btnGoIn").disabled = $("btnGoOut").disabled = true;
    }
}
/* rAF-цикл: плавный бегунок (timeupdate грубоват) + ограничитель фрагмента */
(function scrubLoop() {
    const p = $("player");
    if (!p.paused && p.duration) {
        if (limitToMarks && markIn !== null && markOut !== null && p.currentTime >= markOut) {
            if (previewLoop) {
                p.currentTime = markIn;              /* цикл In→Out до нажатия P/паузы */
            } else {
                p.pause();
                p.currentTime = markOut;
                limitToMarks = false;
            }
        }
        $("scrubPlay").style.left = secToPct(p.currentTime) + "%";
        $("curTc").textContent = tc(p.currentTime);
    }
    requestAnimationFrame(scrubLoop);
})();

let scrubDrag = null;   /* {mode: "seek"|"in"|"out"} */
scrub.addEventListener("pointerdown", e => {
    if (!curFile || !$("player").duration) return;
    const h = e.target.classList;
    scrubDrag = h.contains("h-in") ? "in" : h.contains("h-out") ? "out" : "seek";
    scrub.setPointerCapture(e.pointerId);
    if (scrubDrag === "seek") seekFromEvent(e);
    else dragHandle(scrubDrag, e);
});
scrub.addEventListener("pointermove", e => {
    if (!scrubDrag) return;
    if (scrubDrag === "seek") seekFromEvent(e);
    else dragHandle(scrubDrag, e);
});
scrub.addEventListener("pointerup", () => { scrubDrag = null; updateMarks(); });
scrub.addEventListener("pointercancel", () => { scrubDrag = null; });
function dragHandle(which, e) {
    const r = scrub.getBoundingClientRect();
    const sec = scrubFracToSec((e.clientX - r.left) / r.width);
    const p = $("player");
    if (which === "in") {
        markIn = Math.min(sec, (markOut ?? p.duration) - frame());
        markIn = Math.max(0, markIn);
        p.currentTime = markIn;
    } else {
        markOut = Math.max(sec, (markIn ?? 0) + frame());
        markOut = Math.min(p.duration, markOut);
        p.currentTime = markOut;
    }
    updateScrub();
    updateMarksText();
}

$("btnSetIn").addEventListener("click", () => {
    if (!curFile) return toast("Сначала откройте видео (клик в списке)", "err");
    markIn = $("player").currentTime;
    marksSet = true;                       /* пользовательские метки — дефолт не перезапишет */
    if (markOut !== null && markOut <= markIn)
        markOut = Math.min($("player").duration, markIn + frame());  /* зона не пропадает */
    updateMarks();
});
$("btnSetOut").addEventListener("click", () => {
    if (!curFile) return toast("Сначала откройте видео", "err");
    if (markIn !== null && $("player").currentTime <= markIn)
        return toast("Out должен быть позже In", "err");
    markOut = $("player").currentTime;
    marksSet = true;
    updateMarks();
});
/* рамка метки вход/выход */
$("btnInBack1f").onclick = () => nudgeMark("in", -frame());
$("btnInFwd1f").onclick  = () => nudgeMark("in", +frame());
$("btnOutBack1f").onclick = () => nudgeMark("out", -frame());
$("btnOutFwd1f").onclick  = () => nudgeMark("out", +frame());
function nudgeMark(which, delta) {
    if (which === "in" && markIn !== null) {
        markIn = Math.max(0, markIn + delta);
        $("player").currentTime = markIn;
    } else if (which === "out" && markOut !== null) {
        markOut = Math.max(0, markOut + delta);
        $("player").currentTime = markOut;
    }
    updateMarks();
}
$("btnClearMarks").onclick = () => {
    /* сброс к краям файла (а не в пустоту): зона всегда видна */
    const p = $("player");
    if (!p.duration) return;
    markIn = 0;
    markOut = p.duration;
    marksSet = false;                      /* вернулись к дефолту */
    updateMarks();
};
$("btnGoIn").onclick = () => { if (markIn !== null) $("player").currentTime = markIn; };
$("btnGoOut").onclick = () => { if (markOut !== null) $("player").currentTime = markOut; };
$("btnPlay").onclick = () => {
    const p = $("player");
    if (!curFile) return toast("Сначала откройте видео (клик в списке)", "err");
    p.paused ? p.play().catch(() => {}) : p.pause();
};

/* P — циклический предпросмотр фрагмента In→Out */
function togglePreview() {
    const p = $("player");
    if (previewLoop) { previewLoop = false; limitToMarks = false; toast("Предпросмотр остановлен"); return; }
    if (!curFile) return toast("Сначала откройте видео (клик в списке)", "err");
    if (markIn === null || markOut === null || markOut <= markIn)
        return toast("Поставьте метки In и Out (I / O)", "err");
    previewLoop = true; limitToMarks = true;
    p.currentTime = markIn;
    p.play().catch(() => {});
    toast("Циклический предпросмотр In→Out (P — стоп)", "ok");
}
$("btnPreview").onclick = togglePreview;

function updateMarksText() {
    /* позиции ручек обновляет updateScrub(); текст ТК меток — при драге */
    $("curTc").textContent = tc($("player").currentTime);
}
function updateMarks() {
    updateScrub();
    updateMarksText();
}

/* ---------- блоки сценария ---------- */
/* drag&drop-перестановка блоков за ручку «⠿» */
let dragId = null, dropBefore = false;
function clearDrag() {
    dragId = null; dropBefore = false;
    document.body.classList.remove("dragging");
    document.querySelectorAll(".drop-above,.drop-below,.drag-src")
        .forEach(el => el.classList.remove("drop-above", "drop-below", "drag-src"));
}
document.addEventListener("dragend", clearDrag);

function newBlock(kind) {
    return {
        id: state.nextId++,
        kind,                    /* vo | standup | sync | life | spiegel | vod */
        text: "",
        speaker: "", role: "",   /* только sync */
        folded: false,           /* блок свёрнут в строку (вид, на порядок не влияет) */
        parts: []                /* {file,in,out}; несколько — у standup/sync/life/spiegel */
    };
}
/* ---------- режимы вида списка (порядок экспорта — всегда порядок массива) ---------- */
let blockCols = store.get("ss_cols", 1);
function setCols(n) {
    blockCols = n;
    store.set("ss_cols", n);
    $("blocks").classList.toggle("cols2", n === 2);
    $("col1").classList.toggle("on", n === 1);
    $("col2").classList.toggle("on", n === 2);
}
$("col1").onclick = () => setCols(1);
$("col2").onclick = () => setCols(2);
$("btnFoldAll").onclick = () => {
    const fold = state.blocks.some(b => !b.folded);
    state.blocks.forEach(b => b.folded = fold);
    renderBlocks(); saveState();
    toast(fold ? "Все блоки свёрнуты" : "Все блоки развернуты");
};
$("btnAddVO").onclick = () => { state.blocks.push(newBlock("vo")); renderBlocks(); saveState(); };
$("btnAddStandup").onclick = () => { state.blocks.push(newBlock("standup")); renderBlocks(); saveState(); };
$("btnAddSync").onclick = () => { state.blocks.push(newBlock("sync")); renderBlocks(); saveState(); };
$("btnAddLife").onclick = () => { state.blocks.push(newBlock("life")); renderBlocks(); saveState(); };
$("btnAddSpiegel").onclick = () => { state.blocks.push(newBlock("spiegel")); renderBlocks(); saveState(); };
$("btnAddVod").onclick = () => { state.blocks.push(newBlock("vod")); renderBlocks(); saveState(); };

/* заголовок блока. n — номер ПО ТИПУ (1-й закадр = «ЗК 1»,
   2-й синхрон = «Синхрон 2»), не позиция в сценарии.
   Шпигель и подводка в сюжете одни — без номера */
function blockTitle(b, n) {
    if (b.kind === "vo") return `ЗК ${n}`;
    if (b.kind === "standup") return `Стендап ${n}`;
    if (b.kind === "life") return `Лайф ${n}`;
    if (b.kind === "spiegel") return "Шпигель";
    if (b.kind === "vod") return "Подводка";
    return `Синхрон ${n}` + (b.speaker ? ` — ${b.speaker}` : "");
}
/* типовые номера всех блоков: {id: 1-based номер внутри своего типа} */
function typeNumbers() {
    const c = { vo: 0, standup: 0, sync: 0, life: 0, spiegel: 0, vod: 0 }, out = {};
    state.blocks.forEach(b => { c[b.kind]++; out[b.id] = c[b.kind]; });
    return out;
}
function partsDur(b) {
    return b.parts.reduce((s, p) => s + ((p.out ?? 0) - (p.in ?? 0)), 0);
}
/* размер блока, изменённый пользователем через resize-ручку */
function captureBlockSize(b, div) {
    const w = div.style.width, h = div.style.height;
    if ((w && w !== b.w) || (h && h !== b.h)) {
        b.w = w; b.h = h;
        saveState();
    }
}
/* предупреждение о дублях: имя файла встречается в нескольких подпапках */
function dupWarning(file) {
    const dups = videoFiles.filter(v => v.name === file.name);
    if (dups.length > 1)
        toast("Внимание: имя «" + file.name + "» есть в " + dups.length + " папках (" +
              dups.map(d => d.relPath).join("; ") + "). Добавлен: " + file.relPath, "warn");
}

function renderBlocks() {
    const host = $("blocks");
    host.innerHTML = "";
    let total = 0;
    const nums = typeNumbers();

    state.blocks.forEach((b, i) => {
        total += partsDur(b);
        const div = document.createElement("div");
        div.className = "block " + b.kind + (b.folded ? " folded" : "");
        div.dataset.id = b.id;
        /* сохранённый пользователем размер блока (если менял) */
        if (b.w) div.style.width = b.w;
        if (b.h) div.style.height = b.h;
        /* ручка resize: браузер сам тянет угол; после отпускания — фиксируем */
        div.addEventListener("mouseup", () => captureBlockSize(b, div));
        div.addEventListener("touchend", () => captureBlockSize(b, div));

        const dur = partsDur(b);
        const summary = b.folded
            ? `<span class="fold-sum">${esc((b.text || "").replace(/\s+/g, " ").trim().slice(0, 40)) || "без текста"}
                ${b.parts.length ? "· " + b.parts.length + " фр." : ""}${dur ? "· " + durHuman(dur) : ""}</span>`
            : `<span class="dur">${dur ? "(" + durHuman(dur) + ")" : ""}</span>`;
        div.innerHTML = `
            <div class="block-head">
                <span class="drag-h" draggable="true" title="Перетащите, чтобы изменить порядок">⠿</span>
                <span class="num">${i + 1}.</span>
                <span class="kind">${esc(blockTitle(b, nums[b.id]))}</span>
                ${summary}
                <span class="spacer"></span>
                <button class="icon-btn fold-btn" data-act="fold" title="Свернуть / развернуть">${b.folded ? "▸" : "▾"}</button>
                <button class="icon-btn" data-act="up"  title="Выше">↑</button>
                <button class="icon-btn" data-act="down" title="Ниже">↓</button>
                <button class="icon-btn" data-act="dup" title="Дублировать">⧉</button>
                <button class="icon-btn" data-act="del" title="Удалить">✕</button>
            </div>
            <div class="block-body" ${b.folded ? "hidden" : ""}>
            ${b.kind === "sync" ? `
                <div class="row">
                    <input class="b-speaker" placeholder="Спикер — ФИО" value="${esc(b.speaker)}">
                    <input class="b-role" placeholder="должность" value="${esc(b.role)}" style="max-width:220px">
                </div>` : ""}
            <textarea class="b-text" placeholder="${b.kind === "sync" ? "Расшифровка текста спикера…" :
                b.kind === "life" ? "Комментарий к лайфу (что в кадре, звук)…" :
                b.kind === "spiegel" ? "Текст шпигеля…" :
                b.kind === "vod" ? "Текст подводки…" : "Текст…"}">${esc(b.text)}</textarea>
            ${b.kind === "vod" ? "" : `
            <div class="parts"></div>
            <div class="row"><button class="add-part">+ файл/фрагмент</button></div>`}
            </div>
        `;
        const partsHost = div.querySelector(".parts");
        b.parts.forEach((p, pi) => {
            const pe = document.createElement("div");
            pe.className = "part";
            pe.innerHTML = `
                <span class="file" title="${esc(p.file)}">${esc(p.file)}</span>
                <span class="tc">${tc(p.in)} → ${tc(p.out)}</span>
                <button data-act="goto" title="Открыть в плеере">▶</button>
                <button data-act="del-part">✕</button>
            `;
            pe.querySelector("[data-act=del-part]").onclick = () => { b.parts.splice(pi, 1); renderBlocks(); saveState(); };
            pe.querySelector("[data-act=goto]").onclick = () => {
                const vf = videoFiles.find(v => v.name === p.file);
                if (!vf) return toast("Файл не в списке: " + p.file, "err");
                const dups = videoFiles.filter(v => v.name === p.file);
                if (dups.length > 1)
                    toast("Имя «" + p.file + "» встречается в " + dups.length +
                          " папках — открыт первый: " + vf.relPath, "warn");
                loadVideo(vf).then(() => {
                    /* метки фрагмента уже выставлены loadedmetadata (края файла) —
                       перезаписываем метками из блока */
                    markIn = p.in; markOut = p.out; marksSet = true; updateMarks();
                    $("player").currentTime = p.in;
                    limitToMarks = true;              /* играть только In→Out */
                    $("player").play().catch(() => {});
                });
            };
            partsHost.appendChild(pe);
        });
        const addPartBtn = div.querySelector(".add-part");
        if (addPartBtn) addPartBtn.onclick = () => {
            if (b.kind === "vo" && b.parts.length >= 1)
                return toast("У закадра один фрагмент. Для нескольких кусков сделайте синхрон или новый блок.", "err");
            if (!curFile) return toast("Сначала разметьте фрагмент в плеере", "err");
            if (markIn === null || markOut === null)
                return toast("Поставьте метки входа и выхода (I / O)", "err");
            const vf = videoFiles.find(v => v.name === curFile && v.relPath === curRelPath) ||
                       videoFiles.find(v => v.name === curFile);
            if (vf) dupWarning(vf);
            b.parts.push({ file: curFile, in: markIn, out: markOut });
            renderBlocks(); saveState();
        };
        div.querySelector(".b-text").addEventListener("input", e => { b.text = e.target.value; saveState(); });
        if (b.kind === "sync") {
            div.querySelector(".b-speaker").addEventListener("input", e => { b.speaker = e.target.value; saveState(); refreshTargets(); });
            div.querySelector(".b-role").addEventListener("input", e => { b.role = e.target.value; saveState(); });
        }
        div.addEventListener("click", e => {
            const act = e.target.closest("[data-act]")?.dataset.act;
            if (!act) return;
            if (act === "up" && i > 0) [state.blocks[i - 1], state.blocks[i]] = [b, state.blocks[i - 1]];
            if (act === "down" && i < state.blocks.length - 1) [state.blocks[i + 1], state.blocks[i]] = [b, state.blocks[i + 1]];
            if (act === "fold") b.folded = !b.folded;
            if (act === "dup") state.blocks.splice(i + 1, 0, JSON.parse(JSON.stringify({ ...b, id: state.nextId++ })));
            if (act === "del") {
                if (!confirm("Удалить блок «" + blockTitle(b, nums[b.id]) + "» со всеми фрагментами?")) return;
                state.blocks.splice(i, 1);
            }
            if (act !== "del-part" && act !== "goto") { renderBlocks(); saveState(); refreshTargets(); }
        });
        /* перетаскивание блока за «⠿» — новый порядок */
        const dh = div.querySelector(".drag-h");
        dh.addEventListener("dragstart", e => {
            dragId = b.id; dropBefore = false;
            div.classList.add("drag-src"); document.body.classList.add("dragging");
            e.dataTransfer.setData("text/plain", String(b.id));
            e.dataTransfer.effectAllowed = "move";
        });
        dh.addEventListener("dragend", clearDrag);
        div.addEventListener("dragover", e => {
            if (dragId === null || dragId === b.id) return;
            e.preventDefault();
            const r = div.getBoundingClientRect();
            dropBefore = e.clientY < r.top + r.height / 2;
            div.classList.toggle("drop-above", dropBefore);
            div.classList.toggle("drop-below", !dropBefore);
        });
        div.addEventListener("dragleave", () => div.classList.remove("drop-above", "drop-below"));
        div.addEventListener("drop", e => {
            if (dragId === null || dragId === b.id) return;
            e.preventDefault();
            const from = state.blocks.findIndex(x => x.id === dragId);
            if (from < 0) return clearDrag();
            const [blk] = state.blocks.splice(from, 1);
            let to = state.blocks.findIndex(x => x.id === b.id);
            if (!dropBefore) to++;
            state.blocks.splice(Math.max(0, Math.min(state.blocks.length, to)), 0, blk);
            clearDrag(); renderBlocks(); saveState();
        });
        host.appendChild(div);
    });

    $("totalDur").textContent = state.blocks.length
        ? "Общий хронометраж: " + (total > 0 ? durHuman(total) : "0 с") : "";
    refreshTargets();
}

/* цель для «В сценарий →»: существующие блоки + пункт «новый блок типа «как»» */
const NEW_TARGET = "__new__";
function refreshTargets() {
    const sel = $("targetBlock");
    const prev = sel.value;
    const nums = typeNumbers();
    const modeTxt = $("sendMode").selectedOptions[0].textContent;
    let html = `<option value="${NEW_TARGET}">+ новый: ${esc(modeTxt)}</option>`;
    html += state.blocks.map(b => {
        const t = blockTitle(b, nums[b.id]);
        const can = b.kind !== "vod" && (b.kind !== "vo" || b.parts.length === 0);
        return `<option value="${b.id}" ${can ? "" : "disabled"}>${esc(t)}</option>`;
    }).join("");
    sel.innerHTML = html;
    if ([...sel.options].some(o => o.value === prev && !o.disabled)) sel.value = prev;
}
$("sendMode").addEventListener("change", () => { store.set("ss_sendmode", $("sendMode").value); refreshTargets(); });
/* отправка разметки: в выбранный блок или в новый блок типа «как» */
$("btnSend").addEventListener("click", () => {
    if (!curFile) return toast("Сначала откройте видео", "err");
    if (markIn === null || markOut === null) return toast("Поставьте метки I и O", "err");
    const vf = videoFiles.find(v => v.name === curFile && v.relPath === curRelPath) ||
               videoFiles.find(v => v.name === curFile);
    if ($("targetBlock").value === NEW_TARGET) {
        const kind = $("sendMode").value;
        const b = newBlock(kind);
        if (kind === "vod") {
            state.blocks.push(b); renderBlocks(); saveState();
            return toast("Блок «Подводка» создан — видеофрагменты в него не добавляются", "warn");
        }
        if (vf) dupWarning(vf);
        b.parts.push({ file: curFile, in: markIn, out: markOut });
        state.blocks.push(b);
        const nums = typeNumbers();
        renderBlocks(); saveState();
        return toast("Создан блок «" + blockTitle(b, nums[b.id]) + "» с фрагментом", "ok");
    }
    const id = parseInt($("targetBlock").value, 10);
    const b = state.blocks.find(x => x.id === id);
    if (!b) return toast("Выберите блок", "err");
    if (b.kind === "vod") return toast("У подводки нет видеофрагментов", "err");
    if (b.kind === "vo" && b.parts.length >= 1)
        return toast("В закадровом блоке уже есть фрагмент", "err");
    if (vf) dupWarning(vf);
    b.parts.push({ file: curFile, in: markIn, out: markOut });
    const nums = typeNumbers();
    renderBlocks(); saveState();
    toast("Добавлено в «" + blockTitle(b, nums[b.id]) + "»", "ok");
});

/* ---------- горячие клавиши плеера ---------- */
document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !$("namesModal").hidden) { closeNmModal(); return; }
    const inField = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");
    if (inField) return;
    const p = $("player");
    if (e.key === "i" || e.key === "I" || e.key === "ш" || e.key === "Ш") {
        e.shiftKey ? $("btnGoIn").click() : $("btnSetIn").click();
    }
    else if (e.key === "o" || e.key === "O" || e.key === "щ" || e.key === "Щ") {
        e.shiftKey ? $("btnGoOut").click() : $("btnSetOut").click();
    }
    else if (e.key === "ArrowLeft") { e.preventDefault(); stepPlayer(e.shiftKey ? -1 : -frame()); }
    else if (e.key === "ArrowRight") { e.preventDefault(); stepPlayer(e.shiftKey ? 1 : frame()); }
    else if (e.key === " ") { e.preventDefault(); p.paused ? p.play() : p.pause(); }
    else if (e.key === "p" || e.key === "P" || e.key === "з" || e.key === "З") { e.preventDefault(); togglePreview(); }
});

/* ---------- экспорт: CSV для Fish Cutter (разделитель на выбор, экранирование) ---------- */
function buildCsv() {
    const r = resolveNameValue("fioReporter"), c = resolveNameValue("fioCam"), ed = resolveNameValue("fioEditor");
    const sep = $("csvSep").value;
    const cell = s => {
        s = String(s);
        return (s.includes(sep) || /["\n\r]/.test(s)) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const row = (...cols) => cols.map(cell).join(sep === ";" ? "; " : sep);
    const L = [];
    L.push("# Fish Cutter — сценарий, собранный в «Сюжет-Студии»");
    L.push("# Сюжет: " + ($("storyTitle").value || "—"));
    L.push("# Корреспондент: " + (r || "—") + "; Оператор: " + (c || "—") + "; Монтажёр: " + (ed || "—"));
    L.push("# Таймкод: NDF " + fpsVal() + " к/с; Дата: " + new Date().toISOString().slice(0, 10));
    L.push("#");
    L.push(row("файл", "вход", "выход", "подпись"));
    let voN = 0, suN = 0, syN = 0, liN = 0;
    state.blocks.forEach(b => {
        if (b.kind === "vo") {
            voN++;
            L.push("#");
            L.push("# ——— ЗАКАДР " + voN + " ———");
            b.text.split(/\r?\n/).forEach(t => L.push("# " + t));
            (b.parts || []).forEach(p => L.push(row(p.file, tc(p.in), tc(p.out), "ЗК" + voN)));
        } else if (b.kind === "standup") {
            suN++;
            L.push("#");
            L.push("# ——— СТЕНДАП " + suN + " ———");
            b.text.split(/\r?\n/).forEach(t => L.push("# " + t));
            b.parts.forEach((p, pi) =>
                L.push(row(p.file, tc(p.in), tc(p.out),
                           b.parts.length > 1 ? `СТЕНД${suN}-${pi + 1}` : `СТЕНД${suN}`)));
        } else if (b.kind === "life") {
            liN++;
            L.push("#");
            L.push("# ——— ЛАЙФ " + liN + " ———");
            if (b.text) b.text.split(/\r?\n/).forEach(t => L.push("# " + t));
            b.parts.forEach((p, pi) =>
                L.push(row(p.file, tc(p.in), tc(p.out),
                           b.parts.length > 1 ? `ЛАЙФ${liN}-${pi + 1}` : `ЛАЙФ${liN}`)));
        } else if (b.kind === "spiegel") {
            L.push("#");
            L.push("# ——— ШПИГЕЛЬ ———");
            if (b.text) b.text.split(/\r?\n/).forEach(t => L.push("# " + t));
            b.parts.forEach((p, pi) =>
                L.push(row(p.file, tc(p.in), tc(p.out), "ШПИГ")));
        } else if (b.kind === "vod") {
            L.push("#");
            L.push("# ——— ПОДВОДКА ———");
            b.text.split(/\r?\n/).forEach(t => L.push("# " + t));
        } else {
            syN++;
            L.push("#");
            L.push("# ——— СИНХРОН " + syN + ": " + (b.speaker || "спикер") +
                   (b.role ? ", " + b.role : "") + " ———");
            b.text.split(/\r?\n/).forEach(t => L.push("# " + t));
            b.parts.forEach((p, pi) =>
                L.push(row(p.file, tc(p.in), tc(p.out), `СИНХ${syN}-${pi + 1} ${b.speaker}`)));
        }
    });
    /* CSV в кодировке UTF-8 с BOM — Excel и панель читают корректно */
    return "\uFEFF" + L.join("\r\n");
}

/* ---------- экспорт: Word для редактора (без файлов и таймкодов) ---------- */
function buildDoc() {
    const h = s => esc(s).replace(/\n/g, "<br>");
    let body = `<h1>${h($("storyTitle").value || "Сюжет")}</h1>
        <p><b>Корреспондент:</b> ${h(resolveNameValue("fioReporter")) || "—"}<br>
        <b>Оператор:</b> ${h(resolveNameValue("fioCam")) || "—"}<br>
        <b>Монтажёр:</b> ${h(resolveNameValue("fioEditor")) || "—"}<br>
        <b>Дата:</b> ${h(new Date().toISOString().slice(0, 10))}</p><hr>`;
    let voN = 0, suN = 0, syN = 0, liN = 0;
    state.blocks.forEach(b => {
        if (b.kind === "vo") { voN++; body += `<h3>Закадровый текст ${voN}</h3><p>${h(b.text)}</p>`; }
        else if (b.kind === "standup") { suN++; body += `<h3>Стендап ${suN}</h3><p>${h(b.text)}</p>`; }
        else if (b.kind === "life") { liN++; body += `<h3>Лайф ${liN}</h3>${b.text ? `<p>${h(b.text)}</p>` : ""}`; }
        else if (b.kind === "spiegel") { body += `<h3>Шпигель</h3>${b.text ? `<p>${h(b.text)}</p>` : ""}`; }
        else if (b.kind === "vod") { body += `<h3>Подводка</h3><p>${h(b.text)}</p>`; }
        else {
            syN++;
            body += `<h3>Синхрон ${syN}. ${h(b.speaker)}${b.role ? ", " + h(b.role) : ""}</h3><p>${h(b.text)}</p>`;
        }
    });
    const html = `<html xmlns:w="urn:schemas-microsoft-com:office:word">
        <head><meta charset="utf-8"><style>
        body{font-family:'Times New Roman',serif;font-size:14pt}
        h1{font-size:18pt} h3{font-size:14pt;margin-bottom:4pt}
        p{margin:6pt 0;text-align:justify}
        </style></head><body>${body}</body></html>`;
    return "\uFEFF" + html;
}

function download(name, content, mime) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function slug(s) {
    return (s || "сюжет").replace(/[^\wа-яёА-ЯЁ\- ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 60);
}
$("btnExportCsv").onclick = () => {
    if (!state.blocks.length) return toast("Сценарий пуст", "err");
    download(slug($("storyTitle").value) + "_fishcutter.csv", buildCsv(), "text/csv;charset=utf-8");
    toast("CSV сохранён — откройте его в Fish Cutter («Загрузить файл…»)", "ok");
};
$("btnExportDoc").onclick = () => {
    if (!state.blocks.length) return toast("Сценарий пуст", "err");
    download(slug($("storyTitle").value) + "_для_редактора.doc", buildDoc(),
             "application/msword;charset=utf-8");
    toast("Word-файл сохранён", "ok");
};

/* ---------- черновик JSON + автосохранение ---------- */
const KINDS = new Set(["vo", "standup", "sync", "life", "spiegel", "vod"]);
/* приведение блоков из localStorage/черновика к безопасному виду */
function normalizeBlocks(arr) {
    return (Array.isArray(arr) ? arr : []).filter(b => b && typeof b === "object" && KINDS.has(b.kind))
        .map(b => ({
            id: Number.isFinite(+b.id) ? +b.id : state.nextId++,
            kind: b.kind,
            text: typeof b.text === "string" ? b.text : "",
            speaker: typeof b.speaker === "string" ? b.speaker : "",
            role: typeof b.role === "string" ? b.role : "",
            w: typeof b.w === "string" ? b.w : "",
            h: typeof b.h === "string" ? b.h : "",
            folded: !!b.folded,
            parts: (b.kind === "vod" || !Array.isArray(b.parts) ? [] : b.parts)
                .filter(p => p && typeof p.file === "string" &&
                             Number.isFinite(+p.in) && Number.isFinite(+p.out) && +p.out > +p.in && +p.in >= 0)
                .map(p => ({ file: p.file, in: +p.in, out: +p.out }))
        }));
}
function saveState() {
    saveReq();
    store.set("ss_blocks", state.blocks);
    store.set("ss_nextId", state.nextId);
}
function loadDraftData(d) {
    if (!d || !Array.isArray(d.blocks)) return false;
    state.blocks = normalizeBlocks(d.blocks);
    const maxId = Math.max(0, ...state.blocks.map(b => b.id));
    state.nextId = Math.max(+d.nextId || 1, maxId + 1);
    if (d.req && typeof d.req === "object") {   /* реквизиты (включая fps) — в тот же черновик */
        store.set("ss_req", d.req);
        loadReq();
    }
    renderBlocks();
    return true;
}
$("btnSaveDraft").onclick = () =>
    download(slug($("storyTitle").value) + "_черновик.json",
             JSON.stringify({ blocks: state.blocks, nextId: state.nextId, req: store.get("ss_req", {}) }, null, 1),
             "application/json");
$("btnLoadDraft").onclick = () => $("draftFile").click();
$("draftFile").onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
        try { loadDraftData(JSON.parse(rd.result)); toast("Черновик загружен", "ok"); }
        catch (err) { toast("Не JSON: " + err.message, "err"); }
    };
    rd.readAsText(f);
    e.target.value = "";
};

/* ---------- старт ---------- */
loadReq();
/* сохранённые настройки панели «В сценарий» и экспорта */
const savedMode = store.get("ss_sendmode", "");
if (savedMode && [...$("sendMode").options].some(o => o.value === savedMode)) $("sendMode").value = savedMode;
const savedSep = store.get("ss_sep", ";");
if ([...$("csvSep").options].some(o => o.value === savedSep)) $("csvSep").value = savedSep;
$("csvSep").addEventListener("change", () => store.set("ss_sep", $("csvSep").value));
/* общий список ФИО из names.json — перерисовать select'ы после загрузки
   (refreshNameSelects сохранит восстановленный выбор) */
loadSharedNames(refreshNameSelects);
setView(viewMode);          /* применить сохранённый вид списка и подсветку кнопок */
setCols(blockCols);         /* сохранённый вид списка блоков (1/2 колонки) */
if (!loadDraftData({ blocks: store.get("ss_blocks", []), nextId: store.get("ss_nextId", 1) }))
    renderBlocks();
const savedDir = store.get("ss_dirname", "");
if (savedDir)
    $("folderName").textContent = `в прошлый раз: «${savedDir}» — выберите папку заново`;
