/* МЕДИАЦЕНТР — оболочка newsroom-интерфейса поверх движка Сюжет-Студии */
"use strict";

/* ---------- модель данных сюжетов ---------- */
const OC = {
    STAGES: ["ASSIGNED", "IN PROGRESS", "READY", "APPROVED", "ON AIR"],
    stories: [],
    activeId: null,
    nextNum: 12600
};
window.OC = OC;    /* const не попадает в window сам — нужно для диагностики/дампа */

const nowHM = () => new Date().toTimeString().slice(0, 5);
const dateHM = () => {
    const d = new Date();
    return String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0") + " " + nowHM();
};
/* Отображение этапов по-русски; внутренние значения (stage, ключи stageDates)
   остаются английскими — не трогаем сохранённые данные. Этап больше не показывается
   в интерфейсе, но сохраняется в сюжете и черновиках ради совместимости. */
const mmss = sec => (sec ? durTc(sec) : "00:00");

function mkBlock(id, kind, text, speaker) {
    return { id, kind, text: text || "", speaker: speaker || "", role: "", folded: false, parts: [] };
}
function newStory(o) {
    return Object.assign({
        id: OC.nextNum++, title: "Новый сюжет", day: 0, time: nowHM(),
        stage: "ASSIGNED", stageDates: { "ASSIGNED": dateHM() },
        targetSec: 90, blocks: [], nextId: 1, comments: [], modified: nowHM()
    }, o);
}

/* демо-данные по референсу (если локальных сюжетов ещё нет) */
function seedStories() {
    const bridge = newStory({
        id: 12567, title: "Новый мост разгрузит центр", time: "15:30",
        stage: "IN PROGRESS",
        stageDates: { "ASSIGNED": "24.08 10:15", "IN PROGRESS": "24.08 11:20", "READY": "24.08 15:25" },
        modified: "15:25",
        blocks: [
            mkBlock(1, "headline", "Новый мост разгрузит центр"),
            mkBlock(2, "vod", "Сегодня в городе открыли новый мост через реку Сетунь, который должен разгрузить центральные улицы."),
            mkBlock(3, "vo", "Строительство объекта длилось почти два года и обошлось бюджету в 8,7 миллиарда рублей."),
            mkBlock(4, "sync", "«Этот мост — важная часть транспортной системы. Он позволит сократить время в пути для тысяч водителей каждый день».", "МЭР ГОРОДА"),
            mkBlock(5, "vo", "Мост имеет шесть полос движения и пешеходную зону шириной 4 метра."),
            mkBlock(6, "sync", "«Конструкция рассчитана на интенсивное движение. Мы использовали современные материалы и технологии».", "ГЛАВНЫЙ ИНЖЕНЕР"),
            mkBlock(7, "standup", "Пока движение открыто только по одной части моста. Полностью объект запустят до конца года."),
            mkBlock(8, "vo", "Водители уже отмечают, что дорога стала быстрее и удобнее.")
        ],
        nextId: 9,
        comments: [
            { kind: "comment", who: "Редактор", text: "Добавь синхрон водителя в финал, оживит картинку.", time: "14:58" },
            { kind: "comment", who: "Иван Петров", text: "Согласовал, интервью записано — кладу третьим ЗК.", time: "15:04" },
            { kind: "suggestion", who: "Редактор", text: "Сократить второй закадр до 8 секунд, не успеваем за картинкой.", time: "15:10" },
            { kind: "task", who: "Редактор", text: "Согласовать график стендапа с пресс-службой", time: "15:12", done: false }
        ]
    });
    OC.nextNum = 12600;
    const others = [
        newStory({ id: 12568, title: "Пресс-конференция мэра", time: "15:00",
            blocks: [mkBlock(1, "headline", "Пресс-конференция мэра"), mkBlock(2, "vod", "Мэр ответил на вопросы журналистов.")], nextId: 3 }),
        newStory({ id: 12569, title: "ДТП на Ленинградском шоссе", time: "16:00",
            blocks: [mkBlock(1, "headline", "ДТП на Ленинградском шоссе")], nextId: 2 }),
        newStory({ id: 12570, title: "Фестиваль уличной еды", time: "14:20", stage: "ON AIR",
            stageDates: { "ASSIGNED": "23.08 09:00", "IN PROGRESS": "23.08 11:00", "READY": "23.08 13:10", "APPROVED": "23.08 13:50", "ON AIR": "23.08 14:20" },
            blocks: [mkBlock(1, "headline", "Фестиваль уличной еды"), mkBlock(2, "vo", "Более ста площадок, кухня шести стран.")], nextId: 3 }),
        newStory({ id: 12571, title: "Открытие школы №15", time: "09:00", day: 1, blocks: [mkBlock(1, "headline", "Открытие школы №15")], nextId: 2 }),
        newStory({ id: 12572, title: "Матч «Динамо» — «Спартак»", time: "18:00", day: 1, blocks: [mkBlock(1, "headline", "Матч «Динамо» — «Спартак»")], nextId: 2 })
    ];
    const list = [bridge, others[0], others[1], others[2], others[3], others[4]];
    /* перенос несохранённой работы из старой автосave-ячейки */
    const legacy = store.get("ss_blocks", []);
    if (Array.isArray(legacy) && legacy.length) {
        const req = store.get("ss_req", {});
        list.unshift(newStory({
            title: req.storyTitle || "Мой сюжет", stage: "IN PROGRESS",
            stageDates: { "ASSIGNED": dateHM(), "IN PROGRESS": dateHM() },
            blocks: legacy, nextId: store.get("ss_nextId", legacy.length + 1)
        }));
    }
    return list;
}

