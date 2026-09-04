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
const REQ_IDS = ["storyTitle","fpsInput","readSpeed","fioReporter","fioCam","fioEditor"];
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
/* обложки-бейджи: внутренние ключи не меняем — только отображение */
const KIND_META = {
    headline: { badge: "HEADLINE", ru: "Заголовок" },
    vod:      { badge: "LEAD",     ru: "Подводка"  },
    vo:       { badge: "VO",       ru: "ЗК"        },
    sync:     { badge: "SOT",      ru: "Синхрон"   },
    standup:  { badge: "STANDUP",  ru: "Стендап"   },
    life:     { badge: "LIFE",     ru: "Лайф"      },
    spiegel:  { badge: "SPIEGEL",  ru: "Шпигель"   }
};
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
$("btnFoldAll").onclick = () => {
    const fold = state.blocks.some(b => !b.folded);
    state.blocks.forEach(b => b.folded = fold);
    renderBlocks(); saveState();
    toast(fold ? "Все блоки свёрнуты" : "Все блоки развернуты");
};
function addAndFocus(kind) {
    histBefore();
    const b = newBlock(kind);
    state.blocks.push(b);
    renderBlocks(); saveState(); refreshTargets();
    focusBlock(b.id, 0);
    setCurrentBlock(b.id);
}
$("btnAddVO").onclick = () => addAndFocus("vo");
$("btnAddStandup").onclick = () => addAndFocus("standup");
$("btnAddSync").onclick = () => addAndFocus("sync");
$("btnAddLife").onclick = () => addAndFocus("life");
$("btnAddHeadline").onclick = () => addAndFocus("headline");
$("btnAddSpiegel").onclick = () => addAndFocus("spiegel");
$("btnAddVod").onclick = () => addAndFocus("vod");

