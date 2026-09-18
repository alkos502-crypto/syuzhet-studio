/* Сюжет-Студия — фронтенд: блоки сценария, просмотрщик с метками, экспорт */
"use strict";

const $ = id => document.getElementById(id);
let quotaWarnShown = false;
window.SS_STORAGE_LOADING = true;
if ($("workspace")) $("workspace").inert = true;
let storageReq;
function lsUsage() {
    let total = 0; const sizes = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        let v = ""; try { v = localStorage.getItem(k) || ""; } catch (e) {}
        const b = (k.length + v.length) * 2; total += b; sizes.push([k, b]);
    }
    sizes.sort((a, b) => b[1] - a[1]);
    return { total, top: sizes.slice(0, 3) };
}
function quotaWarn(detail) {
    let u;
    try { u = lsUsage(); } catch (e) { u = { total: 0, top: [] }; }
    const top = u.top.map(x => x[0] + " ≈" + Math.round(x[1] / 1024) + "K").join(", ") || "пусто";
    const b = $("quotaBanner");
    if (b) {
        b.hidden = false;
        const info = $("quotaInfo");
        if (info) info.textContent = (detail ? detail + " · " : "") + "занято " + Math.round(u.total / 1024) + "K: " + top;
    }
    if (!quotaWarnShown) {
        quotaWarnShown = true;
        toast("Хранилище браузера не принимает сохранение — сохраните черновик: Проект → «Сохранить…»", "err", 9000);
    }
}
/* легаси-ключи: при нехватке места выкидываем их (данные дублируются в IndexedDB) */
const LS_EVICT = ["ss_blocks", "ss_nextId", "oc_stories", "oc_active"];
const store = {
    get(k, d) {
        try {
            if (k === "ss_req" && storageReq !== undefined) return JSON.parse(JSON.stringify(storageReq));
            const v = localStorage.getItem(k), value = v === null ? d : JSON.parse(v);
            if (k === "ss_req") storageReq = value;
            return value;
        } catch (e) { return d; }
    },
    set(k, v) {
        if (k === "ss_req") { storageReq = JSON.parse(JSON.stringify(v)); return true; }
        let s; try { s = JSON.stringify(v); } catch (e) { quotaWarn("сериализация: " + e.name); return false; }
        try { localStorage.setItem(k, s); return true; }
        catch (e) {
            if (/quota|storage/i.test((e && e.name) || "")) {
                /* одна попытка освободить легаси-дубли и повторить; сюжетные ключи
                   не трогаем, пока миграция в IDB не подтверждена — иначе удалим единственную копию */
                let freed = false;
                for (const dead of LS_EVICT) {
                    if (dead === k) continue;
                    if (!window.SS_LS_MIGRATED) continue;
                    if (localStorage.getItem(dead) !== null) { localStorage.removeItem(dead); freed = true; }
                }
                if (freed) { try { localStorage.setItem(k, s); return true; } catch (e2) {} }
            }
            quotaWarn("localStorage: " + ((e && e.name) || e));
            return false;
        }
    }
};

/* Точки расширения для оболочки МЕДИАЦЕНТРА (octopus.js назначает свои функции) —
   вместо опасного переназначения глобальных функций */
window.SS_HOOK = {
    afterDuration() {},
    afterRender() {},          /* после renderBlocks() */
    afterSave() {},            /* после saveState() */
    afterVideoList() {},       /* после refreshVideoList() */
    beforeSearch() {},         /* перед открытием панели поиска */
    draftMeta() { return null; },              /* доп. поля в .json-черновик */
    draftLoaded(d) {},                         /* черновик загружен (d.meta) */
    commentCount(id) { return 0; },            /* сколько комментариев у блока */
    showBlockComments(id) {},                  /* показать комментарии блока */
};

/* ---------- состояние ---------- */
let state = {
    blocks: [],       /* {id, kind: vo|standup|sync|life|spiegel|vod, text, speaker, role, parts:[{file,in,out}]} */
    nextId: 1
};
let videoFiles = [];           /* [{name, relPath, file, url|null}] */
let curFile = "";              /* имя файла в плеере */
let curRelPath = "";           /* путь внутри выбранной папки */
let videoLoadSeq = 0, videoLoading = false;
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
/* action = {label?, fn} — кнопка «Отменить» внутри тоста (кликабельный режим .act) */
function toast(msg, cls, ms, action) {
    const t = $("toast");
    t.textContent = "";
    const s = document.createElement("span");
    s.textContent = msg;
    t.appendChild(s);
    if (action) {
        const b = document.createElement("button");
        b.className = "toast-act";
        b.textContent = action.label || "Отменить";
        b.onclick = () => { clearTimeout(t._h); t.className = ""; action.fn(); };
        t.appendChild(b);
    }
    t.className = "show" + (cls ? " " + cls : "") + (action ? " act" : "");
    clearTimeout(t._h);
    t._h = setTimeout(() => (t.className = ""), ms || (action ? 5000 : 2600));
}

/* секунды -> 00:01:12:05. Для дробных fps (29.97/59.94) кадры считаются от
   round(fps): таймкод NDF тикает «секундами» по 30 (60) кадров, а 29.97 —
   это реальные кадры в секунду; делить на дробный fps нельзя — упреждение ~0.1% */