/* ---------- хранение сюжетов: IndexedDB (localStorage ~5 МБ забивается быстро) ----------
   SS_IDB_OK ставит ocInit; при его отсутствии — тихий возврат к localStorage.
   Записи в IDB идут последовательно (цепочка промисов), данные всегда полный снимок.
   До конца ocInit (проба IDB) записи буферизуются — иначе гонка напишет мегабайты
   в localStorage, который миграция как раз собирается освободить. */
window.SS_IDB_OK = false;
let ocInitDone = false, ocPersistPending = false;
let idbWriteChain = Promise.resolve();
function persistStories() {
    if (!ocInitDone) { ocPersistPending = true; return; }
    if (window.SS_IDB_OK) {
        idbWriteChain = idbWriteChain
            .then(() => IDB.put("kv", "oc_stories", OC.stories))
            .then(() => IDB.put("kv", "oc_active", OC.activeId))
            .catch(e => {
                console.error("IDB stories save failed:", e);
                window.SS_IDB_OK = false;            /* дальше — через localStorage, как раньше */
                quotaWarn("IndexedDB: " + ((e && e.name) || e));
                persistStories();
            });
    } else {
        store.set("oc_stories", OC.stories);
        store.set("oc_active", OC.activeId);
    }
}
function clearHeavyLsKeys() {
    window.SS_LS_MIGRATED = true;                  /* saveState больше не плодит легаси-дубли */
    ["oc_stories", "oc_active", "ss_blocks", "ss_nextId"].forEach(k => {
        try { localStorage.removeItem(k); } catch (e) {}
    });
}
function active() { return OC.stories.find(s => s.id === OC.activeId) || OC.stories[0]; }

/* ---------- переключение / сохранение активного сюжета ---------- */
function loadStory(id) {
    const st = OC.stories.find(s => s.id === id);
    if (!st) return;
    if (st.id !== OC.activeId) ocFlushNow();          /* довесохранить предыдущий */
    OC.activeId = st.id;
    /* реквизиты (fps, темп, ФИО) — свои у каждого сюжета */
    if (st.req && typeof st.req === "object") { store.set("ss_req", st.req); loadReq(); }
    state.blocks = normalizeBlocks(st.blocks);
    const maxId = Math.max(0, ...state.blocks.map(b => b.id));
    state.nextId = Math.max(st.nextId || 1, maxId + 1);
    $("storyTitle").value = st.title;
    undoStack.length = 0; redoStack.length = 0;
    currentBlockId = null; $("curBlock").textContent = "";
    persistStories();
    renderBlocks();
}

let ocFlushT = 0;
function ocFlushNow() {
    const st = active(); if (!st) return;
    st.blocks = JSON.parse(JSON.stringify(state.blocks));
    st.nextId = state.nextId;
    st.title = $("storyTitle").value.trim();
    st.req = store.get("ss_req", {});
    st.modified = nowHM();
    persistStories();
    sbSaved(st.modified);
}
function ocFlushSoon() { clearTimeout(ocFlushT); ocFlushT = setTimeout(ocFlushNow, 400); }

/* ---------- управление сюжетами (из меню «Проект») ---------- */
function deleteStory(id) {
    const st = OC.stories.find(s => s.id === (id || OC.activeId));
    if (!st) return;
    confirm2("Удалить сюжет", "«" + st.title + "» и его черновик будут удалены в этом браузере.").then(ok => {
        if (!ok) return;
        const i = OC.stories.indexOf(st);
        OC.stories.splice(i, 1);
        if (!OC.stories.length) OC.stories.push(newStory({ title: "Новый сюжет" }));
        const nxt = OC.stories[Math.min(i, OC.stories.length - 1)];
        OC.activeId = nxt.id;                 /* чтобы редактор не «дописался» в чужой сюжет */
        loadStory(nxt.id);
        persistStories(); renderHead();
        toast("Сюжет удалён", "ok", 6000, { fn: () => {
            const ph = OC.stories.find(s => s !== st && s.title === "Новый сюжет" && !(s.blocks || []).length);
            if (ph) OC.stories.splice(OC.stories.indexOf(ph), 1);   /* убрать автозаглушку, если её не трогали */
            OC.stories.splice(Math.min(i, OC.stories.length), 0, st);
            loadStory(st.id);
            persistStories();
            toast("Сюжет возвращён", "ok");
        } });
    });
}
function duplicateStory(id) {
    ocFlushNow();
    const src = OC.stories.find(s => s.id === (id || OC.activeId));
    if (!src) return;
    const c = JSON.parse(JSON.stringify(src));
    c.id = OC.nextNum++;
    c.title = (src.title + " (копия)").slice(0, 80);
    c.modified = nowHM();
    OC.stories.splice(OC.stories.indexOf(src) + 1, 0, c);
    loadStory(c.id);
    toast("Копия «" + c.title + "» создана", "ok");
}

async function newStoryDialog() {
    const t = ((await ask("Новый сюжет", { placeholder: "Название сюжета", ok: "Создать" })) || "").trim();
    if (!t) return;
    ocFlushNow();
    const st = newStory({ title: t });
    OC.stories.unshift(st);
    loadStory(st.id);
    toast("Сюжет создан — назначьте исходники и печатайте сценарий", "ok");
}