/* заголовок блока для тостов/подтверждений/экспорта (внутренние русские имена) */
function blockTitle(b, n) {
    if (b.kind === "vo") return `ЗК ${n}`;
    if (b.kind === "standup") return `Стендап ${n}`;
    if (b.kind === "life") return `Лайф ${n}`;
    if (b.kind === "spiegel") return "Шпигель";
    if (b.kind === "vod") return "Подводка";
    if (b.kind === "headline") return `Заголовок ${n}`;
    return `Синхрон ${n}` + (b.speaker ? ` — ${b.speaker}` : "");
}
/* типовые номера всех блоков: {id: 1-based номер внутри своего типа} */
function typeNumbers() {
    const c = { headline: 0, vo: 0, standup: 0, sync: 0, life: 0, spiegel: 0, vod: 0 }, out = {};
    state.blocks.forEach(b => { c[b.kind]++; out[b.id] = c[b.kind]; });
    return out;
}
function partsDur(b) {
    return b.parts.reduce((s, p) => s + ((p.out ?? 0) - (p.in ?? 0)), 0);
}
/* ---------- длительности блока ---------- */
/* скорость чтения диктора, зн/сек (поле в шапке, по умолчанию 540 зн/мин = 9 зн/с) */
function readCps() {
    const v = parseFloat($("readSpeed").value);
    return (v > 60 && v <= 2400) ? v / 60 : 9;
}
function estDur(b) {
    const s = (b.text || "").replace(/\s+/g, " ").trim();
    return s ? Math.round(s.length / readCps()) : 0;
}
/* факт по фрагментам, иначе оценка по тексту (для него в UI приставка «~») */
function blockDur(b) {
    if (PART_KINDS.has(b.kind) && b.parts.length) return partsDur(b);
    return estDur(b);
}
function durTc(sec) {
    if (!sec) return "";
    const s = Math.round(sec);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
/* предупреждение о дублях: имя файла встречается в нескольких подпапках */
function dupWarning(file) {
    const dups = videoFiles.filter(v => v.name === file.name);
    if (dups.length > 1)
        toast("Внимание: имя «" + file.name + "» есть в " + dups.length + " папках (" +
              dups.map(d => d.relPath).join("; ") + "). Добавлен: " + file.relPath, "warn");
}

/* ---------- «печатная машинка»: набор текста как в Word ---------- */
const PART_KINDS = new Set(["sync", "standup", "life", "spiegel"]);
/* триггеры нового блока: слово в начало новой строки + пробел/Enter */
const DOC_TRIGGERS = {
    "зк": "vo", "з/к": "vo", "закадр": "vo", "закадровый": "vo", "vo": "vo",
    "синх": "sync", "синхрон": "sync", "sot": "sync",
    "стенд": "standup", "стендап": "standup", "standup": "standup",
    "лайф": "life", "life": "life",
    "шпи": "spiegel", "шпигель": "spiegel", "spiegel": "spiegel",
    "подв": "vod", "подводка": "vod", "лид": "vod", "lead": "vod",
    "хед": "headline", "хедлайн": "headline", "заголовок": "headline", "headline": "headline",
};
/* смена типа по клику на бейдж */
function closeKindMenu() { const m = $("kindMenu"); if (m) m.remove(); }
function changeBlockKind(b, kind) {
    closeKindMenu();
    if (kind === b.kind) return;
    if (b.parts.length && !PART_KINDS.has(kind) &&
        !confirm("В блоке есть фрагменты — при смене типа они будут удалены. Продолжить?")) return;
    histBefore();
    b.kind = kind;
    if (!PART_KINDS.has(kind)) b.parts = [];
    renderBlocks(); saveState(); refreshTargets();
}
function showKindMenu(b, anchor) {
    closeKindMenu();
    const menu = document.createElement("div");
    menu.id = "kindMenu"; menu.className = "kind-menu";
    Object.entries(KIND_META).forEach(([k, m]) => {
        const it = document.createElement("button");
        it.className = "kind-item " + k + (k === b.kind ? " sel" : "");
        it.textContent = m.badge;
        it.onmousedown = e => { e.stopPropagation(); changeBlockKind(b, k); };
        menu.appendChild(it);
    });
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.left = Math.min(r.left, window.innerWidth - 140) + "px";
    menu.style.top = (r.bottom + 4) + "px";
    setTimeout(() => document.addEventListener("mousedown", closeKindMenu, { once: true }), 0);
}
let currentBlockId = null;

function autogrow(ta) {
    ta.style.height = "auto";
    ta.style.height = (ta.scrollHeight + 2) + "px";
}
function focusBlock(id, caret) {
    const ta = document.querySelector('.doc-block[data-id="' + id + '"] .doc-text');
    if (!ta) return;
    ta.focus();
    try { ta.setSelectionRange(caret || 0, caret || 0); } catch (e) {}
}
function setCurrentBlock(id) {
    currentBlockId = id;
    const b = state.blocks.find(x => x.id === id);
    const lbl = $("curBlock");
    if (!lbl) return;
    if (!b) { lbl.textContent = ""; return; }
    lbl.textContent = "→ " + blockTitle(b, typeNumbers()[b.id]);
    const opt = [...$("targetBlock").options].find(o => +o.value === id && !o.disabled);
    if (opt) $("targetBlock").value = String(id);      /* «В сценарий →» целит в текущий */
}
/* «зк », «синх » — рождение нового блока на ходу */
function docTrigger(ta, b, i) {
    const pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) return false;
    const val = ta.value;
    const lineStart = val.lastIndexOf("\n", pos - 1) + 1;
    const word = val.slice(lineStart, pos).trim().toLowerCase();
    const kind = DOC_TRIGGERS[word];
    if (!kind) return false;
    const rest = val.slice(pos);
    histBefore();
    if (lineStart === 0 && !rest.trim() && !b.parts.length) {
        /* блок и так пуст (триггер — всё, что набрано) — переквалифицируем его */
        b.kind = kind; b.text = "";
        renderBlocks(); saveState(); refreshTargets();
        focusBlock(b.id, 0);
        return true;
    }
    b.text = val.slice(0, lineStart).replace(/\s+$/, "");
    const nb = newBlock(kind);
    nb.text = rest.trim();
    state.blocks.splice(i + 1, 0, nb);
    renderBlocks(); saveState(); refreshTargets();
    focusBlock(nb.id, 0);
    return true;
}
/* Backspace в начале пустой строки — склейка с предыдущим блоком */
function docMergePrev(b, i) {
    if (i <= 0) return false;
    const prev = state.blocks[i - 1];
    if (b.parts.length && !PART_KINDS.has(prev.kind)) {
        toast("У блока есть фрагменты — сначала перенесите их в другой блок", "err");
        return true;
    }
    histBefore();
    const joinAt = (prev.text || "").length;
    prev.text = (prev.text ? prev.text + "\n" : "") + b.text;
    if (prev.kind === "sync" && !prev.speaker && b.speaker) { prev.speaker = b.speaker; prev.role = b.role; }
    if (b.parts.length) prev.parts = prev.parts.concat(b.parts);
    state.blocks.splice(i, 1);
    renderBlocks(); saveState(); refreshTargets();
    focusBlock(prev.id, joinAt);
    return true;
}
function moveBlock(id, dir) {
    const i = state.blocks.findIndex(x => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= state.blocks.length) return;
    histBefore();
    const [b] = state.blocks.splice(i, 1);
    state.blocks.splice(j, 0, b);
    const ta = document.activeElement;
    const caret = ta && ta.selectionStart ? ta.selectionStart : 0;
    renderBlocks(); saveState(); refreshTargets();
    focusBlock(id, caret);
}
function pullPart(b) {
    if (!PART_KINDS.has(b.kind))
        return toast("Этот блок — только текст", "err");
    if (!curFile) return toast("Сначала откройте видео (клик в списке)", "err");
    if (markIn === null || markOut === null)
        return toast("Поставьте метки входа и выхода (I / O)", "err");
    histBefore();
    const vf = videoFiles.find(v => v.name === curFile && v.relPath === curRelPath) ||
               videoFiles.find(v => v.name === curFile);
    if (vf) dupWarning(vf);
    b.parts.push({ file: curFile, in: markIn, out: markOut });
    renderBlocks(); saveState();
    toast("Фрагмент добавлен в «" + blockTitle(b, typeNumbers()[b.id]) + "»", "ok");
    focusBlock(b.id, 99999);
}