function tc(sec) {
    if (sec === null || sec === undefined || isNaN(sec)) return "—";
    const fps = fpsVal(), fb = Math.round(fps);
    let f = Math.round(sec * fps);
    if (f < 0) f = 0;
    const ff = f % fb; f = Math.floor(f / fb);
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
let sharedVer = 0;   /* версия names.json на сервере (_v) — защита от перезатирания */
function loadSharedNames(cb) {
    fetch("names.json", { cache: "no-store" })
        .then(r => (r.ok ? r.json() : {}))
        .then(j => {
            if (j && typeof j._v === "number") sharedVer = j._v;
            NAME_IDS.forEach(id => {
                const arr = j && Array.isArray(j[id]) ? j[id] : [];
                sharedNames[id] = arr.map(String);
            });
            if (cb) cb();
        })
        .catch(() => { if (cb) cb(); });
}
/* вернулись на вкладку — подтянуть общий список, чтобы не просить F5 */
document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    loadSharedNames(() => {
        refreshNameSelects();
        if (!$("namesModal").hidden) renderNm();
    });
});
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
    $(id).addEventListener("change", async () => {
        const sel = $(id);
        if (sel.value === "+") {
            const role = sel.dataset.role || "сотрудника";
            const v = ((await ask("Новое ФИО (" + role + ")",
                                  { placeholder: "Имя Фамилия Отчество", ok: "Добавить" })) || "").trim();
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
    const body = JSON.stringify(Object.assign({ _v: sharedVer }, sharedNames));
    fetch("names.json", { method: "POST", cache: "no-store",
                          headers: { "Content-Type": "application/json",
                                     "X-Requested-With": "XMLHttpRequest" },
                          body })
        .then(r => r.json().catch(() => ({})).then(j => ({ r, j })))
        .then(({ r, j }) => {
            nmBusy = false;
            if (r.ok) {
                if (typeof j._v === "number") sharedVer = j._v;
                if (onOk) onOk();
                refreshNameSelects(); saveReq(); renderNm();
                toast(successMsg || "Общий список обновлён — он виден всем", "ok");
            } else {
                sharedNames = snapshot;
                if (onFail) onFail();
                if (j && j.conflict) {   /* чужая версия — подтянуть и перерисовать */
                    loadSharedNames(() => { refreshNameSelects(); if (!$("namesModal").hidden) renderNm(); });
                }
                refreshNameSelects(); renderNm();
                const hint = (r.status === 501 || r.status === 405 || r.status === 404)
                    ? " — запущен старый сервер без поддержки записи: перезапустите «Запустить сервер.command»" : "";
                toast("Сохранение не удалось: " + ((j && j.error) || ("HTTP " + r.status)) + hint, "err", 5000);
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
            <button data-nm="del" title="Удалить" aria-label="Удалить имя">${icon("x",12)}</button>`;
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
async function nmDelete(id, oldN, isShared) {
    if (isShared) {
        if (!(await confirm2("Удалить из общего списка",
                "«" + oldN + "» исчезнет у всех коллег после обновления."))) return;
        nmAdjustSel(id, oldN, null);
        /* локальная авто-копия (saveReq) тоже мешает — убираем при успехе */
        const prevLocal = localNames(id);
        saveSharedNames(id, (sharedNames[id] || []).filter(x => x !== oldN), "Убрано из общего списка",
            () => setLocalNames(id, prevLocal.filter(x => x !== oldN)),
            () => setLocalNames(id, prevLocal));
    } else {
        if (!(await confirm2("Удалить локальное имя", "«" + oldN + "» будет убрано из списка на этом компьютере."))) return;
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
$("namesModal").addEventListener("keydown", e => trapTab(e.currentTarget.querySelector(".modal-box"), e));
document.querySelectorAll(".nf-gear").forEach(btn =>
    btn.addEventListener("click", () => openNmModal(btn.dataset.names)));
REQ_IDS.forEach(k => {
    if (NAME_IDS.includes(k) || k === "fpsInput") return;
    $(k).addEventListener("change", () => { saveReq(); if (k === "readSpeed") refreshDur(); });
    if (k === "readSpeed") $(k).addEventListener("input", () => refreshDur());
});
/* fps: валидация, пересчёт ТК на экране и в блоках; значение — в черновик/реквизиты */
$("fpsInput").addEventListener("change", () => {
    const inp = $("fpsInput");
    const v = parseFloat(inp.value);
    if (!(v > 0 && v <= 240)) inp.value = store.get("ss_req", {}).fpsInput || DEFAULT_FPS;
    saveReq();
    refreshTiming();
});
$("fpsInput").addEventListener("input", refreshTiming);
function refreshTiming() {
    if (Number.isFinite($("player").duration)) $("fileDur").textContent = tc($("player").duration);
    updateMarks();
    state.blocks.forEach((b, i) => {
        const rows = $("blocks").children[i]?.querySelectorAll(".doc-part");
        if (rows) rows.forEach((row, pi) => {
            const cell = row.querySelector(".tc"), part = b.parts[pi];
            if (cell && part) cell.textContent = tc(part.in) + " → " + tc(part.out);
        });
    });
    refreshDur();
}

/* ---------- модальные вопросы вместо prompt()/confirm() ---------- */
function trapTab(container, e) {
    if (e.key !== "Tab") return;
    const els = [...container.querySelectorAll(
        'button,input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])')]
        .filter(el => !el.disabled && el.offsetParent !== null);
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
let askState = null;
function askShow(opts) {
    return new Promise(res => {
        askState = { res };
        $("askTitle").textContent = opts.title || "";
        const msg = $("askMsg");
        msg.textContent = opts.message || "";
        msg.hidden = !opts.message;
        const inp = $("askInput");
        inp.hidden = !opts.input;
        if (opts.input) { inp.value = opts.value || ""; inp.placeholder = opts.placeholder || ""; }
        $("askOk").textContent = opts.ok || "ОК";
        $("askOk").classList.toggle("danger", !!opts.danger);
        $("askModal")._prevFocus = document.activeElement;
        $("askModal").hidden = false;
        (opts.input ? inp : $("askOk")).focus();
        if (opts.input) inp.select();
    });
}
function askDone(v) {
    const st = askState; if (!st) return;
    askState = null;
    $("askModal").hidden = true;
    const pf = $("askModal")._prevFocus;
    if (pf && pf.focus) try { pf.focus(); } catch (e) {}
    st.res(v);
}
function askSubmit() {
    const inp = $("askInput");
    askDone(inp.hidden ? true : (inp.value.trim() || null));
}
$("askOk").onclick = askSubmit;
$("askCancel").onclick = () => askDone(null);
$("askX").onclick = () => askDone(null);
$("askModal").addEventListener("mousedown", e => { if (e.target === $("askModal")) askDone(null); });
$("askModal").addEventListener("keydown", e => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); askDone(null); }
    else if (e.key === "Enter" && e.target === $("askInput")) { e.preventDefault(); askSubmit(); }
    else if (e.key === "Tab") trapTab($("askModal").querySelector(".modal-box"), e);
});
function ask(title, opts) { return askShow(Object.assign({ title, input: true }, opts)); }
function confirm2(title, message, opts) {
    return askShow(Object.assign({ title, message, input: false, ok: "Удалить", danger: true }, opts))
        .then(v => v !== null);
}

/* ---------- IndexedDB: кэш миниатюр и дескриптор папки (переживают refresh) ---------- */
const IDB = (() => {
    let dbP = null;
    function open() {
        if (!dbP) dbP = new Promise((res, rej) => {
            if (typeof indexedDB === "undefined") return rej(new Error("нет IndexedDB"));
            const r = indexedDB.open("ss-studio", 1);
            r.onupgradeneeded = () => { r.result.createObjectStore("posters"); r.result.createObjectStore("kv"); };
            r.onsuccess = () => {
                r.result.onversionchange = () => { r.result.close(); dbP = null; };
                res(r.result);
            };
            r.onerror = () => rej(r.error);
            r.onblocked = () => rej(new Error("IndexedDB заблокирован: закройте старые вкладки"));
        }).catch(e => { dbP = null; throw e; });
        return dbP;
    }
    function wrap(name, mode, fn) {
        return open().then(db => new Promise((res, rej) => {
            const t = db.transaction(name, mode);
            const rq = fn(t.objectStore(name));
            t.oncomplete = () => res(rq ? rq.result : undefined);
            t.onerror = () => rej(t.error || new Error("IndexedDB transaction failed"));
            t.onabort = () => rej(t.error || new Error("IndexedDB transaction aborted"));
        }));
    }
    function compareSnapshot(baseRev, value) {
        const snapshot = JSON.parse(JSON.stringify(value));
        return open().then(db => new Promise((res, rej) => {
            const t = db.transaction("kv", "readwrite"), o = t.objectStore("kv");
            let failure;
            t.oncomplete = () => res(snapshot);
            t.onerror = () => rej(failure || t.error || new Error("IndexedDB write failed"));
            t.onabort = () => rej(failure || t.error || new Error("IndexedDB aborted"));
            const r = o.get("oc_snapshot");
            r.onsuccess = () => {
                try {
                    const previous = r.result;
                    if ((previous ? previous.rev : null) !== baseRev) {
                        failure = new Error("Сюжеты изменены другой вкладкой");
                        failure.name = "ConflictError";
                        t.abort();
                        return;
                    }
                    if (!snapshot.rev || snapshot.rev === baseRev || !Array.isArray(snapshot.stories))
                        throw new Error("Некорректный снимок");
                    o.put(previous || snapshot, "oc_snapshot_backup");
                    o.put(snapshot, "oc_snapshot");
                } catch (e) { failure = e; t.abort(); }
            };
        }));
    }
    return {
        read: (s, k) => wrap(s, "readonly", o => o.get(k)),
        compareSnapshot,
        get: (s, k) => wrap(s, "readonly", o => o.get(k)).catch(() => undefined),
        set: (s, k, v) => wrap(s, "readwrite", o => o.put(v, k)).catch(() => {}),
        put: (s, k, v) => wrap(s, "readwrite", o => o.put(v, k)),
        del: (s, k) => wrap(s, "readwrite", o => o.delete(k)).catch(() => {}),
        clear: s => wrap(s, "readwrite", o => o.clear()).catch(() => {}),
    };
})();

/* ---------- выбор папки с видео (включая вложенные подпапки) ---------- */
/* Два пути:
   1) File System Access API (Chrome/Edge): дескриптор папки хранится в IndexedDB —
      после refresh страница может открыть её по клику ⟳ без повторного выбора
      (браузер один раз спросит разрешение).
   2) <input webkitdirectory> — стабильный фолбэк для сетевых томов (SMB). */
let dirHandle = null;
const HAS_FSA = typeof window.showDirectoryPicker === "function";
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
        IDB.clear("posters");
        dirHandle = null; IDB.del("kv", "dironly");
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
async function scanDirectory(rootHandle) {
    const out = [];
    async function walk(dir, rel) {
        for await (const [name, h] of dir.entries()) {
            if (h.kind === "directory") await walk(h, rel + "/" + name);
            else if (h.kind === "file" && VIDEO_RE.test(name)) {
                try {
                    const f = await h.getFile();
                    const relPath = rel + "/" + name;
                    out.push({ name, relPath, file: f, url: null, ck: relPath + "#" + (f.lastModified || 0) });
                } catch (e) {}     /* недоступный файл пропускаем */
            }
        }
    }
    await walk(rootHandle, rootHandle.name);
    return out;
}
async function openDirHandle() {
    if (!dirHandle) return false;
    let perm = "granted";
    try {
        if (dirHandle.queryPermission) {
            perm = await dirHandle.queryPermission({ mode: "read" });
            if (perm !== "granted") perm = await dirHandle.requestPermission({ mode: "read" });
        }
    } catch (e) {}
    if (perm !== "granted") { toast("Браузер не дал доступ к папке — выберите её заново", "err"); return false; }
    releaseBlobUrls(curRelPath);
    posterCache.clear(); IDB.clear("posters");
    try {
        videoFiles = await scanDirectory(dirHandle);
    } catch (e) {
        console.error("scanDirectory fail:", e);
        toast("Папку прочитать не удалось: " + e.message + " — выберите заново", "err");
        return false;
    }
    afterScan();
    return true;
}
async function pickFolderFSA() {
    let h;
    try { h = await window.showDirectoryPicker({ id: "ss-source", mode: "read" }); }
    catch (e) { return; }                       /* пользователь отменил — тихо */
    dirHandle = h;
    IDB.set("kv", "dironly", h);
    openDirHandle();
}
/* выбор папки: FSA если умеет, иначе webkitdirectory */
function pickFolder() { HAS_FSA ? pickFolderFSA() : pickFolderCompat(); }
async function restoreDirHandle() {
    try {
        const h = await IDB.get("kv", "dironly");
        if (h && h.kind === "directory") {
            dirHandle = h;
            if (!$("folderName").textContent)
                $("folderName").textContent = "«" + h.name + "»";
        }
    } catch (e) {}
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
    let root = "";
    if (videoFiles.length) {
        root = (videoFiles[0].relPath.split("/")[0] || "").trim();
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
    $("folderName").textContent = root ? "«" + root + "»" +
        (dirs.size ? "  ·  подпапок: " + dirs.size : "") : "";
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
const posterCache = new Map();   /* ck -> dataURL | "" (ошибка); горячая копия IDB-кэша */
const ckOf = f => f.ck || (f.ck = f.relPath + "#" + ((f.file && f.file.lastModified) || 0));
let posterQueue = [], posterBusy = false;

function applyPoster(ck, imgEl, tileEl) {
    const v = posterCache.get(ck);
    if (v) { if (imgEl.isConnected) imgEl.style.backgroundImage = `url("${v}")`; }
    else if (tileEl.isConnected) tileEl.classList.add("nothumb");
}
function queuePoster(file, imgEl, tileEl) {
    const ck = ckOf(file);
    if (posterCache.has(ck)) { applyPoster(ck, imgEl, tileEl); return; }
    IDB.get("posters", ck).then(v => {
        if (v) { posterCache.set(ck, v); applyPoster(ck, imgEl, tileEl); return; }
        /* элемент уже мог уехать при перерисовке — очередь на живых узлах */
        if (imgEl.isConnected && !posterQueue.some(q => q.file === file)) {
            posterQueue.push({ file, imgEl, tileEl });
            pumpPosterQueue();
        }
    });
}
function pumpPosterQueue() {
    if (posterBusy || !posterQueue.length) return;
    posterBusy = true;
    const { file, imgEl, tileEl } = posterQueue.shift();
    grabFrame(file, dataUrl => {
        const ck = ckOf(file);
        posterCache.set(ck, dataUrl || "");
        if (dataUrl) IDB.set("posters", ck, dataUrl);
        if (dataUrl && imgEl.isConnected) imgEl.style.backgroundImage = `url("${dataUrl}")`;
        else if (tileEl.isConnected) tileEl.classList.add("nothumb");
        const dEl = tileEl.isConnected && tileEl.querySelector(".vl-dur");
        if (dEl && file.dur) dEl.textContent = durTc(file.dur);
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
        try { file.dur = v.duration; } catch (e) {}
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

function usedPathSet() {
    const s = new Set();
    state.blocks.forEach(b => (b.parts || []).forEach(p => s.add(p.path || p.file)));
    return s;
}
/* метка «используется» (как красная точка в Project Panel Premiere) — без перестроения списка */
function updateUsedDots() {
    const used = usedPathSet();
    document.querySelectorAll("#videoList [data-rel]").forEach(el =>
        el.classList.toggle("used", used.has(el.dataset.rel)));
}
function refreshVideoList() {
    const host = $("videoList");
    host.innerHTML = "";
    if (!videoFiles.length) {
        host.innerHTML = '<div class="muted" style="padding:8px">Папка не выбрана или видео не найдено</div>';
    } else {
        /* фильтр по подстроке пути/имени (регистр не важен); videoFiles не мутируется */
        const q = $("videoSearch").value.trim().toLowerCase();
        const shown = q ? videoFiles.filter(f => f.relPath.toLowerCase().includes(q)) : videoFiles;
        if (!shown.length) {
            host.innerHTML = `<div class="muted" style="padding:8px">Не найдено по запросу «${esc(q)}»</div>`;
        } else {
            /* дубли имён считаем один раз, а не фильтром на каждую плитку */
            const dupCount = new Map();
            if (viewMode !== "list")
                shown.forEach(f => dupCount.set(f.name, (dupCount.get(f.name) || 0) + 1));
            const used = usedPathSet();
            shown.forEach(f => {
                const el = document.createElement("div");
                el.dataset.rel = f.relPath;
                el.draggable = true;          /* drag → блок СИНХ = добавить целый файл (К7) */
                const usedCls = used.has(f.relPath) ? " used" : "";
                if (viewMode === "list") {
                    el.className = "vl-item" + (f.relPath === curRelPath ? " sel" : "") + usedCls;
                    el.textContent = f.relPath;
                    el.title = f.relPath + "  (клик — открыть в плеере)" + (usedCls ? " · используется в блоках" : "");
                } else {
                    /* подпись: basename, а при дублях имён — с подпапкой */
                    el.className = "vl-tile" + (f.relPath === curRelPath ? " sel" : "") + usedCls;
                    el.title = f.relPath + (usedCls ? " — используется в блоках" : "");
                    el.innerHTML = `
                        <div class="thumb"><div class="thumb-img"></div><span class="vl-dur">${f.dur ? durTc(f.dur) : ""}</span></div>
                        <span class="vl-name">${esc(dupCount.get(f.name) > 1 ? f.relPath : f.name)}</span>`;
                }
                el.onclick = () => loadVideo(f);   /* одинарный клик = открыть */
                host.appendChild(el);
                if (viewMode !== "list")
                    queuePoster(f, el.querySelector(".thumb-img"), el.querySelector(".thumb"));
            });
        }
    }
    refreshTargets();
    SS_HOOK.afterVideoList();
}
$("btnRescan").addEventListener("click", () => {
    /* сохранён дескриптор папки — перечитать без повторного выбора (жест даёт разрешение) */
    if (dirHandle) { openDirHandle(); return; }
    pickFolder();
});
/* delegate drag-события списка: элементы пересоздаются при каждом refresh */
$("videoList").addEventListener("dragstart", e => {
    const it = e.target.closest("[data-rel]");
    if (!it) return;
    e.dataTransfer.setData("text/x-ss-file", it.dataset.rel);
    e.dataTransfer.effectAllowed = "copy";
});
$("videoList").addEventListener("dragend", () =>
    document.querySelectorAll("#blocks .drop-file").forEach(x => x.classList.remove("drop-file")));
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
    const seq = ++videoLoadSeq;
    videoLoading = true;
    markIn = markOut = null;
    updateMarks();
    const url = await ensureUrl(f);
    if (seq !== videoLoadSeq) return false;
    videoLoading = false;
    if (!url || !videoFiles.includes(f)) { updateMarks(); return false; }
    const p = $("player");
    p.src = url;
    curFile = f.name;
    curRelPath = f.relPath;
    const mf = $("monFile");
    if (mf) { mf.textContent = f.relPath; mf.title = f.relPath; }
    $("fileDur").textContent = "—";
    limitToMarks = false;
    previewLoop = false;
    marksSet = false;          /* новый файл: дефолтные края приедут в loadedmetadata */
    markIn = markOut = null;   /* дефолт поставится в loadedmetadata по длительности */
    updateMarks();
    /* подсветить текущий файл в списке (по data-rel, а не по тексту) */
    document.querySelectorAll(".vl-item.sel, .vl-tile.sel").forEach(x => x.classList.remove("sel"));
    const it = [...$("videoList").children].find(x => x.dataset.rel === f.relPath);
    if (it) it.classList.add("sel");
    p.play().catch(() => {});
    return true;
}
/* внятная причина, если браузер не тянет файл (чаще всего DJI в HEVC/H.265) */
$("player").addEventListener("error", () => {
    updateMarks();
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
    $("fileDur").textContent = tc(p.duration);
    if (!marksSet) { markIn = 0; markOut = p.duration; }
    updateMarks();
});
["durationchange", "emptied", "loadstart"].forEach(name => $("player").addEventListener(name, updateMarks));
$("player").addEventListener("play", () => { $("btnPlay").classList.add("playing"); });
$("player").addEventListener("pause", () => { $("btnPlay").classList.remove("playing"); });
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
    marksSet = true;
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
/* (кнопки в транспортёре нет — только клавиша P) */

function updateMarksText() {
    $("curTc").textContent = tc($("player").currentTime);
    const values = {
        markInTc: Number.isFinite(markIn) ? tc(markIn) : "—",
        markOutTc: Number.isFinite(markOut) ? tc(markOut) : "—",
        markDuration: Number.isFinite(markIn) && Number.isFinite(markOut) && markOut > markIn ? tc(markOut - markIn) : "—"
    };
    Object.entries(values).forEach(([id, text]) => { if ($(id)) $(id).textContent = text; });
    refreshTargets();
}
function updateMarks() {
    updateScrub();
    updateMarksText();
}

/* ---------- блоки сценария ---------- */
/* Реестр пиктограмм: stroke 2px, currentColor, viewBox 24 — единый язык с иконками транспорта.
   Ключи видов совпадают с kind-ключами — b.kind попадает в icon() напрямую. */
const ICONS = {
    headline: '<path d="M5 6h14"/><path d="M12 6v13"/><path d="M9 19h6"/>',
    vod:      '<path d="M4 12h11"/><path d="m11.5 7.5 4.5 4.5-4.5 4.5"/><path d="M20 5v14"/>',
    vo:       '<path d="M11 5 6.5 8.8H4v6.4h2.5L11 19z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6"/><path d="M18.3 6.2a8.5 8.5 0 0 1 0 11.6"/>',
    sync:     '<rect x="9.2" y="2.8" width="5.6" height="10.4" rx="2.8"/><path d="M12 13.2V21"/>',
    standup:  '<circle cx="8.5" cy="5.6" r="2.6"/><path d="M4.4 20c.9-3.7 2.7-5.7 5-5.7 1.3 0 2.4.5 3.3 1.5"/><rect x="16" y="4.6" width="3.4" height="6.4" rx="1.7"/><path d="M17.7 13.4V16"/>',
    life:     '<circle cx="12" cy="12" r="1.9"/><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6"/><path d="M5.4 5.4a9.4 9.4 0 0 0 0 13.2M18.6 5.4a9.4 9.4 0 0 1 0 13.2"/>',
    spiegel:  '<rect x="3.5" y="4" width="17" height="10" rx="1.5"/><path d="M7 8h10M7 10.8h6"/><path d="M7 18.4h10"/>',
    gear:     '<circle cx="12" cy="12" r="3.1"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8"/>',
    person:   '<circle cx="12" cy="7.6" r="3.4"/><path d="M5.5 20.5c1.2-3.8 3.6-5.8 6.5-5.8s5.3 2 6.5 5.8"/>',
    bubble:   '<path d="M21 14.5a3 3 0 0 1-3 3H8l-5 4.2V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z"/>',
    film:     '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M7.2 5v14M16.8 5v14M3 9.7h4.2M3 14.3h4.2M16.8 9.7H21M16.8 14.3H21"/>',
    x:        '<path d="m6 6 12 12M18 6 6 18"/>',
    chevD:    '<path d="m6 9.5 6 6 6-6"/>',
    chevU:    '<path d="m6 14.5 6-6 6 6"/>',
    chevL:    '<path d="m15 5.5-7 6.5 7 6.5"/>',
    chevR:    '<path d="m9 5.5 7 6.5-7 6.5"/>',
    fold:     '<path d="M20 4 15 9M15 9h-4M15 9v-4"/><path d="M4 20l5-5M9 15h4M9 15v4"/>',
    pencil:   '<path d="m4.5 19.5 1.2-4.2L16.7 4.3a2 2 0 0 1 2.9 2.9L8.6 18.3z"/>',
};
function icon(name, size) {
    return `<svg viewBox="0 0 24 24" width="${size || 13}" height="${size || 13}" fill="none" stroke="currentColor" ` +
           `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}
/* обложки-бейджи: внутренние ключи не меняем; метка — интернациональный код + пиктограмма */
const KIND_META = {
    headline: { badge: "HEADLINE", ru: "Заголовок" },
    vod:      { badge: "LEAD",     ru: "Подводка"  },
    vo:       { badge: "VO",       ru: "ЗК"        },
    sync:     { badge: "SOT",      ru: "Синхрон"   },
    standup:  { badge: "STANDUP",  ru: "Стендап"   },
    life:     { badge: "LIFE",     ru: "Лайф"      },
    spiegel:  { badge: "SPIEGEL",  ru: "Шпигель"   }
};
function badgeHtml(kind) {
    return icon(kind) + `<span>${esc(KIND_META[kind].badge)}</span>`;
}
function newBlock(kind) {
    return {
        id: state.nextId++,
        kind,                    /* vo | standup | sync | life | spiegel | vod */
        text: "",
        speaker: "", role: "",   /* только sync */
        folded: false,           /* блок свёрнут в строку (вид, на порядок не влияет) */
        partsFolded: false,      /* список присоединённых фрагментов свёрнут (вид) */
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

/* ПКМ по пустому месту окна сценария — меню «добавить блок» (в конец) */
function closeAddKindMenu(restoreFocus = false) {
    const menu = $("addKindMenu");
    if (!menu) return;
    const anchor = menu._anchor;
    document.removeEventListener("mousedown", menu._outside, true);
    document.removeEventListener("keydown", menu._keys, true);
    menu.remove();
    if (anchor) anchor.setAttribute("aria-expanded", "false");
    if (restoreFocus && anchor?.isConnected) anchor.focus();
}
function showAddKindMenu(x, y, anchor = document.activeElement) {
    closeAddKindMenu();
    const menu = document.createElement("div");
    menu.id = "addKindMenu"; menu.className = "kind-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Добавить блок");
    menu._anchor = anchor;
    if (anchor) anchor.setAttribute("aria-expanded", "true");
    Object.entries(KIND_META).forEach(([k, m]) => {
        const it = document.createElement("button");
        it.type = "button";
        it.setAttribute("role", "menuitem");
        it.className = "kind-item " + k;
        it.innerHTML = `${icon(k, 14)}<span class="ki-code">${esc(m.badge)}</span><span class="ki-ru">${esc(m.ru)}</span>`;
        it.onclick = () => { closeAddKindMenu(); addAndFocus(k); };
        menu.appendChild(it);
    });
    document.body.appendChild(menu);
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8)) + "px";
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8)) + "px";
    menu._outside = e => { if (!menu.contains(e.target) && !anchor?.contains(e.target)) closeAddKindMenu(); };
    document.addEventListener("mousedown", menu._outside, true);
    menu._keys = e => {
        if (e.key === "Escape") {
            e.preventDefault(); e.stopImmediatePropagation(); closeAddKindMenu(true);
        } else if (menu.contains(e.target)) {
            const items = [...menu.children], index = items.indexOf(document.activeElement);
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                e.preventDefault(); e.stopImmediatePropagation();
                const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 :
                    (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
                items[next].focus();
            } else if (e.key === "Enter" || e.key === " ") {
                e.preventDefault(); e.stopImmediatePropagation();
                if (!e.repeat) items[index]?.click();
            } else if (e.key === "Tab") closeAddKindMenu();
        }
    };
    document.addEventListener("keydown", menu._keys, true);
    menu.children[0]?.focus();
}
function bindAddBlockButton(button) {
    if (!button) return;
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "addKindMenu");
    button.onclick = () => {
        if ($("addKindMenu")?._anchor === button) { closeAddKindMenu(true); return; }
        const r = button.getBoundingClientRect();
        showAddKindMenu(r.left, r.bottom + 4, button);
    };
    button.addEventListener("keydown", e => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault(); e.stopPropagation();
        if (!e.repeat) button.click();
    });
}
bindAddBlockButton($("btnAddBlock"));
$("blocks").addEventListener("contextmenu", e => {
    const row = e.target.closest(".doc-block");
    if (row) {   /* внутри блока: своё меню у фрагментных, нативное — у остальных */
        const b = state.blocks.find(x => x.id === +row.dataset.id);
        if (b && PART_KINDS.has(b.kind)) { e.preventDefault(); showBlockCtxMenu(e.clientX, e.clientY, b, row); }
        return;
    }
    e.preventDefault();
    if ($("addKindMenu")) closeAddKindMenu();
    showAddKindMenu(e.clientX, e.clientY, null);
});