/* список сюжетов: меню «Проект» → «Сюжеты…» (переключение/дублирование/удаление) */
function closeStoriesMenu() { const m = $("storiesMenu"); if (m) m.remove(); }
function showStoriesMenu(anchor) {
    if ($("storiesMenu")) { closeStoriesMenu(); return; }
    closeProjMenu();
    ocFlushNow();
    const m = document.createElement("div");
    m.id = "storiesMenu"; m.className = "proj-menu st-menu";
    m.innerHTML = OC.stories.map(s => `
        <button data-st-id="${s.id}" class="${s.id === OC.activeId ? "cur" : ""}"
            aria-current="${s.id === OC.activeId ? "true" : "false"}">
            <span class="st-name">${s.id === OC.activeId ? "✓ " : ""}${esc(s.title || "Без названия")}</span>
            <span class="st-mod">${esc(s.modified || "")}</span>
        </button>`).join("") +
        '<div class="pj-sep"></div><button data-st-menu="dup">⧉ Дублировать текущий</button>' +
        '<button data-st-menu="del">🗑 Удалить текущий</button>';
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.left = Math.min(r.left, window.innerWidth - m.offsetWidth - 8) + "px";
    m.style.top = (r.bottom + 4) + "px";
    m.querySelectorAll("[data-st-id]").forEach(b => b.onclick = () => {
        const id = +b.dataset.stId;
        m.remove();
        if (id === OC.activeId) return;
        loadStory(id);
        toast("Открыт сюжет: " + active().title);
    });
    m.querySelector('[data-st-menu=dup]').onclick = () => { m.remove(); duplicateStory(); };
    m.querySelector('[data-st-menu=del]').onclick = () => { m.remove(); deleteStory(); };
    setTimeout(() => document.addEventListener("mousedown", function h(e2) {
        if (!m.contains(e2.target)) { m.remove(); document.removeEventListener("mousedown", h); }
    }), 0);
}

/* ---------- шапка сюжета ---------- */
function renderHead() {
    const st = active();
    $("ocStoryId").textContent = String(st.id).padStart(8, "0");
    $("ocModified").textContent = st.modified || "—";
    $("sbFps").textContent = $("fpsInput").value || "—";
    sbSaved(st.modified);
}
/* ---------- статус-бар: сохранение / FPS ---------- */
function sbDirty() {
    const e = $("sbSaved");
    if (e) { e.textContent = "…unsaved"; e.classList.add("dirty"); }
}
function sbSaved(time) {
    const e = $("sbSaved");
    if (e) { e.textContent = "✓ " + (time || nowHM()) + " saved"; e.classList.remove("dirty"); }
}
$("fpsInput").addEventListener("input", () => { $("sbFps").textContent = $("fpsInput").value || "—"; });
$("storyTitle").addEventListener("input", () => { sbDirty(); ocFlushSoon(); });
$("storyTitle").addEventListener("change", () => { ocFlushNow(); renderHead(); });

/* ---------- вкладки центра ---------- */
let centerTab = "script";
function switchCenterTab(name) {
    centerTab = name;
    document.querySelectorAll("#ocTabs .tab").forEach(t => {
        t.classList.toggle("active", t.dataset.view === name);
        t.setAttribute("aria-selected", String(t.dataset.view === name));
    });
    document.querySelectorAll(".cview").forEach(v => v.hidden = v.id !== "view-" + name);
    if (name === "summary") renderSummary();
    if (name === "sources") renderSources();
    if (name === "social") renderSocial();
}
document.querySelectorAll("#ocTabs .tab").forEach(t =>
    t.onclick = () => switchCenterTab(t.dataset.view));

/* ---------- правые вкладки ---------- */
let mediaTab = "media";
function switchMediaTab(name) {
    mediaTab = name;
    document.querySelectorAll("#ocMediaTabs .tab").forEach(t => {
        t.classList.toggle("active", t.dataset.mv === name);
        t.setAttribute("aria-selected", String(t.dataset.mv === name));
    });
    document.querySelectorAll(".mview").forEach(v => v.hidden = v.id !== "mv-" + name);
    if (name === "sots") renderSots();
    if (name === "graphics") renderGraphics();
    if (name === "approval") renderApproval();
}
document.querySelectorAll("#ocMediaTabs .tab").forEach(t =>
    t.onclick = () => switchMediaTab(t.dataset.mv));

/* ---------- панели: сворачивание + активная (UI-only, ss_fold в localStorage) ---------- */
function foldState() {
    try { const s = JSON.parse(localStorage.getItem("ss_fold") || "{}"); return s && typeof s === "object" ? s : {}; }
    catch (e) { return {}; }
}
function applyFolds() {
    const fs = foldState();
    document.querySelectorAll(".panel-sec").forEach(sec => {
        const body = sec.querySelector(".panel-body"), btn = sec.querySelector(".ph-fold");
        if (!body || !btn) return;
        const folded = !!fs[sec.dataset.panel];
        body.hidden = folded;
        btn.innerHTML = icon(folded ? "chevR" : "chevD", 12);
        const name = sec.querySelector(".ph-title").textContent.trim();
        btn.setAttribute("aria-expanded", String(!folded));
        btn.setAttribute("aria-label", (folded ? "Развернуть панель: " : "Свернуть панель: ") + name);
    });
}
document.querySelectorAll(".ph-fold").forEach(b => b.onclick = () => {
    const sec = b.closest(".panel-sec");
    const fs = foldState();
    fs[sec.dataset.panel] = !fs[sec.dataset.panel];
    try { localStorage.setItem("ss_fold", JSON.stringify(fs)); } catch (e) {}
applyFolds();

/* ---------- сплиттер центр↔право: ширина правой колонки в ss_rcw ---------- */
(function () {
    const sp = $("vsplit"), rc = $("rightcol");
    if (!sp || !rc) return;
    function setW(px) {
        px = Math.max(400, Math.min(Math.round(window.innerWidth * .7), Math.round(px)));
        rc.style.flex = "0 0 " + px + "px";
        try { localStorage.setItem("ss_rcw", String(px)); } catch (e) {}
    }
    const saved = parseInt(localStorage.getItem("ss_rcw") || "", 10);
    if (saved > 300) setW(saved);
    sp.addEventListener("mousedown", e => {
        e.preventDefault();
        const x0 = e.clientX, w0 = rc.getBoundingClientRect().width;
        sp.classList.add("drag");
        const mv = ev => setW(w0 + (x0 - ev.clientX));
        const up = () => {
            document.removeEventListener("mousemove", mv);
            document.removeEventListener("mouseup", up);
            sp.classList.remove("drag");
        };
        document.addEventListener("mousemove", mv);
        document.addEventListener("mouseup", up);
    });
    sp.addEventListener("dblclick", () => {
        rc.style.flex = "";
        try { localStorage.removeItem("ss_rcw"); } catch (e) {}
    });
})();
});
/* активная панель — рамка-подсветка шапки, как в Premiere */
document.addEventListener("pointerdown", e => {
    const sec = e.target.closest(".panel-sec");
    if (!sec || sec.classList.contains("active")) return;
    document.querySelectorAll(".panel-sec.active").forEach(s => s.classList.remove("active"));
    sec.classList.add("active");
}, true);
applyFolds();