/* ---------- Ctrl+Z / Ctrl+Y: снапшоты документа ---------- */
const undoStack = [], redoStack = [];
let typingBurst = 0;
function serializeDoc() { return JSON.stringify({ b: state.blocks, n: state.nextId }); }
/* вызывать ДО структурного изменения */
function histBefore() {
    undoStack.push(serializeDoc());
    if (undoStack.length > 120) undoStack.shift();
    redoStack.length = 0;
    typingBurst = 0;
}
/* вызывать ПЕРЕД применением символа при печати: новый снимок — только начало серии (>600 мс) */
function histTyping() {
    const now = Date.now();
    if (now - typingBurst > 600) {
        undoStack.push(serializeDoc());
        if (undoStack.length > 120) undoStack.shift();
        redoStack.length = 0;
    }
    typingBurst = now;
}
function histRestore(s) {
    const d = JSON.parse(s);
    state.blocks = d.b; state.nextId = d.n;
    renderBlocks(); saveState();
}
function doUndo() {
    if (!undoStack.length) return toast("Отменять нечего", "warn");
    redoStack.push(serializeDoc());
    histRestore(undoStack.pop());
    toast("Отменено (Ctrl+Y — вернуть)");
}
function doRedo() {
    if (!redoStack.length) return;
    undoStack.push(serializeDoc());
    histRestore(redoStack.pop());
}