/* ПКМ в окне блока СИНХ/СТЕНД/ЛАЙФ/ШПИГ: добавить фрагмент + буфер обмена */
function closeBlockCtx() { const m = $("blockCtx"); if (m) m.remove(); }
function showBlockCtxMenu(x, y, b, row) {
    closeBlockCtx(); closeAddKindMenu();
    const ta = row.querySelector(".doc-text");
    const sel = ta && ta.selectionStart !== ta.selectionEnd;
    const m = document.createElement("div");
    m.id = "blockCtx"; m.className = "proj-menu";
    m.innerHTML = `<button data-bc="part" title="Нужны открытый файл и метки In/Out (I / O)">🎞 Добавить фрагмент из плеера</button>` +
        (sel ? `<button data-bc="copy">📋 Копировать выделенное</button>` : "") +
        `<button data-bc="paste" title="Если браузер не даёт доступ к буферу — Ctrl+V работает всегда">📝 Вставить</button>`;
    document.body.appendChild(m);
    m.style.left = Math.min(x, window.innerWidth - m.offsetWidth - 8) + "px";
    m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 8) + "px";
    const run = async kind => {
        if (kind === "part") { pullPart(b); return; }
        if (!navigator.clipboard) return toast("Буфер через меню доступен по https/localhost; обычной Ctrl+C/V работает везде", "warn", 5000);
        try {
            if (kind === "copy") await navigator.clipboard.writeText(ta.value.slice(ta.selectionStart, ta.selectionEnd));
            else {
                const s = await navigator.clipboard.readText();
                if (s) { ta.focus(); document.execCommand("insertText", false, s); }
            }
        } catch (err) {
            toast("Браузер не отдал буфер обмена (разрешите доступ или Ctrl+C / Ctrl+V)", "warn", 5000);
        }
    };
    /* onmousedown+stopPropagation: без этого document-mousedown закрывает меню
       раньше, чем до пункта доходит click (гонка — обработчик не срабатывал) */
    m.querySelectorAll("[data-bc]").forEach(btn => btn.onmousedown = e => {
        e.stopPropagation();
        m.remove();
        run(btn.dataset.bc);
    });
    setTimeout(() => document.addEventListener("mousedown", closeBlockCtx, { once: true }), 0);
}