/* ---------- TOTAL (хронометраж + план из targetSec) ---------- */
function mmssToSec(s) {
    s = String(s).replace(",", ".").trim();
    if (/^\d+(\.\d+)?$/.test(s)) return +s;
    const p = s.split(":");
    if (p.length === 2 && /^\d+$/.test(p[0]) && /^\d{1,2}$/.test(p[1])) return (+p[0]) * 60 + (+p[1]);
    return NaN;
}
function renderTotal() {
    const total = state.blocks.reduce((s, b) => s + blockDur(b), 0);
    const st = active();
    const tEl = $("ocTotal");
    tEl.textContent = mmss(total);
    tEl.classList.toggle("over", st.targetSec > 0 && total > st.targetSec);
    const pl = $("ocTotalPlan");
    if (!pl) return;
    pl.hidden = false;
    pl.innerHTML = (st.targetSec > 0 ? "plan " + mmss(st.targetSec) : "set plan") + " " + icon("pencil",11);
    pl.title = "Хронометраж-цель сюжета — клик, чтобы изменить (мм:сс)";
}
$("ocTotalPlan").onclick = async () => {
    const st = active();
    const v = await ask("Хронометраж-план", { value: st.targetSec > 0 ? mmss(st.targetSec) : "",
                                              placeholder: "мм:сс или секунд", ok: "Задать" });
    if (v === null) return;
    const s = mmssToSec(v);
    if (!(s > 0 && s < 36000)) return toast("Не понял длительность — ждём «мм:сс»", "err");
    st.targetSec = Math.round(s);
    ocFlushNow(); renderTotal();
    toast("План: " + mmss(st.targetSec), "ok");
};

/* ---------- COLLABORATION (comments / suggestions / tasks, якоря к блокам) ---------- */
let clTab = "comment";
let clBlockFilter = null;          /* показывать только комментарии блока N */
const CL_LABEL = { comment: "комментариев", suggestion: "предложений", task: "задач" };
function renderCollab() {
    const st = active();
    st.comments = st.comments || [];
    ["comment", "suggestion", "task"].forEach(k =>
        $("clCount-" + k).textContent = st.comments.filter(c => c.kind === k).length);
    document.querySelectorAll(".cl-tabs .tab").forEach(t => {
        t.classList.toggle("active", t.dataset.cl === clTab);
        t.setAttribute("aria-selected", String(t.dataset.cl === clTab));
    });
    let items = st.comments.filter(c => c.kind === clTab);
    if (clBlockFilter !== null) items = items.filter(c => c.blockId === clBlockFilter);
    const host = $("ocCollabList");
    const chip = clBlockFilter !== null
        ? `<div class="cl-filter">комментарии блока ${clBlockFilter} <button id="clFltX" aria-label="Снять фильтр">${icon("x",11)}</button></div>` : "";
    if (!items.length) {
        host.innerHTML = chip + (clBlockFilter !== null
            ? '<div class="cl-empty">У этого блока нет записей.</div>'
            : `<div class="cl-empty">Нет ${CL_LABEL[clTab]}ов — напишите первым.</div>`);
        const x = $("clFltX"); if (x) x.onclick = () => { clBlockFilter = null; renderCollab(); };
        return;
    }
    host.innerHTML = chip + items.map((c, ci) =>
        `<div class="cl-item${c.done ? " done" : ""}${c.blockId ? " anchored" : ""}">
            ${c.kind === "task" ? `<input type="checkbox" class="cl-check" data-ci="${ci}" ${c.done ? "checked" : ""}>` : ""}
            <span class="cl-who">${esc(c.who)}</span>
            <span class="cl-body">${esc(c.text)}</span>
            ${c.blockId ? `<button class="cl-jump" data-ci="${ci}" title="Перейти к блоку">→</button>` : ""}
            <span class="cl-time">${esc(String(c.time || ""))}</span></div>`).join("");
    host.querySelectorAll(".cl-check").forEach(ch => ch.onchange = () => {
        items[+ch.dataset.ci].done = ch.checked; ocFlushNow(); renderCollab();
    });
    host.querySelectorAll(".cl-jump").forEach(j => j.onclick = () => {
        const c = items[+j.dataset.ci];
        gotoBlock(c.blockId);
    });
    const x = $("clFltX"); if (x) x.onclick = () => { clBlockFilter = null; renderCollab(); };
}
document.querySelectorAll(".cl-tabs .tab").forEach(t =>
    t.onclick = () => { clTab = t.dataset.cl; renderCollab(); });