function renderBlocks() {
    const host = $("blocks");
    host.innerHTML = "";
    let total = 0;
    const nums = typeNumbers();
    if (!state.blocks.length) {
        host.innerHTML = '<div class="empty-hint">Документ пуст. Начните печатать с кнопок сверху, ' +
            'или наберите в новой строке «хед», «лид», «зк», «синх», «стенд», «лайф», «шпи» + пробел.</div>';
    }

    state.blocks.forEach((b, i) => {
        const dur = blockDur(b);
        total += dur;
        const est = !(PART_KINDS.has(b.kind) && b.parts.length) && dur > 0;
        const div = document.createElement("div");
        div.className = "doc-block " + b.kind + (b.folded ? " folded" : "");
        div.dataset.id = b.id;

        const ph = b.kind === "headline" ? "Текст заголовки на экране…" :
                   b.kind === "sync" ? "Реплика спикера в кавычках…" :
                   b.kind === "life" ? "Что в кадре, звук…" :
                   b.kind === "spiegel" ? "Текст шпигеля…" :
                   b.kind === "vod" ? "Текст подводки (отвода)…" : "Текст…";
        const foldsum = b.folded
            ? `<div class="fold-sum">${esc((b.text || "").replace(/\s+/g, " ").trim().slice(0, 90)) ||
               (b.speaker ? esc(b.speaker) : "без текста")}<span class="muted">
               ${b.parts.length ? " · " + b.parts.length + " фр." : ""}</span></div>` : "";
        div.innerHTML = `
            <button class="badge ${b.kind}" data-act="badge" title="Сменить тип блока">${esc(KIND_META[b.kind].badge)}</button>
            <div class="doc-main">
                ${b.kind === "sync" ? `<div class="doc-speaker">
                    <input class="b-speaker" placeholder="СПИКЕР — ФИО" value="${esc(b.speaker)}">
                    <span class="sot-suf">(СИНХРОН)</span>
                    <input class="b-role" placeholder="должность" value="${esc(b.role)}"></div>` : ""}
                ${foldsum}
                <textarea class="doc-text" rows="1" placeholder="${ph}">${esc(b.text)}</textarea>
                ${PART_KINDS.has(b.kind) ? `
                <div class="doc-parts"></div>
                <button class="doc-pull" data-act="pull" title="Или Alt+Enter в тексте блока">🎞 Добавить фрагмент из плеера (I/O)</button>` : ""}
            </div>
            <span class="doc-dur" title="${est ? "Оценка по длине текста (~9 зн/с, настраивается в шапке)" : "Сумма таймкодов фрагментов"}">${est ? "~" : ""}${durTc(dur)}</span>
            <div class="doc-tools">
                <button data-act="fold" title="Свернуть / развернуть">${b.folded ? "▸" : "▾"}</button>
                <button data-act="dup" title="Дублировать">⧉</button>
                <button data-act="del" title="Удалить">✕</button>
            </div>
        `;

        const partsHost = div.querySelector(".doc-parts");
        if (partsHost) b.parts.forEach((p, pi) => {
            const pe = document.createElement("div");
            pe.className = "doc-part";
            pe.innerHTML = `
                <span class="file" title="${esc(p.file)}">${esc(p.file)}</span>
                <span class="tc">${tc(p.in)} → ${tc(p.out)}</span>
                <span class="tc">${durHuman(p.out - p.in)}</span>
                <button data-act="goto" title="Открыть в плеере">▶</button>
                <button data-act="del-part" title="Убрать фрагмент">✕</button>
            `;
            pe.querySelector("[data-act=del-part]").onclick = () => { histBefore(); b.parts.splice(pi, 1); renderBlocks(); saveState(); };
            pe.querySelector("[data-act=goto]").onclick = () => {
                const vf = videoFiles.find(v => v.name === p.file);
                if (!vf) return toast("Файл не в списке: " + p.file, "err");
                const dups = videoFiles.filter(v => v.name === p.file);
                if (dups.length > 1)
                    toast("Имя «" + p.file + "» встречается в " + dups.length +
                          " папках — открыт первый: " + vf.relPath, "warn");
                loadVideo(vf).then(() => {
                    markIn = p.in; markOut = p.out; marksSet = true; updateMarks();
                    $("player").currentTime = p.in;
                    limitToMarks = true;
                    $("player").play().catch(() => {});
                });
            };
            partsHost.appendChild(pe);
        });

        const ta = div.querySelector(".doc-text");
        autogrow(ta);
        ta.addEventListener("input", () => { histTyping(); b.text = ta.value; autogrow(ta); saveState(); refreshDur(i); });
        ta.addEventListener("focus", () => setCurrentBlock(b.id));
        ta.addEventListener("keydown", e => {
            if ((e.key === " " || e.key === "Enter") && docTrigger(ta, b, i)) { e.preventDefault(); return; }
            if (e.key === "Backspace" && ta.selectionStart === 0 && ta.selectionEnd === 0 && docMergePrev(b, i)) { e.preventDefault(); return; }
            if (e.altKey && e.key === "ArrowUp")   { e.preventDefault(); moveBlock(b.id, -1); return; }
            if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); moveBlock(b.id, +1); return; }
            if (e.altKey && e.key === "Enter")     { e.preventDefault(); pullPart(b); return; }
        });
        if (b.kind === "sync") {
            div.querySelector(".b-speaker").addEventListener("input", e => { histTyping(); b.speaker = e.target.value; saveState(); refreshTargets(); });
            div.querySelector(".b-role").addEventListener("input", e => { histTyping(); b.role = e.target.value; saveState(); });
        }
        div.addEventListener("click", e => {
            const act = e.target.closest("[data-act]")?.dataset.act;
            if (!act) return;
            if (act === "badge") { showKindMenu(b, e.target.closest(".badge")); return; }
            if (act === "goto" || act === "del-part" || act === "pull") return;
            if (act === "fold") b.folded = !b.folded;
            if (act === "dup") { histBefore(); state.blocks.splice(i + 1, 0, JSON.parse(JSON.stringify({ ...b, id: state.nextId++ }))); }
            if (act === "del") {
                if (!confirm("Удалить блок «" + blockTitle(b, nums[b.id]) + "» со всеми фрагментами?")) return;
                histBefore();
                state.blocks.splice(i, 1);
            }
            renderBlocks(); saveState(); refreshTargets();
        });
        div.querySelector('[data-act=pull]')?.addEventListener("click", () => pullPart(b));
        host.appendChild(div);
    });

    if (currentBlockId) {
        const cur = state.blocks.find(x => x.id === currentBlockId);
        if (!cur) setCurrentBlock(null); else setCurrentBlock(cur.id);
    }
    $("totalDur").textContent = state.blocks.length
        ? "Хронометраж: " + (total > 0 ? durTc(total) + " (оценки с ~)" : "00:00") : "";
    refreshTargets();
}
/* обновить только колонку длительности (без полного ререндера при печати) */
function refreshDur(i) {
    const el = $("blocks").children[i];
    if (!el || !el.querySelector) return;
    const b = state.blocks[i];
    const dur = blockDur(b);
    const est = !(PART_KINDS.has(b.kind) && b.parts.length) && dur > 0;
    const cell = el.querySelector(".doc-dur");
    if (cell) cell.textContent = (est ? "~" : "") + durTc(dur);
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
        const can = PART_KINDS.has(b.kind);
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
        if (!PART_KINDS.has(kind)) {
            state.blocks.push(b); renderBlocks(); saveState();
            return toast("Блок «" + blockTitle(b, typeNumbers()[b.id]) + "» создан — это только текст, фрагмент не добавлен", "warn");
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
    if (!PART_KINDS.has(b.kind)) return toast("Этот блок — только текст. Фрагменты — в SOT, стендап, лайф или шпигель", "err");
    if (vf) dupWarning(vf);
    b.parts.push({ file: curFile, in: markIn, out: markOut });
    const nums = typeNumbers();
    renderBlocks(); saveState();
    toast("Добавлено в «" + blockTitle(b, nums[b.id]) + "»", "ok");
});