/* ---------- перетаскивание блоков за бейдж (порядок = хронология сюжета) ---------- */
let dragBlockId = null;
function dragCleanup() {
    dragBlockId = null;
    document.querySelectorAll("#blocks .dragging, #blocks .drop-before, #blocks .drop-after, #blocks .drop-file")
        .forEach(el => el.classList.remove("dragging", "drop-before", "drop-after", "drop-file"));
    document.querySelectorAll("#miniTl .dragging, #miniTl .mt-before, #miniTl .mt-after")
        .forEach(el => el.classList.remove("dragging", "mt-before", "mt-after"));
    document.querySelectorAll("#blocks .doc-block").forEach(el => { el.draggable = false; });
}
/* вставка перед позицией to (0..blocks.length) */
function moveBlockTo(id, to) {
    const from = state.blocks.findIndex(x => x.id === id);
    if (from < 0) return;
    let dst = Math.max(0, Math.min(state.blocks.length, to));
    if (from < dst) dst--;
    if (dst === from) return;
    histBefore();
    const [b] = state.blocks.splice(from, 1);
    state.blocks.splice(dst, 0, b);
    renderBlocks(); saveState(); refreshTargets();
    toast("Порядок изменён (Ctrl+Z — отменить)");
}
/* зона под блоками / пустой документ — сброс «в конец» */
$("blocks").addEventListener("dragover", e => {
    if (dragBlockId === null || e.target.closest(".doc-block")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
});
$("blocks").addEventListener("drop", e => {
    if (dragBlockId === null || e.target.closest(".doc-block")) return;
    e.preventDefault();
    const id = dragBlockId;
    dragCleanup();
    moveBlockTo(id, state.blocks.length);
});
document.addEventListener("mouseup", e => {
    if (dragBlockId === null && e.target.closest && !e.target.closest(".badge")) return;
    dragCleanup();
});

/* ---------- мини-таймлайн: структура эфира, ширина ∝ хронометражу ---------- */
function updateMiniTl() {
    const bar = $("miniTl");
    if (!bar) return;
    if (!state.blocks.length) { bar.hidden = true; bar.innerHTML = ""; return; }
    bar.hidden = false;
    bar.innerHTML = state.blocks.map(b => {
        const dur = blockDur(b);
        const t = (b.text || "").replace(/\s+/g, " ").trim();
        const sp = TITR_KINDS.has(b.kind) && b.speaker ? " · " + b.speaker : "";
        return `<div class="mt-seg ${b.kind}" draggable="true" data-mt="${b.id}" style="flex-grow:${Math.max(dur, 1)}"
            title="${esc(KIND_META[b.kind].badge)} · ${durTc(dur) || "—"}${esc(sp)}${t ? " · " + esc(t.slice(0, 80)) : ""}"></div>`;
    }).join("");
}
function mtJump(id) {
    const el = document.querySelector('#blocks .doc-block[data-id="' + id + '"]');
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const ta = el.querySelector(".doc-text");
    if (ta && !el.classList.contains("folded")) ta.focus();
}
function mtIndexAt(seg, e) {
    const idx = state.blocks.findIndex(x => x.id === +seg.dataset.mt);
    const before = e.clientX < seg.getBoundingClientRect().left + seg.offsetWidth / 2;
    return { idx, before };
}
$("miniTl").addEventListener("click", e => {
    const seg = e.target.closest(".mt-seg");
    if (seg) mtJump(+seg.dataset.mt);
});
$("miniTl").addEventListener("dragstart", e => {
    const seg = e.target.closest(".mt-seg");
    if (!seg) return;
    dragBlockId = +seg.dataset.mt;
    e.dataTransfer.setData("text/plain", "mt:" + dragBlockId);
    e.dataTransfer.effectAllowed = "move";
    seg.classList.add("dragging");
});
$("miniTl").addEventListener("dragover", e => {
    if (dragBlockId === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const seg = e.target.closest(".mt-seg");
    document.querySelectorAll("#miniTl .mt-before, #miniTl .mt-after")
        .forEach(x => x.classList.remove("mt-before", "mt-after"));
    if (!seg || +seg.dataset.mt === dragBlockId) return;
    const { before } = mtIndexAt(seg, e);
    seg.classList.toggle("mt-before", before);
    seg.classList.toggle("mt-after", !before);
});
$("miniTl").addEventListener("drop", e => {
    if (dragBlockId === null) return;
    e.preventDefault();
    const id = dragBlockId;
    const seg = e.target.closest(".mt-seg");
    let to = state.blocks.length;
    if (seg) { const { idx, before } = mtIndexAt(seg, e); to = before ? idx : idx + 1; }
    dragCleanup();
    moveBlockTo(id, to);
});
$("miniTl").addEventListener("dragend", dragCleanup);

/* заголовок блока для тостов/подтверждений/экспорта (внутренние русские имена) */
function blockTitle(b, n) {
    if (b.kind === "vo") return `ЗК ${n}`;
    if (b.kind === "standup") return `Стендап ${n}` + (b.speaker ? ` — ${b.speaker}` : "");
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
/* типы с титровой строкой (имя+должность в кадре): синхрон и стендап */
const TITR_KINDS = new Set(["sync", "standup"]);
/* триггеры нового блока: слово в начало новой строки + пробел/Enter */
const DOC_TRIGGERS = {
    "зк": "vo", "з/к": "vo", "закадр": "vo", "закадровый": "vo", "vo": "vo", "v/o": "vo",
    "синх": "sync", "синхрон": "sync", "sot": "sync",
    "стенд": "standup", "стендап": "standup", "standup": "standup",
    "лайф": "life", "life": "life", "nat": "life", "nats": "life",
    "шпи": "spiegel", "шпигель": "spiegel", "spiegel": "spiegel",
    "подв": "vod", "подводка": "vod", "лид": "vod", "lead": "vod", "toss": "vod",
    "хед": "headline", "хедлайн": "headline", "заголовок": "headline", "headline": "headline", "head": "headline",
};
/* смена типа блока из интерфейса удалена: тип задаётся при создании
   (ПКМ по пустому месту или триггер «хед/лид/зк/синх/стенд/лайф/шпи» + пробел) */
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
    refreshTargets();
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
    if (TITR_KINDS.has(prev.kind) && !prev.speaker && b.speaker) { prev.speaker = b.speaker; prev.role = b.role; }
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
    const reason = sendReason(b);
    if (reason) { refreshTargets(); return toast(reason, "err"); }
    setCurrentBlock(b.id);
    histBefore();
    const vf = videoFiles.find(v => v.name === curFile && v.relPath === curRelPath) ||
               videoFiles.find(v => v.name === curFile);
    if (vf) dupWarning(vf);
    b.parts.push({ file: curFile, path: curRelPath, in: markIn, out: markOut });
    b.partsFolded = false;
    renderBlocks(); saveState();
    toast("Фрагмент добавлен в «" + blockTitle(b, typeNumbers()[b.id]) + "»", "ok");
    focusBlock(b.id, 99999);
}
/* drag файла из Медиабраузера на блок СИНХ/СТЕНД/ЛАЙФ/ШПИГ — целый файл (править in/out на месте) */
function currentStoryId() {
    return typeof OC !== "undefined" && OC.activeId != null ? String(OC.activeId) : null;
}
const durationLoads = new WeakMap();
function wholeFileDuration(vf) {
    if (Number.isFinite(vf.dur) && vf.dur > 0) return Promise.resolve(vf.dur);
    if (durationLoads.has(vf)) return durationLoads.get(vf);
    const pending = new Promise((resolve, reject) => {
        let video = null, url = null, settled = false;
        const finish = (error, duration) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (video) {
                video.onloadedmetadata = video.ondurationchange = video.onerror = null;
                video.removeAttribute("src");
                video.load();
            }
            if (url) URL.revokeObjectURL(url);
            if (error) reject(error);
            else { vf.dur = duration; resolve(duration); }
        };
        const timer = setTimeout(() => finish(new Error("истекло время ожидания длительности")), 20000);
        Promise.resolve().then(async () => {
            const file = vf.file || (vf.handle && await vf.handle.getFile());
            if (settled) return;
            if (!file) throw new Error("файл недоступен");
            video = document.createElement("video");
            video.preload = "metadata";
            video.muted = true;
            video.onloadedmetadata = video.ondurationchange = () => {
                if (Number.isFinite(video.duration) && video.duration > 0) finish(null, video.duration);
            };
            video.onerror = () => finish(new Error("длительность видео не распознана"));
            url = URL.createObjectURL(file);
            video.src = url;
        }).catch(error => finish(error));
    });
    durationLoads.set(vf, pending);
    const clear = () => durationLoads.delete(vf);
    pending.then(clear, clear);
    return pending;
}
async function addWholeFilePart(b, relPath) {
    if (!PART_KINDS.has(b.kind) || !state.blocks.includes(b)) return;
    const vf = videoFiles.find(v => v.relPath === relPath);
    if (!vf) return toast("Файл не найден в папке исходников: " + relPath, "err");
    const blocks = state.blocks, storyId = currentStoryId();
    let duration;
    try { duration = await wholeFileDuration(vf); }
    catch (error) { return toast("Файл не добавлен: " + error.message, "err"); }
    if (state.blocks !== blocks || currentStoryId() !== storyId || !state.blocks.includes(b) ||
        !PART_KINDS.has(b.kind) || !videoFiles.includes(vf))
        return toast("Файл не добавлен: сюжет, блок или папка исходников изменились", "warn");
    histBefore();
    b.parts.push({ file: vf.name, path: vf.relPath, in: 0, out: duration });
    b.folded = false;
    b.partsFolded = false;
    renderBlocks(); saveState();
    toast("«" + vf.name + "» целым файлом → " + blockTitle(b, typeNumbers()[b.id]) + " (Ctrl+Z — отменить)", "ok");
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
    /* offline-проверка: папка просканирована, но пути фрагмента в ней нет */
    const known = videoFiles.length ? new Set(videoFiles.map(v => v.relPath)) : null;
    if (!state.blocks.length) {
        host.innerHTML = '<div class="empty-hint">Сценарий пуст. Добавьте первый блок.</div>';
        const button = document.createElement("button");
        button.type = "button"; button.id = "btnEmptyAddBlock";
        button.textContent = "Добавить блок";
        host.querySelector(".empty-hint").appendChild(button);
        bindAddBlockButton(button);
    }

    state.blocks.forEach((b, i) => {
        const dur = blockDur(b);
        total += dur;
        const est = !(PART_KINDS.has(b.kind) && b.parts.length) && dur > 0;
        const div = document.createElement("div");
        div.className = "doc-block " + b.kind + (b.folded ? " folded" : "") +
            (PART_KINDS.has(b.kind) ? " has-parts" + (b.partsFolded ? " parts-folded" : "") : "");
        div.dataset.id = b.id;

        const ph = b.kind === "headline" ? "Текст заголовки на экране…" :
                   b.kind === "sync" ? "Реплика спикера в кавычках…" :
                   b.kind === "life" ? "Что в кадре, звук…" :
                   b.kind === "spiegel" ? "Текст шпигеля…" :
                   b.kind === "vod" ? "Текст подводки (отвода)…" : "Текст…";
        const foldsum = b.folded
            ? `<div class="fold-sum">${TITR_KINDS.has(b.kind) && b.speaker
                  ? `<b class="fs-titr">${esc(b.speaker)}${b.role ? " · " + esc(b.role) : ""}</b>` : ""}
               ${esc((b.text || "").replace(/\s+/g, " ").trim().slice(0, 90)) ||
               (b.speaker ? "" : "без текста")}<span class="muted">
               ${b.parts.length ? " · " + b.parts.length + " фр." : ""}</span></div>` : "";
        const titrWho = b.kind === "sync" ? "Спикер" : "Репортёр";
        const cN = SS_HOOK.commentCount(b.id);
        div.innerHTML = `
            <button class="badge ${b.kind}" title="Клик — свернуть/развернуть; перетащить — изменить порядок">${badgeHtml(b.kind)}</button>
            <div class="doc-main">
                ${TITR_KINDS.has(b.kind) ? `<div class="doc-speaker">
                    ${icon("person", 13)}
                    <input class="b-speaker" placeholder="${titrWho} — ФИО" title="Как в титрах: сначала имя, затем фамилия — так же разбиваются колонки MOGRT" value="${esc(b.speaker)}" aria-label="${titrWho}">
                    <span class="ts-sep"></span>
                    <input class="b-role" placeholder="должность" title="Должность в титрах" value="${esc(b.role)}" aria-label="Должность">
                </div>` : ""}
                ${foldsum}
                <textarea class="doc-text" rows="1" placeholder="${ph}" aria-label="Текст блока">${esc(b.text)}</textarea>
                ${PART_KINDS.has(b.kind) ? `<div class="doc-parts"></div>` : ""}
            </div>
            <span class="doc-dur" title="${est ? "Оценка по длине текста (~" + Math.round(readCps()) + " зн/с, темп — в ⚙ настройках сюжета)" : "Сумма таймкодов фрагментов"}">${est ? "~" : ""}${durTc(dur)}</span>
            <div class="doc-tools">
                ${cN ? `<button data-act="cmts" title="${cN} комм. к блоку" aria-label="Комментарии блока">${icon("bubble",12)}${cN}</button>` : ""}
                ${PART_KINDS.has(b.kind) ? `
                <button data-act="parts" class="doc-parts-toggle${b.partsFolded ? " folded" : ""}" title="Свернуть / развернуть присоединённые фрагменты">${icon("film",12)}${b.parts.length || ""}${icon(b.partsFolded ? "chevR" : "chevD",11)}</button>` : ""}
                <button data-act="del" title="Удалить" aria-label="Удалить блок">${icon("x",12)}</button>
            </div>
        `;

        const partsHost = div.querySelector(".doc-parts");
        if (partsHost) b.parts.forEach((p, pi) => {
            const pe = document.createElement("div");
            const off = !!(known && !known.has(p.path || p.file));
            pe.className = "doc-part" + (off ? " offline" : "");
            pe.innerHTML = `
                <span class="file" title="${esc(p.path || p.file)}${off ? " — файл не найден в папке исходников" : ""}">${esc(p.file)}</span>
                <span class="tc">${tc(p.in)} → ${tc(p.out)}</span>
                <span class="tc">${durHuman(p.out - p.in)}</span>
                <button data-act="goto" title="Открыть в плеере" aria-label="Открыть фрагмент в плеере">▶</button>
                <button data-act="del-part" title="Убрать фрагмент" aria-label="Убрать фрагмент">${icon("x",11)}</button>
            `;
            pe.querySelector("[data-act=del-part]").onclick = () => { histBefore(); b.parts.splice(pi, 1); renderBlocks(); saveState(); };
            pe.querySelector("[data-act=goto]").onclick = () => {
                const path = p.path || p.file;
                let vf = videoFiles.find(v => v.relPath === path);
                if (!vf) {
                    vf = videoFiles.find(v => v.name === p.file);
                    const dups = videoFiles.filter(v => v.name === p.file);
                    if (vf && dups.length > 1)
                        toast("Фрагмент сохранён без пути — открыт первый файл «" + p.file +
                              "» из " + dups.length + ": " + vf.relPath, "warn");
                }
                if (!vf) return toast("Файл не в списке: " + p.file, "err");
                loadVideo(vf).then(loaded => {
                    if (!loaded || !state.blocks.includes(b) || !b.parts.includes(p)) return;
                    markIn = p.in; markOut = p.out; marksSet = true; updateMarks();
                    $("player").currentTime = p.in;
                    limitToMarks = true;
                    $("player").play().catch(() => {});
                });
            };
            partsHost.appendChild(pe);
        });

        const ta = div.querySelector(".doc-text");
        ta.addEventListener("input", () => { histTyping(); b.text = ta.value; autogrow(ta); saveState(); refreshDur(i); });
        div.addEventListener("focusin", () => setCurrentBlock(b.id));
        ta.addEventListener("focus", () => autogrow(ta));
        ta.addEventListener("keydown", e => {
            if ((e.key === " " || e.key === "Enter") && docTrigger(ta, b, i)) { e.preventDefault(); return; }
            if (e.key === "Backspace" && ta.selectionStart === 0 && ta.selectionEnd === 0 && docMergePrev(b, i)) { e.preventDefault(); return; }
            if (e.altKey && e.key === "ArrowUp")   { e.preventDefault(); moveBlock(b.id, -1); return; }
            if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); moveBlock(b.id, +1); return; }
            if (e.altKey && e.key === "Enter")     { e.preventDefault(); pullPart(b); return; }
        });
        if (TITR_KINDS.has(b.kind)) {
            div.querySelector(".b-speaker").addEventListener("input", e => { histTyping(); b.speaker = e.target.value; saveState(); refreshTargets(); });
            div.querySelector(".b-role").addEventListener("input", e => { histTyping(); b.role = e.target.value; saveState(); });
        }
        /* drag за бейдж: draggable включается только на время нажатия,
           чтобы не мешать выделению текста в блоке */
        const badge = div.querySelector(".badge");
        badge.addEventListener("click", e => {
            e.stopPropagation();   /* иначе bubbling по свернутому блоку развернёт его обратно */
            b.folded = !b.folded;
            renderBlocks(); saveState();
        });
        badge.addEventListener("mousedown", () => { div.draggable = true; });
        div.addEventListener("dragstart", e => {
            dragBlockId = b.id;
            e.dataTransfer.setData("text/plain", String(b.id));
            e.dataTransfer.effectAllowed = "move";
            div.classList.add("dragging");
        });
        div.addEventListener("dragover", e => {
            if (dragBlockId !== null && dragBlockId !== b.id) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const before = e.clientY < div.getBoundingClientRect().top + div.offsetHeight / 2;
                div.classList.toggle("drop-before", before);
                div.classList.toggle("drop-after", !before);
                return;
            }
            /* dropEffect move при dragBlockId===null на чужом блоке — перемещение, иначе — файл из браузера */
            if (dragBlockId === null && PART_KINDS.has(b.kind) &&
                e.dataTransfer.types.indexOf("text/x-ss-file") >= 0) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                div.classList.add("drop-file");
            }
        });
        div.addEventListener("dragleave", e => {
            if (e.relatedTarget && div.contains(e.relatedTarget)) return;  /* перешли на дочерний элемент */
            div.classList.remove("drop-before", "drop-after", "drop-file");
        });
        div.addEventListener("drop", e => {
            if (dragBlockId !== null && dragBlockId !== b.id) {
                e.preventDefault();
                const id = dragBlockId;
                const before = e.clientY < div.getBoundingClientRect().top + div.offsetHeight / 2;
                dragCleanup();
                moveBlockTo(id, before ? i : i + 1);
                return;
            }
            if (dragBlockId === null && e.dataTransfer.types.indexOf("text/x-ss-file") >= 0) {
                e.preventDefault();
                const rel = e.dataTransfer.getData("text/x-ss-file");
                if (PART_KINDS.has(b.kind)) addWholeFilePart(b, rel);
                else toast("Фрагменты бывают только в SOT / STANDUP / LIFE / SPIEGEL", "warn");
            }
        });
        div.addEventListener("dragend", dragCleanup);
        div.addEventListener("click", async e => {
            const act = e.target.closest("[data-act]")?.dataset.act;
            if (!act) {
                /* клик по пустому месту свёрнутого строки — развернуть */
                if (b.folded && !e.target.closest("input,textarea,.doc-parts,.doc-speaker")) {
                    b.folded = false;
                    renderBlocks(); saveState();
                }
                return;
            }
            if (act === "goto" || act === "del-part") return;
            if (act === "cmts") { SS_HOOK.showBlockComments(b.id); return; }
            if (act === "parts") b.partsFolded = !b.partsFolded;
            if (act === "del") {
                if (!(await confirm2("Удалить блок?", "«" + blockTitle(b, nums[b.id]) + "» со всеми фрагментами."))) return;
                histBefore();
                state.blocks.splice(i, 1);
                renderBlocks(); saveState(); refreshTargets();
                toast("Блок «" + blockTitle(b, nums[b.id]) + "» удалён", "ok", 6000, { fn: () => doUndo() });
                return;
            }
            renderBlocks(); saveState(); refreshTargets();
        });
        host.appendChild(div);
        autogrow(ta);
    });

    if (currentBlockId) {
        const cur = state.blocks.find(x => x.id === currentBlockId);
        if (!cur) setCurrentBlock(null); else setCurrentBlock(cur.id);
    }
    const td = $("totalDur");          /* элемент убран в статус-бар; оставлен фолбэк на случай кэша */
    if (td) td.textContent = state.blocks.length
        ? "Хронометраж: " + (total > 0 ? durTc(total) + " (оценки с ~)" : "00:00") : "";
    updateMiniTl();
    refreshTargets();
    SS_HOOK.afterRender();
}
/* обновить только колонку длительности (без полного ререндера при печати) */
function refreshDur(i) {
    state.blocks.forEach((b, index) => {
        if (i !== undefined && i !== index) return;
        const cell = $("blocks").children[index]?.querySelector(".doc-dur");
        const dur = blockDur(b);
        const est = !(PART_KINDS.has(b.kind) && b.parts.length) && dur > 0;
        if (cell) {
            cell.textContent = (est ? "~" : "") + durTc(dur);
            cell.title = est ? "Оценка по длине текста (~" + Math.round(readCps()) + " зн/с)" : "Сумма таймкодов фрагментов";
        }
    });
    const total = state.blocks.reduce((sum, b) => sum + blockDur(b), 0);
    const td = $("totalDur");
    if (td) td.textContent = state.blocks.length ? "Хронометраж: " + (total > 0 ? durTc(total) + " (оценки с ~)" : "00:00") : "";
    updateMiniTl();
    SS_HOOK.afterDuration();
}