function postCollab() {
    const inp = $("ocCommentText"), v = inp.value.trim();
    if (!v) return;
    const st = active();
    (st.comments = st.comments || []).push({ kind: clTab, who: resolveNameValue("fioReporter") || "Иван Петров",
                                             text: v, time: nowHM(), done: false,
                                             blockId: currentBlockId || null });
    inp.value = ""; ocFlushNow(); renderCollab(); renderBlocks();
}
/* маркеры 💬 в блоках и переход из них (хук app.js) */
SS_HOOK.commentCount = id => {
    const st = active();
    return ((st && st.comments) || []).filter(c => c.blockId === id).length;
};
SS_HOOK.showBlockComments = id => {
    clTab = "comment"; clBlockFilter = id;
    renderCollab();
    $("collab").scrollIntoView({ block: "nearest", behavior: "smooth" });
};
$("ocPost").onclick = postCollab;
$("ocCommentText").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); postCollab(); } });
$("ocAttach").onclick = () => toast("Вложения к комментариям пока не поддерживаются", "warn");
$("ocMention").onclick = () => { const i = $("ocCommentText"); i.value += "@"; i.focus(); };
$("ocEmoji").onclick = e => {
    document.querySelector(".emoji-pop")?.remove();
    const pop = document.createElement("div");
    pop.className = "emoji-pop";
    pop.innerHTML = ["👍", "🔥", "✅", "❗", "❓", "🎬", "🎤", "📷", "📺", "⏱", "✂️", "🚨", "🌙", "☀️", "🏙", "🎙"]
        .map(x => `<button>${x}</button>`).join("");
    document.body.appendChild(pop);
    const r = e.target.getBoundingClientRect();
    pop.style.left = Math.min(r.left - 150, window.innerWidth - 240) + "px";
    pop.style.top = (r.top - 120) + "px";
    pop.querySelectorAll("button").forEach(b => b.onclick = () => {
        $("ocCommentText").value += b.textContent; pop.remove(); $("ocCommentText").focus();
    });
    setTimeout(() => document.addEventListener("mousedown", function h(ev) {
        if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener("mousedown", h); }
    }, { once: false }), 0);
};

/* ---------- SOTs / GRAPHICS (правая панель) ---------- */
function gotoBlock(id) {
    switchCenterTab("script");
    const el = document.querySelector('.doc-block[data-id="' + id + '"]');
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const ta = el.querySelector(".doc-text");
    ta && ta.focus();
}
function miniRow(b, dur) {
    return `<div class="mi-item" data-goto="${b.id}">
        <span class="badge ${b.kind} mi-badge">${badgeHtml(b.kind)}</span>
        <span class="mi-main"><b>${esc(b.speaker || (b.text || "").slice(0, 40))}</b><span>${esc((b.text || "").replace(/\s+/g, " ").slice(0, 80))}</span></span>
        <span class="mi-dur">${mmss(dur)}</span></div>`;
}
function renderSots() {
    const rows = state.blocks.filter(b => b.kind === "sync").map(b => miniRow(b, blockDur(b)));
    $("ocSots").innerHTML = rows.join("") || '<div class="mi-empty">Синхронов пока нет — добавьте SOT и отметьте фрагменты в мониторе.</div>';
    $("ocSots").querySelectorAll("[data-goto]").forEach(el => el.onclick = () => gotoBlock(+el.dataset.goto));
}
function renderGraphics() {
    const rows = state.blocks.filter(b => b.kind === "headline" || b.kind === "spiegel").map(b => miniRow(b, blockDur(b)));
    $("ocGraphics").innerHTML = rows.join("") || '<div class="mi-empty">Титров и шпигелей пока нет.</div>';
    $("ocGraphics").querySelectorAll("[data-goto]").forEach(el => el.onclick = () => gotoBlock(+el.dataset.goto));
}

/* ---------- APPROVAL ---------- */
function renderApproval() {
    $("ocApproval").innerHTML = `<div id="approvalSteps">
        <div class="ap-row"><span class="ap-num">1</span><span class="ap-main"><b>Экспорт в Word</b>
            <span>Отдать текст на вычитку (без таймкодов)</span></span>
            <button class="accent" data-ap="doc">Экспорт</button></div>
        <div class="ap-row"><span class="ap-num">2</span><span class="ap-main"><b>Импорт из Word</b>
            <span>Вернуть редактуру в сюжет, обзор «было/стало»</span></span>
            <button data-ap="imp">Импорт</button></div>
        <div class="ap-row"><span class="ap-num">3</span><span class="ap-main"><b>В рыбособиратель</b>
            <span>Файлы и таймкоды для сборки сюжета (CSV «;», есть вариант для Excel в меню «Проект»)</span></span>
            <button class="accent" data-ap="csv">Экспорт</button></div>
        <div class="ap-row"><span class="ap-num">4</span><span class="ap-main"><b>MOGRT титры</b>
            <span>Фамилии/должности спикеров и таймкоды для lower third шаблонов</span></span>
            <button data-ap="mogrt">Экспорт</button></div>
    </div>`;
    const act = { doc: exportWord, imp: importWord,
                  csv: () => exportCsv(";"), mogrt: () => exportMogrt(";") };
    $("ocApproval").querySelectorAll("[data-ap]").forEach(b => b.onclick = act[b.dataset.ap]);
}