/* ---------- горячие клавиши плеера ---------- */
document.addEventListener("keydown", e => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Escape") {
        if (!$("findBar").hidden) { closeSearch(); return; }
        if (!$("wordModal").hidden) { closeWordReview(); return; }
        if (!$("namesModal").hidden) { closeNmModal(); return; }
    }
    if (mod && !e.altKey && /^(z|я)$/i.test(e.key)) { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (mod && !e.altKey && /^(y|н)$/i.test(e.key)) { e.preventDefault(); doRedo(); return; }
    if (mod && /^(f|а)$/i.test(e.key)) { e.preventDefault(); openSearch(); return; }
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

/* ---------- поиск по сюжету (Ctrl+F) ---------- */
let findHits = [], findPos = -1;
function openSearch() {
    $("findBar").hidden = false;
    $("findInput").focus();
    $("findInput").select();
    doFind();
}
function closeSearch() {
    $("findBar").hidden = true;
    findHits = []; findPos = -1;
    $("findCount").textContent = "";
}
function collectFind(q) {
    findHits = []; findPos = -1;
    if (!q) { $("findCount").textContent = ""; return; }
    const needle = q.toLowerCase();
    state.blocks.forEach(b => {
        const hay = (b.kind === "sync" ? (b.speaker + " " + b.role + "\n") : "") + b.text;
        let i = hay.toLowerCase().indexOf(needle);
        while (i !== -1) {
            findHits.push({ id: b.id, start: i });
            if (findHits.length > 500) return;
            i = hay.toLowerCase().indexOf(needle, i + needle.length);
        }
    });
    $("findCount").textContent = findHits.length ? "" : "ничего не найдено";
}
function gotoFind(delta) {
    if (!findHits.length) return;
    findPos = (findPos + delta + findHits.length) % findHits.length;
    const h = findHits[findPos];
    const el = document.querySelector('.doc-block[data-id="' + h.id + '"]');
    if (!el) return;
    const b = state.blocks.find(x => x.id === h.id);
    if (b.folded) { b.folded = false; renderBlocks(); }
    const ta = document.querySelector('.doc-block[data-id="' + h.id + '"] .doc-text');
    $("findCount").textContent = (findPos + 1) + " / " + findHits.length;
    if (ta) {
        const inText = Math.max(0, h.start - ((b.kind === "sync") ? (b.speaker + " " + b.role + "\n").length : 0));
        ta.scrollIntoView({ block: "center", behavior: "smooth" });
        ta.focus();
        try { ta.setSelectionRange(inText, inText + ($("findInput").value || "").length); } catch (e) {}
    } else {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
}
function doFind() {
    collectFind(($("findInput").value || "").trim());
    if (findHits.length) gotoFind(1);
}
$("findInput").addEventListener("input", doFind);
$("findInput").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); gotoFind(e.shiftKey ? -1 : 1); }
});
$("findNext").onclick = () => gotoFind(1);
$("findPrev").onclick = () => gotoFind(-1);
$("findClose").onclick = closeSearch;
$("btnFind").onclick = () => $("findBar").hidden ? openSearch() : closeSearch();

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
    let voN = 0, suN = 0, syN = 0, liN = 0, hdN = 0;
    state.blocks.forEach(b => {
        if (b.kind === "headline") {
            hdN++;
            L.push("#");
            L.push("# ——— ЗАГОЛОВОК " + hdN + " ———");
            b.text.split(/\r?\n/).forEach(t => L.push("# " + t));
        } else if (b.kind === "vo") {
            voN++;
            L.push("#");
            L.push("# ——— ЗАКАДР " + voN + " ———");
            b.text.split(/\r?\n/).forEach(t => L.push("# " + t));
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
    let voN = 0, suN = 0, syN = 0, liN = 0, hdN = 0;
    state.blocks.forEach(b => {
        if (b.kind === "headline") { hdN++; body += `<h3>Заголовок ${hdN}</h3><p>${h(b.text)}</p>`; }
        else if (b.kind === "vo") { voN++; body += `<h3>Закадровый текст ${voN}</h3><p>${h(b.text)}</p>`; }
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
const KINDS = new Set(["headline", "vo", "standup", "sync", "life", "spiegel", "vod"]);
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
            parts: ((b.kind === "vod" || b.kind === "vo") || !Array.isArray(b.parts) ? [] : b.parts)
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

/* ---------- импорт правок редактора из Word (тексты блоков) ---------- */
$("btnImportWord").onclick = () => $("wordFile").click();
$("wordFile").onchange = e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) importWordFile(f);
};

/* заголовки блоков, как их печатает buildDoc (нумерация — по типу) */
function parseWordHead(h) {
    let m;
    if ((m = h.match(/^заголовок\s*(\d+)/i)) || (m = h.match(/^headline\s*(\d+)/i)))
        return { kind: "headline", num: +m[1] };
    if (/^закадр/i.test(h) || /^зк[\s.]/i.test(h) || /^vo\b/i.test(h)) {
        const d = h.match(/\d+/);
        return { kind: "vo", num: d ? +d[0] : NaN };
    }
    if ((m = h.match(/^стендап\s*(\d+)/i)) || (m = h.match(/^standup\s*(\d+)/i))) return { kind: "standup", num: +m[1] };
    if ((m = h.match(/^лайф\s*(\d+)/i)) || (m = h.match(/^life\s*(\d+)/i))) return { kind: "life", num: +m[1] };
    if (/^шпигель/i.test(h) || /^spiegel/i.test(h)) return { kind: "spiegel" };
    if (/^подвод/i.test(h) || /^lead\b/i.test(h)) return { kind: "vod" };
    if ((m = h.match(/^синхрон\s*(\d+)\s*[.．]?\s*(.*)$/i)) || (m = h.match(/^sot\s*(\d+)\s*[.．]?\s*(.*)$/i))) {
        const parts = (m[2] || "").split(/[,;]/);
        return { kind: "sync", num: +m[1],
                 speaker: (parts.shift() || "").replace(/^—+\s*/, "").trim(),
                 role: parts.join(", ").trim() };
    }
    return null;
}
function normWs(s) { return (s || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim(); }
/* текст блочного элемента: <br> → перевод строки, остальное — в одну строку */
function blockLineText(el) {
    const c = el.cloneNode(true);
    c.querySelectorAll("br").forEach(b => b.replaceWith("\u0001"));
    return normWs(c.textContent).replace(/\u0001/g, "\n").trim();
}
/* из последовательности «заголовок + абзацы» — список блоков документа */
function wordItemsToBlocks(items) {
    const blocks = [], unknown = [];
    items.forEach(it => {
        const key = parseWordHead(it.head);
        if (key) blocks.push(Object.assign({ text: it.lines.join("\n") }, key));
        else unknown.push(it.head);
    });
    return { blocks, unknown };
}
/* наш .doc (он же HTML), в т.ч. пересохранённый Word (классы MsoHeading…) */
function parseWordHtml(text) {
    const dom = new DOMParser().parseFromString(text, "text/html");
    const BLK = "h1,h2,h3,h4,h5,h6,p,li";
    const nodes = [...dom.querySelectorAll(BLK)].filter(el => !el.querySelector(BLK));
    [...dom.querySelectorAll("[class]")].forEach(el => {
        if (/heading/i.test(el.className) && !nodes.includes(el) && !el.querySelector(BLK)) nodes.push(el);
    });
    const items = [];
    let cur = null;
    for (const el of nodes) {
        const isHead = /^H[1-6]$/.test(el.tagName) || /heading/i.test(el.className || "");
        const txt = isHead ? normWs(el.textContent) : blockLineText(el);
        if (!txt) continue;
        if (isHead) { cur = { head: txt, lines: [] }; items.push(cur); }
        else if (cur) cur.lines.push(txt);
    }
    return wordItemsToBlocks(items);
}
/* минимальный zip-ридер для word/document.xml внутри .docx */
async function docunzip(buf, wantName) {
    const dv = new DataView(buf), te = new TextDecoder();
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= 0 && i > buf.byteLength - 66000; i--)
        if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("повреждён zip-архив");
    let off = dv.getUint32(eocd + 16, true);
    const count = dv.getUint16(eocd + 10, true);
    for (let n = 0; n < count; n++) {
        if (dv.getUint32(off, true) !== 0x02014b50) break;
        const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
        const nlen = dv.getUint16(off + 28, true), xlen = dv.getUint16(off + 30, true),
              clen = dv.getUint16(off + 32, true), loff = dv.getUint32(off + 42, true);
        const name = te.decode(new Uint8Array(buf, off + 46, nlen));
        if (name === wantName) {
            const lnlen = dv.getUint16(loff + 26, true), lxlen = dv.getUint16(loff + 28, true);
            const comp = new Uint8Array(buf, loff + 30 + lnlen + lxlen, csize);
            if (method === 0) return te.decode(comp);
            const out = new Blob([comp]).stream()
                .pipeThrough(new DecompressionStream("deflate-raw"));
            return te.decode(await new Response(out).arrayBuffer());
        }
        off += 46 + nlen + xlen + clen;
    }
    throw new Error("внутри нет word/document.xml");
}
/* текст w:p: w:t → строки, w:br/w:cr → перевод строки */
function docxParaText(p) {
    let out = "";
    const walk = n => {
        for (const c of n.childNodes) {
            if (c.nodeName === "w:t") out += c.textContent;
            else if (c.nodeName === "w:br" || c.nodeName === "w:cr") out += "\u0001";
            else if (c.nodeType === 1) walk(c);
        }
    };
    walk(p);
    return normWs(out).replace(/\u0001/g, "\n").trim();
}
async function parseDocx(arrayBuf) {
    const b = new Uint8Array(arrayBuf);
    if (b[0] !== 0x50 || b[1] !== 0x4b) throw new Error("это не zip (не похоже на .docx)");
    if (typeof DecompressionStream === "undefined")
        throw new Error("браузер не умеет читать .docx — сохраните файл как .doc");
    const xml = await docunzip(arrayBuf, "word/document.xml");
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const items = [];
    let cur = null;
    [...doc.getElementsByTagName("w:p")].forEach(p => {
        const st = p.getElementsByTagName("w:pStyle")[0];
        const style = st ? (st.getAttribute("w:val") || "") : "";
        const text = docxParaText(p);
        if (!text) return;
        if (/heading/i.test(style)) { cur = { head: normWs(text), lines: [] }; items.push(cur); }
        else if (cur) cur.lines.push(text);
    });
    return wordItemsToBlocks(items);
}
/* если UTF-8 прочитался «кракозябрами» без кириллицы — перечитать в windows-1251 */
function readAsTextSmart(f) {
    return new Promise((res, rej) => {
        const rd = new FileReader();
        rd.onerror = () => rej(new Error("файл не читается"));
        rd.onload = () => {
            const s = rd.result || "";
            const cyr = (s.match(/[а-яёА-ЯЁ]/g) || []).length;
            /* мало кириллицы + следы битого UTF-8/латиницы → вероятно, windows-1251 */
            if (cyr < 20 && /\uFFFD|[\u0591-\u07BF]|[À-ÿ]/.test(s)) {
                const rd2 = new FileReader();
                rd2.onload = () => res(rd2.result);
                rd2.onerror = () => res(s);
                rd2.readAsText(f, "windows-1251");
            } else res(s);
        };
        rd.readAsText(f, "utf-8");
    });
}
async function importWordFile(f) {
    try {
        const parsed = /\.docx$/i.test(f.name)
            ? await parseDocx(await f.arrayBuffer())
            : parseWordHtml(await readAsTextSmart(f));
        if (!parsed.blocks.length) {
            toast("В файле нет знакомых заголовков («Закадровый текст 1», «Синхрон 2…»)", "err");
            return;
        }
        openWordReview(parsed);
    } catch (e) {
        toast("Файл не прочитан: " + e.message, "err");
    }
}

let wordPlan = null;   /* {rows, fresh, unknown} */
function buildWordPlan(parsed) {
    const nums = typeNumbers();
    const used = new Set(), rows = [], fresh = [];
    parsed.blocks.forEach(it => {
        const free = state.blocks.filter(x => x.kind === it.kind && !used.has(x.id));
        let b;
        if (Number.isFinite(it.num)) b = free.find(x => nums[x.id] === it.num);
        if (!b && (it.kind === "spiegel" || it.kind === "vod")) b = free[0];
        if (!b && it.kind === "sync" && it.speaker)          /* подстраховка: поиск по спикеру */
            b = free.find(x => normWs(x.speaker).toLowerCase() === it.speaker.toLowerCase());
        if (!b) { fresh.push(it); return; }
        used.add(b.id);
        const textChanged = normWs(it.text) !== normWs(b.text);
        const speakerChanged = b.kind === "sync" && it.speaker && normWs(it.speaker) !== normWs(b.speaker);
        const roleChanged = b.kind === "sync" && it.role && normWs(it.role) !== normWs(b.role);
        rows.push({ b, it, removed: false, changed: textChanged || speakerChanged || roleChanged,
                    textChanged, speakerChanged, roleChanged });
    });
    state.blocks.forEach(b => { if (!used.has(b.id)) rows.push({ b, it: null, removed: false, changed: false, missing: true }); });
    rows.sort((x, y) => state.blocks.indexOf(x.b) - state.blocks.indexOf(y.b));
    return { rows, fresh, unknown: parsed.unknown || [] };
}
function openWordReview(parsed) {
    wordPlan = buildWordPlan(parsed);
    $("wordModal").hidden = false;
    renderWordReview();
}
function closeWordReview() { $("wordModal").hidden = true; wordPlan = null; }
function wmChangedCount() {
    return wordPlan ? wordPlan.rows.filter(r => r.changed && !r.removed).length : 0;
}
function renderWordReview() {
    if (!wordPlan) return;
    const p = wordPlan;
    $("wmSummary").textContent =
        "Изменено: " + wmChangedCount() + "  ·  без изменений: " +
        p.rows.filter(r => !r.changed && !r.removed && !r.missing).length +
        "  ·  нет в Word: " + p.rows.filter(r => r.missing).length +
        "  ·  новых в Word (не импортируются): " + p.fresh.length;
    const onlyChanged = $("wmOnlyChanged").checked;
    const host = $("wmList");
    host.innerHTML = "";
    p.rows.forEach((r, ri) => {
        if (onlyChanged && !r.changed && !r.missing) return;
        const el = document.createElement("div");
        el.className = "wm-row" + (r.changed ? " ch" : "") + (r.missing ? " miss" : "");
        const title = blockTitle(r.b, typeNumbers()[r.b.id]);
        const bits = [];
        if (r.textChanged) bits.push("текст");
        if (r.speakerChanged) bits.push("спикер");
        if (r.roleChanged) bits.push("должность");
        el.innerHTML = `
            <div class="wm-row-head">
                <span class="wm-title">${esc(title)}</span>
                <span class="wm-tag">${r.missing ? "нет в правке Word" : bits.length ? esc(bits.join(" · ")) : "без изменений"}</span>
                ${r.missing ? `<label class="wm-del"><input type="checkbox" data-wm="del" data-ri="${ri}"> удалить блок</label>` : ""}
                <span class="spacer"></span>
                <button class="icon-btn" data-wm="exp" title="Показать/скрыть тексты">…</button>
            </div>
            ${r.changed ? `<div class="wm-diff" hidden>
                <div><h4>в сюжете сейчас</h4><pre>${esc(r.b.text || "—")}</pre></div>
                <div><h4>в Word</h4><pre>${esc(r.it && r.it.text || "—")}</pre></div>
            </div>` : ""}
        `;
        el.querySelector('[data-wm=exp]').onclick = () => {
            const d = el.querySelector(".wm-diff");
            if (d) d.hidden = !d.hidden;
        };
        const del = el.querySelector('[data-wm=del]');
        if (del) del.onchange = () => { r.removed = del.checked; updateWmApply(); };
        host.appendChild(el);
    });
    if (!host.children.length)
        host.innerHTML = '<div class="muted" style="padding:8px">Отличий нет — правки совпадают с сюжетом.</div>';
    updateWmApply();
}
function updateWmApply() {
    const nDel = wordPlan ? wordPlan.rows.filter(r => r.removed).length : 0;
    const btn = $("wmApply");
    btn.disabled = !(wmChangedCount() + nDel);
    btn.textContent = nDel ? "Применить (тексты + удалить " + nDel + ")" : "Применить";
}
$("wmApply").onclick = () => {
    if (!wordPlan) return;
    const nums = typeNumbers();
    let upd = 0;
    const toDelete = [];
    wordPlan.rows.forEach(r => {
        if (r.removed) { toDelete.push(r.b.id); return; }
        if (!r.changed) return;
        if (r.textChanged) r.b.text = r.it.text;
        if (r.speakerChanged) r.b.speaker = r.it.speaker;
        if (r.roleChanged) r.b.role = r.it.role;
        upd++;
    });
    if (toDelete.length) state.blocks = state.blocks.filter(b => !toDelete.includes(b.id));
    closeWordReview();
    renderBlocks(); saveState();
    toast("Правки применены: обновлено " + upd + " блок(ов)" +
          (toDelete.length ? ", удалено " + toDelete.length : ""), "ok");
};
$("wmCancel").onclick = closeWordReview;
$("wmClose").onclick = closeWordReview;
$("wmOnlyChanged").onchange = renderWordReview;
$("wordModal").addEventListener("mousedown", e => { if (e.target === $("wordModal")) closeWordReview(); });

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
if (!loadDraftData({ blocks: store.get("ss_blocks", []), nextId: store.get("ss_nextId", 1) }))
    renderBlocks();
const savedDir = store.get("ss_dirname", "");
if (savedDir)
    $("folderName").textContent = `в прошлый раз: «${savedDir}» — выберите папку заново`;