/* цель для «В сценарий →»: существующие блоки + пункт «новый блок типа «как»» */
/* подпись цели «В сценарий →» в транспортёре (currentBlock = блок с фокусом) */
function sendReason(b) {
    if (!b || !state.blocks.includes(b)) return "Выберите блок SOT / STANDUP / LIFE / SPIEGEL";
    if (!PART_KINDS.has(b.kind)) return "Этот блок — только текст. Выберите SOT / STANDUP / LIFE / SPIEGEL";
    const p = $("player");
    const file = videoFiles.find(v => v.name === curFile && v.relPath === curRelPath);
    if (videoLoading) return "Подождите загрузки видео";
    if (!curFile || !file || !file.url || p.src !== file.url) return "Откройте видео из папки исходников";
    if (p.error) return "Видео недоступно — откройте другой файл";
    if (p.readyState < 1 || !Number.isFinite(p.duration) || p.duration <= 0) return "Подождите загрузки длительности видео";
    if (!Number.isFinite(markIn) || !Number.isFinite(markOut)) return "Поставьте метки In и Out (I / O)";
    if (markIn < 0 || markOut <= markIn) return "Out должен быть позже In, а In — не раньше начала файла";
    if (markOut > p.duration) return "Метки выходят за длительность файла";
    return "";
}
function refreshTargets() {
    const b = state.blocks.find(x => x.id === currentBlockId);
    if (!b) currentBlockId = null;
    const lbl = $("curBlock");
    if (lbl) lbl.textContent = b ? "→ " + blockTitle(b, typeNumbers()[b.id]) : "";
    document.querySelectorAll("#blocks .doc-block").forEach(el =>
        el.classList.toggle("send-target", !!b && PART_KINDS.has(b.kind) && +el.dataset.id === b.id));
    const reason = sendReason(b), button = $("btnSend"), hint = $("sendHint");
    const message = reason || "Отправить In → Out в «" + blockTitle(b, typeNumbers()[b.id]) + "»";
    if (button) { button.disabled = !!reason; button.title = message; }
    if (hint) { hint.textContent = message; hint.hidden = false; }
}
/* отправка разметки: фрагмент In→Out в текущий блок (куда курсор) */
$("btnSend").addEventListener("click", () => {
    const b = state.blocks.find(x => x.id === currentBlockId);
    pullPart(b);
});