/* ---------- SUMMARY / SOURCES / SOCIAL ---------- */
function renderSummary() {
    const st = active();
    let total = 0;
    const rows = state.blocks.map((b, i) => {
        const d = blockDur(b); total += d;
        return `<tr><td>${i + 1}</td><td>${KIND_META[b.kind].badge}</td>
            <td>${esc(b.kind === "sync" ? b.speaker || "—" : "")}</td>
            <td>${esc((b.text || "").replace(/\s+/g, " ").slice(0, 90))}</td>
            <td style="text-align:right;font-family:var(--mono);color:var(--text)">${mmss(d)}</td></tr>`;
    }).join("");
    $("ocSummary").innerHTML = `<h3>${esc(st.title || "Без названия")}</h3>
        <p class="muted">ИД: ${String(st.id).padStart(8, "0")} · ${esc(resolveNameValue("fioReporter") || "корреспондент не указан")}</p>
        ${state.blocks.length ? `<table><tr><th>#</th><th>Тип</th><th>Спикер</th><th>Текст</th><th>Длит.</th></tr>${rows}</table>
        <p><b style="font-family:var(--mono);color:var(--text)">${mmss(total)}</b> — суммарный хронометраж</p>`
        : '<p class="muted">Сценарий пуст.</p>'}`;
}
function renderSources() {
    const used = new Map();
    state.blocks.forEach(b => b.parts.forEach(p => {
        const key = p.path || p.file;
        const cur = used.get(key) || { n: 0, dur: 0, name: p.file };
        used.set(key, { n: cur.n + 1, dur: cur.dur + (p.out - p.in), name: p.file });
    }));
    $("ocSources").innerHTML = used.size ? [...used.entries()].map(([path, u]) =>
        `<div class="src-item" data-src="${esc(path)}"><span class="src-name" title="${esc(path)}">${esc(u.name)}</span>
         <span class="src-n">${u.n} фр.</span><span class="mi-dur">${mmss(u.dur)}</span></div>`).join("")
        : '<p class="muted">Фрагменты ещё не размечены. Откройте папку с исходниками (меню «Проект» → «Папка исходников…»), отметьте In/Out в мониторе и вставьте фрагмент в блок.</p>';
    $("ocSources").querySelectorAll("[data-src]").forEach(el => el.onclick = () => {
        const path = el.dataset.src;
        switchMediaTab("media");
        let vf = videoFiles.find(v => v.relPath === path);
        if (!vf) vf = videoFiles.find(v => v.name === path.split("/").pop());
        if (vf) loadVideo(vf);
        else toast("Папка с исходниками не выбрана или файл недоступен — Проект → «Папка исходников…»", "warn");
    });
}
function renderSocial() {
    const head = state.blocks.find(b => b.kind === "headline");
    const lead = state.blocks.find(b => b.kind === "vod" || b.kind === "vo");
    const text = ((head && head.text ? head.text + ". " : "") + (lead ? lead.text.replace(/\s+/g, " ") : "")).trim()
        || active().title;
    $("ocSocial").innerHTML = `<h3>Пост для соцсетей<button class="copy-btn" id="ocCopySocial">Копировать</button></h3>
        <div id="ocSocialText" class="social-text">${esc(text)}</div>
        <p class="muted">Черновик собран из HEADLINE и первой текстовой подводки — правьте в SCRIPT.</p>`;
    $("ocCopySocial").onclick = () => copyText(text, "Пост скопирован");
}
function copyText(t, okMsg) {
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject())
        .then(() => toast(okMsg, "ok"))
        .catch(() => toast("Браузер не дал доступ к буферу обмена", "err"));
}

/* ---------- общие обновления ---------- */
function ocRefreshAll() {
    renderHead(); renderTotal(); renderCollab();
    if (mediaTab === "sots") renderSots();
    if (mediaTab === "graphics") renderGraphics();
    if (mediaTab === "approval") renderApproval();
    if (centerTab === "summary") renderSummary();
    if (centerTab === "sources") renderSources();
    if (centerTab === "social") renderSocial();
}

/* ---------- точки расширения движка (app.js) — без переназначения его функций ---------- */
SS_HOOK.afterRender = () => { ocRefreshAll(); updateUsedDots(); };
SS_HOOK.afterSave = () => { sbDirty(); ocFlushSoon(); };
SS_HOOK.afterVideoList = () => { $("ocVidCount").textContent = videoFiles.length; };
SS_HOOK.beforeSearch = () => { if ($("view-script").hidden) switchCenterTab("script"); };
const TIME_RE = /^\d{1,2}[:.]\d{2}$/;
/* черновик .json — с метаданными сюжета (этап, даты, комментарии); id не переносим */
SS_HOOK.draftMeta = () => {
    const st = active();
    toast("Черновик сохранён (с этапом и комментариями)", "ok");
    return { title: st.title, day: st.day, time: st.time, stage: st.stage,
             stageDates: st.stageDates, targetSec: st.targetSec,
             comments: st.comments, modified: st.modified };
};
/* импорт черновика: всё из meta проверяется — файл мог прийти «извне» */
SS_HOOK.draftLoaded = d => {
    if (!d || !d.meta || typeof d.meta !== "object") return;
    const m = d.meta, st = active();
    if (typeof m.title === "string" && m.title.trim()) {
        st.title = normWs(m.title).slice(0, 200);
        $("storyTitle").value = st.title;
    }
    if (m.stage && OC.STAGES.includes(m.stage)) st.stage = m.stage;
    if (m.stageDates && typeof m.stageDates === "object") {
        const sd = {};
        Object.entries(m.stageDates).forEach(([k, v]) => {
            if (OC.STAGES.includes(k) && typeof v === "string") sd[k] = normWs(v).slice(0, 16);
        });
        st.stageDates = sd;
    }
    if (Array.isArray(m.comments)) {
        st.comments = m.comments.filter(c => c && typeof c.text === "string").slice(0, 500).map(c => ({
            kind: ["comment", "suggestion", "task"].includes(c.kind) ? c.kind : "comment",
            who: normWs(String(c.who || "")).slice(0, 60),
            text: String(c.text).slice(0, 2000),
            time: TIME_RE.test(String(c.time || "").trim()) ? String(c.time).trim() : nowHM(),
            done: !!c.done,
            blockId: Number.isFinite(+c.blockId) && +c.blockId > 0 ? +c.blockId : null,
        }));
    }
    if (Number.isFinite(+m.targetSec) && +m.targetSec > 0 && +m.targetSec < 36000) st.targetSec = +m.targetSec;
    if (+m.day === 1) st.day = 1;
    if (TIME_RE.test(String(m.time || ""))) st.time = String(m.time);
    ocFlushNow(); renderHead();
};