/* ---------- горячие клавиши плеера ---------- */
document.addEventListener("keydown", e => {
    if (!$("askModal").hidden || !$("setupModal").hidden) return;   /* модалки перехватывают клавиши сами */
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Escape") {
        if (!$("findBar").hidden) { closeSearch(); return; }
        if (!$("wordModal").hidden) { closeWordReview(); return; }
        if (!$("namesModal").hidden) { closeNmModal(); return; }
    }
    if (mod && !e.altKey && /^(z|я)$/i.test(e.key)) { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (mod && !e.altKey && /^(y|н)$/i.test(e.key)) { e.preventDefault(); doRedo(); return; }
    if (mod && /^(f|а)$/i.test(e.key)) { e.preventDefault(); openSearch(); return; }
    if (mod) return;   /* остальные Ctrl/Cmd-комбинации — не клавиши плеера (Ctrl+K берёт палитра) */
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
    /* J / K / L — шаг назад, пауза, шаг вперёд (физические клавиши, работает и в русской раскладке) */
    else if (e.key === "j" || e.key === "J" || e.key === "о" || e.key === "О") { e.preventDefault(); stepPlayer(-1); }
    else if (e.key === "k" || e.key === "K" || e.key === "л" || e.key === "Л") { e.preventDefault(); $("btnPlay").click(); }
    else if (e.key === "l" || e.key === "L" || e.key === "д" || e.key === "Д") { e.preventDefault(); stepPlayer(1); }
});

/* ---------- поиск по сюжету (Ctrl+F) ---------- */
let findHits = [], findPos = -1;
function openSearch() {
    SS_HOOK.beforeSearch();
    $("findBar").hidden = false;
    $("findInput").focus();
    $("findInput").select();
    doFind();
}
function clearFindHighlight() {
    document.querySelectorAll("#blocks .find-hit").forEach(el => el.classList.remove("find-hit"));
}
function closeSearch() {
    $("findBar").hidden = true;
    clearFindHighlight();
    findHits = []; findPos = -1;
    $("findCount").textContent = "";
}
function collectFind(q) {
    clearFindHighlight();
    findHits = []; findPos = -1;
    if (!q) { $("findCount").textContent = ""; return; }
    const needle = q.toLowerCase();
    state.blocks.forEach(b => {
        const fields = TITR_KINDS.has(b.kind) ? ["speaker", "role", "text"] : ["text"];
        fields.forEach(field => {
            const hay = (b[field] || "").toLowerCase();
            let i = hay.indexOf(needle);
            while (i !== -1 && findHits.length < 500) {
                findHits.push({ id: b.id, field, start: i, end: i + needle.length });
                i = hay.indexOf(needle, i + needle.length);
            }
        });
    });
    $("findCount").textContent = findHits.length ? "" : "ничего не найдено";
}
function gotoFind(delta) {
    if (!findHits.length) return;
    findPos = (findPos + delta + findHits.length) % findHits.length;
    const h = findHits[findPos];
    const b = state.blocks.find(x => x.id === h.id);
    if (!b) { doFind(); return; }
    const el = document.querySelector('.doc-block[data-id="' + h.id + '"]');
    if (!el) return;
    if (b.folded) {
        b.folded = false;
        el.classList.remove("folded");
        el.querySelector(".fold-sum")?.remove();
        const ta = el.querySelector(".doc-text");
        if (ta) autogrow(ta);
    }
    clearFindHighlight();
    const field = el.querySelector(h.field === "text" ? ".doc-text" : ".b-" + h.field);
    $("findCount").textContent = (findPos + 1) + " / " + findHits.length;
    if (field) {
        field.classList.add("find-hit");
        field.setSelectionRange(h.start, h.end);
        field.scrollIntoView({ block: "center", behavior: "smooth" });
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
$("findNext").onclick = () => { gotoFind(1); $("findInput").focus(); };
$("findPrev").onclick = () => { gotoFind(-1); $("findInput").focus(); };
$("findClose").onclick = closeSearch;
$("btnFind").onclick = () => $("findBar").hidden ? openSearch() : closeSearch();

/* ---------- экспорт: CSV для Fish Cutter (разделитель на выбор, экранирование) ---------- */
function buildCsv(sep) {
    const r = resolveNameValue("fioReporter"), c = resolveNameValue("fioCam"), ed = resolveNameValue("fioEditor");
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
    L.push(row("файл", "вход", "выход", "подпись", "путь"));
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
                           b.parts.length > 1 ? `СТЕНД${suN}-${pi + 1}${b.speaker ? " " + b.speaker : ""}` : `СТЕНД${suN}${b.speaker ? " " + b.speaker : ""}`,
                           p.path || p.file)));
        } else if (b.kind === "life") {
            liN++;
            L.push("#");
            L.push("# ——— ЛАЙФ " + liN + " ———");
            if (b.text) b.text.split(/\r?\n/).forEach(t => L.push("# " + t));
            b.parts.forEach((p, pi) =>
                L.push(row(p.file, tc(p.in), tc(p.out),
                           b.parts.length > 1 ? `ЛАЙФ${liN}-${pi + 1}` : `ЛАЙФ${liN}`,
                           p.path || p.file)));
        } else if (b.kind === "spiegel") {
            L.push("#");
            L.push("# ——— ШПИГЕЛЬ ———");
            if (b.text) b.text.split(/\r?\n/).forEach(t => L.push("# " + t));
            b.parts.forEach((p, pi) =>
                L.push(row(p.file, tc(p.in), tc(p.out), "ШПИГ", p.path || p.file)));
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
                L.push(row(p.file, tc(p.in), tc(p.out), `СИНХ${syN}-${pi + 1} ${b.speaker}`,
                           p.path || p.file)));
        }
    });
    /* CSV в кодировке UTF-8 с BOM — Excel и панель читают корректно */
    return "\uFEFF" + L.join("\r\n");
}

/* ---------- экспорт: Word для редактора — настоящий .docx (OOXML, zip method 0) ----------
   HTML-«подделка» под .doc открывалась Word в защищённом виде и не сохранялась.
   Выключка слева во всех параграфах; расшифровки СИНХ/СТЕНД/ЛАЙФ/ШПИГ — курсивом. */
const CRC_T = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    return t;
})();
function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}
/* files: [{name, data}] — ZIP без сжатия (Word читает method 0 корректно) */
function zipStore(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let off = 0, cdSize = 0;
    for (const f of files) {
        const name = enc.encode(f.name);
        const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
        const crc = crc32(data), sz = data.length;
        const lh = new DataView(new ArrayBuffer(30));
        lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true);
        lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);        /* 1980-01-01 */
        lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true);
        lh.setUint16(26, name.length, true);
        parts.push(new Uint8Array(lh.buffer), name, data);
        const ch = new DataView(new ArrayBuffer(46));
        ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
        ch.setUint16(14, 0x21, true);
        ch.setUint32(16, crc, true); ch.setUint32(20, sz, true); ch.setUint32(24, sz, true);
        ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
        central.push(new Uint8Array(ch.buffer), name);
        cdSize += 46 + name.length;
        off += 30 + name.length + sz;
    }
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, files.length, true); eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, cdSize, true); eocd.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(eocd.buffer)];
    const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
    let p = 0;
    for (const a of all) { out.set(a, p); p += a.length; }
    return out;
}
function wxRun(text, o) {
    if (!text) return "";
    o = o || {};
    const rpr = (o.b || o.i) ? "<w:rPr>" + (o.b ? "<w:b/>" : "") + (o.i ? "<w:i/>" : "") + "</w:rPr>" : "";
    return "<w:r>" + rpr + String(text).split(/\r?\n/)
        .map(x => '<w:t xml:space="preserve">' + esc(x) + "</w:t>").join("<w:br/>") + "</w:r>";
}
function wxPara(runs, style) {
    return "<w:p><w:pPr>" + (style ? '<w:pStyle w:val="' + style + '"/>' : "") +
        '<w:jc w:val="left"/></w:pPr>' + runs + "</w:p>";
}
function wordBookmarkName(prefix, id) {
    return prefix + Array.from(new TextEncoder().encode(String(id)), n => n.toString(16).padStart(2, "0")).join("");
}
function wordBookmarkId(name, prefix) {
    const hex = name.slice(prefix.length);
    if (!hex || !/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new Error("повреждён ID в закладке Word");
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(hex.match(/../g), n => parseInt(n, 16)));
}
function wxBookmark(name, id, runs) {
    return '<w:bookmarkStart w:id="' + id + '" w:name="' + name + '"/>' + runs +
        '<w:bookmarkEnd w:id="' + id + '"/>';
}
function buildDocx() {
    const storyId = currentStoryId();
    const title = wxRun($("storyTitle").value || "Сюжет");
    let body = wxPara(storyId === null ? title : wxBookmark(wordBookmarkName("SS_S_", storyId), 0, title), "Heading1");
    const req = [["Корреспондент:", resolveNameValue("fioReporter") || "—"],
                 ["Оператор:", resolveNameValue("fioCam") || "—"],
                 ["Монтажёр:", resolveNameValue("fioEditor") || "—"],
                 ["Дата:", new Date().toISOString().slice(0, 10)]];
    let runs = "";
    req.forEach((r, n) => {
        runs += wxRun(r[0] + " ", { b: 1 }) + wxRun(r[1]);
        if (n < req.length - 1) runs += "<w:r><w:br/></w:r>";
    });
    body += wxPara(runs);
    let voN = 0, suN = 0, syN = 0, liN = 0, hdN = 0;
    state.blocks.forEach((b, index) => {
        let head, ital = false;
        if (b.kind === "headline") { hdN++; head = "Заголовок " + hdN; }
        else if (b.kind === "vo") { voN++; head = "Закадровый текст " + voN; }
        else if (b.kind === "standup") { suN++; head = "Стендап " + suN + ". " + (b.speaker || "") + (b.role ? ", " + b.role : ""); ital = true; }
        else if (b.kind === "life") { liN++; head = "Лайф " + liN; ital = true; }
        else if (b.kind === "spiegel") { head = "Шпигель"; ital = true; }
        else if (b.kind === "vod") { head = "Подводка"; }
        else {
            syN++;
            head = "Синхрон " + syN + ". " + (b.speaker || "") + (b.role ? ", " + b.role : "");
            ital = true;
        }
        body += wxPara(wxBookmark(wordBookmarkName("SS_B_", b.id), index + 1, wxRun(head)), "Heading2") +
            wxPara(wxRun(b.text, { i: ital }));
    });
    const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    return zipStore([
        { name: "[Content_Types].xml", data: xml +
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
            '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
            "</Types>" },
        { name: "_rels/.rels", data: xml +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
            "</Relationships>" },
        { name: "word/_rels/document.xml.rels", data: xml +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
            "</Relationships>" },
        { name: "word/styles.xml", data: xml +
            '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
            '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>' +
            '<w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:rPrDefault>' +
            '<w:pPrDefault><w:pPr><w:jc w:val="left"/></w:pPr></w:pPrDefault></w:docDefaults>' +
            '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:jc w:val="left"/></w:pPr></w:style>' +
            '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="9"/>' +
            '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:jc w:val="left"/></w:pPr>' +
            '<w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>' +
            '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="9"/>' +
            '<w:pPr><w:keepNext/><w:spacing w:before="200" w:after="40"/><w:jc w:val="left"/></w:pPr>' +
            '<w:rPr><w:b/></w:rPr></w:style>' +
            "</w:styles>" },
        { name: "word/document.xml", data: xml +
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body +
            '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
            '<w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/>' +
            "</w:sectPr></w:body></w:document>" }
    ]);
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
function exportCsv(sep) {
    if (!state.blocks.length) return toast("Сценарий пуст", "err");
    download(slug($("storyTitle").value) + "_fishcutter.csv", buildCsv(sep), "text/csv;charset=utf-8");
    toast("CSV сохранён — откройте его в Fish Cutter («Загрузить файл…»)", "ok");
}
function exportWord() {
    if (!state.blocks.length) return toast("Сценарий пуст", "err");
    download(slug($("storyTitle").value) + "_для_редактора.docx", buildDocx(),
             "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    toast("Word-документ (.docx) сохранён", "ok");
}

/* ---------- экспорт: нижние титры для MOGRT (CSV по всем синхронам) ---------- */
/* «Имя Фамилия [Отчество]» -> {last, first, mid}: 1-е слово — имя,
   2-е — фамилия, остальные — отчество (подстраховка — колонка «спикер целиком») */
/* ---------- MOGRT: формат плагина LowerThirdsGenerator ( Premiere UXP ) ----------
   Две колонки; заголовок «Имя Фамилия;Должность»; порядок = появления титров в
   сценарии (SOT и STANDUP с непустым именем). Плагин сам ищет колонки по
   заголовку, таймкоды не читает (расстановка — маркеры секвенции или подряд). */
function buildMogrtCsv() {
    const cell = x => {
        x = String(x ?? "");
        return /[";\n\r]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x;
    };
    const L = ["Имя Фамилия;Должность"];
    state.blocks.forEach(b => {
        if (!TITR_KINDS.has(b.kind) || !b.speaker) return;
        L.push(cell(b.speaker.toUpperCase()) + ";" + cell((b.role || "").toUpperCase()));
    });
    return "\uFEFF" + L.join("\r\n");
}
function exportMogrt() {
    const n = state.blocks.filter(b => TITR_KINDS.has(b.kind) && b.speaker).length;
    if (!n) return toast("Нет титров: заполните имя в блоках SOT или STANDUP", "err");
    download(slug($("storyTitle").value) + "_mogrt.csv", buildMogrtCsv(), "text/csv;charset=utf-8");
    toast("Титры для Lower Thirds Generator сохранены (строк: " + n + ")", "ok");
}

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
            partsFolded: !!b.partsFolded,
            parts: ((b.kind === "vod" || b.kind === "vo") || !Array.isArray(b.parts) ? [] : b.parts)
                .filter(p => p && typeof p.file === "string" &&
                             Number.isFinite(+p.in) && Number.isFinite(+p.out) && +p.out > +p.in && +p.in >= 0)
                .map(p => ({ file: p.file, path: (typeof p.path === "string" && p.path) ? p.path : p.file,
                             in: +p.in, out: +p.out }))
        }));
}
function saveState() {
    if (window.SS_STORAGE_LOADING) return;
    saveReq();
    SS_HOOK.afterSave();
}
function loadDraftData(d) {
    if (!d || !Array.isArray(d.blocks)) return false;
    currentBlockId = null;
    closeSearch();
    closeAddKindMenu();
    state.blocks = normalizeBlocks(d.blocks);
    const maxId = Math.max(0, ...state.blocks.map(b => b.id));
    state.nextId = Math.max(+d.nextId || 1, maxId + 1);
    if (d.req && typeof d.req === "object") {   /* реквизиты (включая fps) — в тот же черновик */
        store.set("ss_req", d.req);
        loadReq();
    }
    renderBlocks();
    SS_HOOK.draftLoaded(d);
    return true;
}
function saveDraft() {
    const obj = { blocks: state.blocks, nextId: state.nextId, req: store.get("ss_req", {}) };
    const meta = SS_HOOK.draftMeta();
    if (meta) obj.meta = meta;
    download(slug($("storyTitle").value) + "_черновик.json", JSON.stringify(obj, null, 1), "application/json");
}
function loadDraft() { $("draftFile").click(); }
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
function importWord() { $("wordFile").click(); }
$("wordFile").onchange = e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) importWordFile(f);
};