/* верхняя навигация: «Проект» — меню, «Сюжет» — активный экран, остальные — заглушки */
document.querySelectorAll(".gnav .gn").forEach(b => {
    if (b.id === "gnProject") return;
    b.onclick = () => b.dataset.view ? switchCenterTab(b.dataset.view)
        : b.classList.contains("active") ? null : toast("Активен рабочий экран «" + b.textContent + "»: интерфейс заточен под Story", "warn");
});

/* ---------- меню «Проект»: файлы сюжета и экспорты ---------- */
const PJ_ITEMS = [
    { act: "stories", lbl: "🎬 Сюжеты…", title: "Список сюжетов этого браузера — переключение, дублирование, удаление", fn: () => showStoriesMenu($("gnProject")) },
    { act: "new",  lbl: "➕ Создать…",       title: "Новый сюжет в текущем проекте", fn: () => newStoryDialog() },
    { act: "dup",  lbl: "⧉ Дублировать сюжет", title: "Копия текущего сюжета вместе с блоками и комментариями", fn: () => duplicateStory() },
    { act: "del",  lbl: "🗑 Удалить сюжет",  title: "Убрать текущий сюжет из списка (и его черновик в этом браузере)", fn: () => deleteStory() },
    { sep: true },
    { act: "open", lbl: "📂 Открыть…",       title: "Загрузить черновик из файла .json — вернутся блоки, реквизиты и fps", fn: () => loadDraft() },
    { act: "save", lbl: "💾 Сохранить…",     title: "Сохранить текущий сюжет в файл-черновик .json и продолжить позже", fn: () => saveDraft() },
    { sep: true },
    { act: "dir",  lbl: "📁 Папка исходников…", title: "Выбрать папку с видеофайлами (можно по сети) — Chrome/Edge запомнят её и ⟳ откроет без выбора", fn: () => pickFolder() },
    { sep: true },
    { act: "wimp", lbl: "📥 Импорт из Word…", title: "Вернуть правки редактора из его Word-файла (.doc/.docx/.txt), обзор «было/стало»", fn: () => importWord() },
    { act: "wexp", lbl: "📤 Экспорт в Word",  title: "Текст сценария без файлов и таймкодов — для редактора", fn: () => exportWord() },
    { sep: true },
    { act: "fish", lbl: "🐟 В рыбособиратель", title: "CSV «;» — файлы и таймкоды для сборки сюжета в Fish Cutter", fn: () => exportCsv(";") },
    { act: "xls",  lbl: "📊 CSV для Excel «,»", title: "Тот же CSV с запятой — для открытия в Excel", fn: () => exportCsv(",") },
    { act: "mog",  lbl: "🎬 MOGRT титры",     title: "CSV: имя/фамилия/отчество, должность и вход — для lower third шаблонов MOGRT", fn: () => exportMogrt(";") },
];
function closeProjMenu() { const m = $("projMenu"); if (m) m.remove(); $("gnProject").classList.remove("active"); }
$("gnProject").onclick = e => {
    e.stopPropagation();
    if ($("projMenu")) { closeProjMenu(); return; }
    const menu = document.createElement("div");
    menu.id = "projMenu"; menu.className = "proj-menu";
    menu.innerHTML = PJ_ITEMS.map(it => it.sep ? '<div class="pj-sep"></div>' :
        `<button data-pj="${it.act}" title="${esc(it.title)}">${it.lbl}</button>`).join("");
    document.body.appendChild(menu);
    $("gnProject").classList.add("active");
    const r = $("gnProject").getBoundingClientRect();
    menu.style.left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8) + "px";
    menu.style.top = (r.bottom + 4) + "px";
    menu.querySelectorAll("[data-pj]").forEach(b => {
        const it = PJ_ITEMS.find(x => x.act === b.dataset.pj);
        b.onclick = () => { closeProjMenu(); it.fn(); };
    });
    setTimeout(() => document.addEventListener("mousedown", function h(ev) {
        if (!menu.contains(ev.target) && ev.target !== $("gnProject")) { closeProjMenu(); document.removeEventListener("mousedown", h); }
    }), 0);
};
document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeProjMenu(); closeStoriesMenu(); if (!$("keysModal").hidden) closeKeys(); if (!$("cmdPalette").hidden) cpClose(); }
    /* «?» вне полей ввода — шпаргалка горячих клавиш */
    if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = e.target;
        if (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable) return;
        e.preventDefault(); toggleKeys();
    }
});
["ocBell", "ocApps"].forEach(id =>
    $(id).onclick = () => toast("Раздел в разработке", "warn"));
function openKeys() { $("keysModal").hidden = false; $("kmClose").focus(); }
function closeKeys() { $("keysModal").hidden = true; }
function toggleKeys() { $("keysModal").hidden ? openKeys() : closeKeys(); }
$("kmClose").onclick = closeKeys;
$("keysModal").addEventListener("click", e => { if (e.target === $("keysModal")) closeKeys(); });
$("ocHelp").onclick = toggleKeys;

/* ---------- палитра команд (Ctrl+K) ---------- */
let cpSel = 0, cpShown = [];
function cpItems() {
    const items = [];
    OC.stories.forEach(s => items.push({ g: "Сюжет", t: s.title || "Без названия",
        h: "#" + String(s.id).padStart(8, "0") + (s.id === OC.activeId ? " · открыт" : " · " + (s.modified || "")),
        run: () => { if (s.id !== OC.activeId) { loadStory(s.id); toast("Открыт сюжет: " + active().title); } } }));
    const nums = typeNumbers();
    state.blocks.forEach(b => {
        const txt = (b.text || "").replace(/\s+/g, " ").trim().slice(0, 60);
        items.push({ g: "Блок", t: blockTitle(b, nums[b.id]), h: txt, run: () => gotoBlock(b.id) });
    });
    PJ_ITEMS.forEach(it => { if (!it.sep) items.push({ g: "Команда", t: it.lbl, h: it.title, run: it.fn }); });
    items.push({ g: "Команда", t: "🔍 Поиск по сюжету", h: "Ctrl+F", run: () => openSearch() });
    items.push({ g: "Команда", t: "⤡ Свернуть / развернуть все блоки", h: null, run: () => $("btnFoldAll").click() });
    items.push({ g: "Команда", t: "⌨ Горячие клавиши", h: "?", run: openKeys });
    return items;
}
function cpRender() {
    const q = $("cpInput").value.trim().toLowerCase();
    const all = cpItems();
    cpShown = q ? all.filter(x => ((x.g + " " + x.t + " " + (x.h || "")).toLowerCase()).includes(q)) : all;
    cpShown = cpShown.slice(0, 50);
    cpSel = Math.max(0, Math.min(cpSel, cpShown.length - 1));
    const host = $("cpList");
    host.innerHTML = cpShown.length
        ? cpShown.map((x, i) => `<div class="cp-item${i === cpSel ? " sel" : ""}" data-cp="${i}" role="option">
              <span class="cp-grp">${x.g}</span><span class="cp-lbl">${esc(x.t)}</span>
              <span class="cp-hint">${esc(x.h || "")}</span></div>`).join("")
        : '<div class="cp-empty">Ничего не найдено</div>';
    const sel = host.querySelector(".cp-item.sel");
    if (sel) sel.scrollIntoView({ block: "nearest" });
    host.querySelectorAll(".cp-item").forEach(el => el.onmousedown = e => { e.preventDefault(); cpRun(+el.dataset.cp); });
}
function cpRun(i) {
    const x = cpShown[i];
    if (!x) return;
    cpClose();
    setTimeout(() => x.run(), 0);
}
function cpOpen() {
    if (!$("keysModal").hidden) closeKeys();
    $("cmdPalette").hidden = false;
    cpSel = 0;
    $("cpInput").value = "";
    cpRender();
    $("cpInput").focus();
}
function cpClose() { $("cmdPalette").hidden = true; }
$("cpInput").addEventListener("input", () => { cpSel = 0; cpRender(); });
$("cpInput").addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); cpSel++; cpRender(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); cpSel--; cpRender(); }
    else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); cpRun(cpSel); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cpClose(); }
});
$("cmdPalette").addEventListener("click", e => { if (e.target === $("cmdPalette")) cpClose(); });
document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && /^(k|л)$/i.test(e.key) &&
        $("askModal").hidden && $("namesModal").hidden) {
        e.preventDefault();
        $("cmdPalette").hidden ? cpOpen() : cpClose();
    }
});

/* ---------- старт ---------- */
window.addEventListener("beforeunload", () => { clearTimeout(ocFlushT); ocFlushNow(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) { clearTimeout(ocFlushT); ocFlushNow(); } });
(async function ocInit() {
    if (!localStorage.getItem("ss_view")) setView("thumbs-big");
    /* есть ли рабочий IndexedDB (приватный режим Safari/Firefox умеет отказать) */
    try { await IDB.put("kv", "_probe", 1); await IDB.del("kv", "_probe"); window.SS_IDB_OK = true; }
    catch (e) { console.warn("IndexedDB недоступен, остаёмся на localStorage:", e && e.name); }
    let list = null, aid = null;
    if (window.SS_IDB_OK) { list = await IDB.get("kv", "oc_stories"); aid = await IDB.get("kv", "oc_active"); }
    if (!Array.isArray(list) || !list.length) {
        const legacy = store.get("oc_stories", null);          /* первый запуск после обновления — мигрируем из localStorage */
        if (Array.isArray(legacy) && legacy.length) {
            list = legacy;
            if (aid == null) aid = store.get("oc_active", null);
        }
    }
    if (!Array.isArray(list) || !list.length) {
        list = seedStories();                                   /* внутри читается легаси ss_blocks — чистим ключи ПОСЛЕ */
        aid = list[0].id;
    }
    OC.stories = list;
    OC.activeId = list.some(s => s.id === aid) ? aid : list[0].id;
    OC.nextNum = Math.max(OC.nextNum, ...list.map(s => s.id + 1));
    ocInitDone = true;
    persistStories();                              /* снимок лёг в IDB (или LS-фолбэк); буферные вызовы покрыты им */
    if (window.SS_IDB_OK) clearHeavyLsKeys();      /* освобождаем до 5 МБ localStorage — там больше не живём */
    loadStory(OC.activeId);
})();