/* заголовки блоков, как их печатает buildDocx (нумерация — по типу) */
function parseWordHead(h) {
    let m;
    if ((m = h.match(/^заголовок\s*(\d+)/i)) || (m = h.match(/^headline\s*(\d+)/i)))
        return { kind: "headline", num: +m[1] };
    if (/^закадр/i.test(h) || /^зк[\s.]/i.test(h) || /^vo\b/i.test(h)) {
        const d = h.match(/\d+/);
        return { kind: "vo", num: d ? +d[0] : NaN };
    }
    if ((m = h.match(/^стендап\s*(\d+)\s*[.．]?\s*(.*)$/i)) || (m = h.match(/^standup\s*(\d+)\s*[.．]?\s*(.*)$/i))) {
        const parts = (m[2] || "").split(/[,;]/);
        return { kind: "standup", num: +m[1],
                 speaker: (parts.shift() || "").replace(/^—+\s*/, "").trim(),
                 role: parts.join(", ").trim() };
    }
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
        if (key || it.id !== undefined) blocks.push(Object.assign({ text: it.lines.join("\n") }, key,
            it.id !== undefined ? { id: it.id } : {}));
        else unknown.push(it.head);
    });
    return { blocks, unknown };
}
/* старый экспорт: .doc (он же HTML), в т.ч. пересохранённый Word (классы MsoHeading…) */
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
    /* Word при пересохранении переписывает styleId (наш «Heading1» → «1»),
       узнаваемое имя остаётся только в styles.xml — строим карту id→имя */
    const sname = {};
    try {
        const sdoc = new DOMParser().parseFromString(await docunzip(arrayBuf, "word/styles.xml"), "text/xml");
        [...sdoc.getElementsByTagName("w:style")].forEach(s => {
            const id = s.getAttribute("w:styleId") || "";
            const nm = s.getElementsByTagName("w:name")[0];
            if (id && nm) sname[id] = nm.getAttribute("w:val") || "";
        });
    } catch (e) { /* нет styles.xml — решаем по styleId */ }
    const isHead = style => {
        const name = sname[style] || style;
        return /heading|^h[1-6]$/i.test(name) || /^заголовок\s*[1-6]/i.test(name);
    };
    const xml = await docunzip(arrayBuf, "word/document.xml");
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("повреждён XML документа");
    const storyIds = [...doc.getElementsByTagName("w:bookmarkStart")]
        .map(n => n.getAttribute("w:name") || "").filter(n => n.startsWith("SS_S_"))
        .map(n => wordBookmarkId(n, "SS_S_"));
    if (new Set(storyIds).size > 1) throw new Error("документ содержит ID разных сюжетов");
    const items = [];
    let cur = null;
    [...doc.getElementsByTagName("w:p")].forEach(p => {
        const st = p.getElementsByTagName("w:pStyle")[0];
        const style = st ? (st.getAttribute("w:val") || "") : "";
        const ids = [...p.getElementsByTagName("w:bookmarkStart")]
            .map(n => n.getAttribute("w:name") || "").filter(n => n.startsWith("SS_B_"))
            .map(n => wordBookmarkId(n, "SS_B_"));
        if (ids.length > 1) throw new Error("несколько ID блока в одном заголовке");
        const text = docxParaText(p);
        if (ids.length || isHead(style)) {
            cur = { head: normWs(text), lines: [] };
            if (ids.length) cur.id = ids[0];
            items.push(cur);
        } else if (cur && text) cur.lines.push(text);
    });
    const parsed = wordItemsToBlocks(items);
    if (storyIds.length) parsed.storyId = storyIds[0];
    return parsed;
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
            const uh = (parsed.unknown || []).slice(0, 2).map(s => "«" + s.slice(0, 40) + "»").join(", ");
            toast("В файле нет знакомых заголовков («Синхрон 1…», «Закадровый текст 2…»)." +
                  (uh ? " Нераспознанные: " + uh : " Заголовков не найдено вовсе — проверьте формат файла."),
                  "err", 7000);
            return;
        }
        openWordReview(parsed);
    } catch (e) {
        toast("Файл не прочитан: " + e.message, "err");
    }
}

let wordPlan = null;   /* {rows, fresh, unknown} */
function buildWordPlan(parsed) {
    const storyId = currentStoryId();
    if (parsed.storyId !== undefined && String(parsed.storyId) !== storyId)
        throw new Error("ID сюжета в Word не совпадает с открытым сюжетом");
    const nums = typeNumbers();
    const used = new Set(), blocked = new Set(), rows = [], fresh = [], ambiguous = [];
    const identified = new Set(parsed.blocks.filter(it => it.id !== undefined).map(it => String(it.id)));
    const proposals = parsed.blocks.map(it => {
        let candidates;
        if (it.id !== undefined) candidates = state.blocks.filter(b => String(b.id) === String(it.id));
        else {
            const sameKind = state.blocks.filter(b => b.kind === it.kind);
            candidates = Number.isFinite(it.num) ? sameKind.filter(b => nums[b.id] === it.num) : [];
            if (!candidates.length && (it.kind === "spiegel" || it.kind === "vod")) candidates = sameKind;
            if (!candidates.length && TITR_KINDS.has(it.kind) && it.speaker)
                candidates = sameKind.filter(b => normWs(b.speaker).toLowerCase() === normWs(it.speaker).toLowerCase());
        }
        return { it, candidates };
    });
    proposals.forEach(({ it, candidates }) => {
        if (!candidates.length) { fresh.push(it); return; }
        const b = candidates[0];
        const conflict = candidates.length !== 1 ||
            (it.id === undefined && identified.has(String(b.id))) ||
            proposals.some(p => p.it !== it && p.candidates.includes(b) &&
                (it.id === undefined || p.it.id !== undefined));
        if (conflict) {
            ambiguous.push(it);
            candidates.forEach(b => blocked.add(b));
            return;
        }
        used.add(b);
        const textChanged = normWs(it.text) !== normWs(b.text);
        const speakerChanged = TITR_KINDS.has(b.kind) && typeof it.speaker === "string" && normWs(it.speaker) !== normWs(b.speaker);
        const roleChanged = TITR_KINDS.has(b.kind) && typeof it.role === "string" && normWs(it.role) !== normWs(b.role);
        rows.push({ b, it, removed: false, changed: textChanged || speakerChanged || roleChanged,
                    textChanged, speakerChanged, roleChanged });
    });
    state.blocks.forEach(b => {
        if (!used.has(b)) rows.push({ b, it: null, removed: false, changed: false,
            missing: !blocked.has(b), ambiguous: blocked.has(b) });
    });
    rows.sort((x, y) => state.blocks.indexOf(x.b) - state.blocks.indexOf(y.b));
    return { rows, fresh, ambiguous, unknown: parsed.unknown || [], storyId, snapshot: serializeDoc(), blocks: state.blocks };
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
        p.rows.filter(r => !r.changed && !r.removed && !r.missing && !r.ambiguous).length +
        "  ·  нет в Word: " + p.rows.filter(r => r.missing).length +
        "  ·  без соответствия (не импортируются): " + p.fresh.length +
        "  ·  неоднозначных (не импортируются): " + p.ambiguous.length;
    const onlyChanged = $("wmOnlyChanged").checked;
    const host = $("wmList");
    host.innerHTML = "";
    p.rows.forEach((r, ri) => {
        if (onlyChanged && !r.changed && !r.missing && !r.ambiguous) return;
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
                <span class="wm-tag">${r.ambiguous ? "неоднозначное соответствие — не импортируется" : r.missing ? "нет в правке Word" : bits.length ? esc(bits.join(" · ")) : "без изменений"}</span>
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
function applyWordReview() {
    if (!wordPlan) return;
    if (wordPlan.storyId !== currentStoryId() || wordPlan.blocks !== state.blocks ||
        wordPlan.snapshot !== serializeDoc()) {
        closeWordReview();
        return toast("Сюжет изменился — откройте правки Word заново", "warn");
    }
    if (!wordPlan.rows.some(r => r.changed || r.removed)) return;
    histBefore();
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
}
$("wmApply").onclick = applyWordReview;
$("wmCancel").onclick = closeWordReview;
$("wmClose").onclick = closeWordReview;
$("wmOnlyChanged").onchange = renderWordReview;
$("wordModal").addEventListener("mousedown", e => { if (e.target === $("wordModal")) closeWordReview(); });
$("wordModal").addEventListener("keydown", e => trapTab(e.currentTarget.querySelector(".modal-box"), e));

/* ---------- старт ---------- */
loadReq();
/* общий список ФИО из names.json — перерисовать select'ы после загрузки
   (refreshNameSelects сохранит восстановленный выбор) */
loadSharedNames(refreshNameSelects);
setView(viewMode);          /* применить сохранённый вид списка и подсветку кнопок */
if (!loadDraftData({ blocks: store.get("ss_blocks", []), nextId: store.get("ss_nextId", 1) }))
    renderBlocks();
const savedDir = store.get("ss_dirname", "");
if (savedDir)
    $("folderName").textContent = `«${savedDir}»`;
restoreDirHandle();
$("quotaSave").onclick = () => saveDraft();
$("quotaDump").onclick = async () => {
    if (window.OC && typeof ocFlushNow === "function") ocFlushNow();
    const memory = window.OC ? JSON.parse(JSON.stringify({ stories: OC.stories, activeId: OC.activeId,
        blocks: state.blocks, nextId: state.nextId, req: typeof ocReadReq === "function" && OC.stories.length ? ocReadReq() : {} })) : null;
    const diag = { at: new Date().toISOString(), idb: { ok: !!window.SS_IDB_OK },
        migrated: !!window.SS_LS_MIGRATED, quotaShown: quotaWarnShown };
    const local = {}, persisted = {};
    try {
        diag.ls = lsUsage();
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key.startsWith("oc_recovery_") && !["oc_stories", "oc_active", "ss_blocks", "ss_nextId", "ss_req"].includes(key)) continue;
            const raw = localStorage.getItem(key);
            try { local[key] = JSON.parse(raw); } catch (e) { local[key] = raw; }
        }
    } catch (e) { diag.lsError = String(e.message || e); }
    for (const key of ["oc_snapshot", "oc_snapshot_backup", "oc_stories", "oc_active"]) {
        try { persisted[key] = await IDB.read("kv", key); }
        catch (e) { persisted[key] = { error: String(e.message || e) }; }
    }
    const stories = memory && memory.stories || persisted.oc_snapshot && persisted.oc_snapshot.stories || local.oc_stories || null;
    download("ss-storage-dump.json", JSON.stringify({ diag, stories, memory, persisted, local }, null, 1), "application/json");
    toast("Снимок выгружен: текущая работа, IDB, резерв и recovery-копии", "ok", 5000);
};
