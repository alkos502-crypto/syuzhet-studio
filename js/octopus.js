/* OCTOPUS — оболочка newsroom-интерфейса поверх движка Сюжет-Студии */
"use strict";

/* ---------- модель данных сюжетов ---------- */
const OC = {
    STAGES: ["ASSIGNED", "IN PROGRESS", "READY", "APPROVED", "ON AIR"],
    stories: [],
    activeId: null,
    nextNum: 12600
};

const nowHM = () => new Date().toTimeString().slice(0, 5);
const dateHM = () => {
    const d = new Date();
    return String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0") + " " + nowHM();
};
const statusLabel = s => s === "ON AIR" ? "COMPLETED" : s;
const statusCls = s => s === "ASSIGNED" ? "s-assigned" : s === "ON AIR" ? "s-done" : s === "READY" ? "s-ready" : s === "APPROVED" ? "s-approved" : "s-prog";
const badgeCls  = s => ({ "ASSIGNED": "st-assigned", "IN PROGRESS": "st-edit", "READY": "st-ready", "APPROVED": "st-approved", "ON AIR": "st-air" })[s] || "";
const badgeText = s => s === "IN PROGRESS" ? "EDITING" : statusLabel(s);
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

function persistStories() { store.set("oc_stories", OC.stories); store.set("oc_active", OC.activeId); }
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
}
function ocFlushSoon() { clearTimeout(ocFlushT); ocFlushT = setTimeout(ocFlushNow, 400); }

/* ---------- левая колонка: MY ASSIGNMENTS ---------- */
function renderAssignments() {
    const host = $("ocAsList");
    const filt = $("ocAsFilter").value;
    const q = (($("ocAsSearch").value || "") + " " + ($("ocGlobalSearch").value || "")).trim().toLowerCase();
    let html = "", shown = 0;
    [[0, "Today"], [1, "Tomorrow"]].forEach(([day, label]) => {
        const items = OC.stories.filter(s => s.day === day)
            .filter(s => filt === "all" || s.stage === filt)
            .filter(s => !q || s.title.toLowerCase().includes(q));
        if (!items.length) return;
        html += `<div class="as-date">${label}</div>`;
        items.forEach(s => {
            shown++;
            html += `<div class="as-item${s.id === OC.activeId ? " active" : ""}" data-oc="${s.id}" title="${esc(s.title)}">
                <span class="as-title">${esc(s.title)}</span>
                <span class="as-st ${statusCls(s.stage)}">${statusLabel(s.stage)}</span>
                <span class="as-time">${s.time}</span></div>`;
        });
    });
    host.innerHTML = shown ? html : '<div class="cl-empty">Ничего не найдено</div>';
    host.querySelectorAll("[data-oc]").forEach(el =>
        el.onclick = () => { const id = +el.dataset.oc; if (id !== OC.activeId) { loadStory(id); toast("Открыт сюжет: " + active().title); } });
}
$("ocAsFilter").addEventListener("change", renderAssignments);
$("ocAsSearch").addEventListener("input", renderAssignments);
$("ocGlobalSearch").addEventListener("input", renderAssignments);

function newStoryDialog() {
    const t = (prompt("Название нового сюжета:") || "").trim();
    if (!t) return;
    ocFlushNow();
    const st = newStory({ title: t });
    OC.stories.unshift(st);
    loadStory(st.id);
    renderAssignments();
    toast("Сюжет создан — назначьте исходники и печатайте сценарий", "ok");
}

/* ---------- левая колонка: NEWSWIRE ---------- */
const WIRE = [
    { time: "15:05", ag: "Правительство", text: "Правительство утвердило новый план развития транспортной инфраструктуры" },
    { time: "14:58", ag: "ЦБ", text: "Центробанк снизил ключевую ставку на 0,25%" },
    { time: "14:45", ag: "МЧС", text: "Пожар в торговом центре локализован" },
    { time: "14:32", ag: "Спорт", text: "Сборная России вышла в финал чемпионата мира" },
    { time: "14:20", ag: "Общество", text: "В город приехала делегация из Китая" },
    { time: "14:10", ag: "Общество", text: "Погода на выходные: без осадков" },
    { time: "14:02", ag: "ЦБ", text: "Рост цен на бензин замедлился" }
];
function renderWire() {
    const ag = $("ocWireFilter").value, q = $("ocWireSearch").value.trim().toLowerCase();
    $("ocWire").innerHTML = WIRE
        .filter(n => ag === "all" || n.ag === ag)
        .filter(n => !q || n.text.toLowerCase().includes(q))
        .map(n => `<div class="wire-item"><span class="wire-time">${n.time}</span>
            <span class="wire-text">${esc(n.text)}<span class="wire-ag">${esc(n.ag)}</span></span></div>`).join("")
        || '<div class="cl-empty">Нет новостей по фильтру</div>';
}
$("ocWireFilter").addEventListener("change", renderWire);
$("ocWireSearch").addEventListener("input", renderWire);

/* ---------- шапка сюжета ---------- */
function renderHead() {
    const st = active();
    const b = $("ocStatusBadge");
    b.textContent = badgeText(st.stage);
    b.className = "sb " + badgeCls(st.stage);
    $("ocStoryId").textContent = String(st.id).padStart(8, "0");
    $("ocStorySlug").textContent = (st.title || "—").toLowerCase().replace(/\s+/g, "-");
    $("ocModified").textContent = st.modified || "—";
}
$("storyTitle").addEventListener("input", () => { ocFlushSoon(); });
$("storyTitle").addEventListener("change", () => { ocFlushNow(); renderAssignments(); });

/* ---------- вкладки центра ---------- */
let centerTab = "script";
function switchCenterTab(name) {
    centerTab = name;
    document.querySelectorAll("#ocTabs .tab").forEach(t => t.classList.toggle("active", t.dataset.view === name));
    document.querySelectorAll(".cview").forEach(v => v.hidden = v.id !== "view-" + name);
    $("gnMetadata").classList.toggle("active", name === "metadata");
    $("gnStory").classList.toggle("active", name !== "metadata");
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
    document.querySelectorAll("#ocMediaTabs .tab").forEach(t => t.classList.toggle("active", t.dataset.mv === name));
    document.querySelectorAll(".mview").forEach(v => v.hidden = v.id !== "mv-" + name);
    if (name === "sots") renderSots();
    if (name === "graphics") renderGraphics();
    if (name === "approval") renderApproval();
}
document.querySelectorAll("#ocMediaTabs .tab").forEach(t =>
    t.onclick = () => switchMediaTab(t.dataset.mv));

/* ---------- TOTAL (хронометраж сценария) ---------- */
function renderTotal() {
    $("ocTotal").textContent = mmss(state.blocks.reduce((s, b) => s + blockDur(b), 0));
}

/* ---------- workflow: перевод сюжета на следующий этап (панель APPROVAL) ---------- */
function advanceStage() {
    const st = active();
    const i = OC.STAGES.indexOf(st.stage);
    if (i >= OC.STAGES.length - 1) return toast("Сюжет уже в эфире", "warn");
    st.stage = OC.STAGES[i + 1];
    (st.stageDates = st.stageDates || {})[st.stage] = dateHM();
    ocFlushNow(); renderHead(); renderAssignments();
    if (mediaTab === "approval") renderApproval();
    toast("Этап: " + st.stage, "ok");
}

/* ---------- COLLABORATION (comments / suggestions / tasks) ---------- */
let clTab = "comment";
const CL_LABEL = { comment: "комментариев", suggestion: "предложений", task: "задач" };
function renderCollab() {
    const st = active();
    st.comments = st.comments || [];
    ["comment", "suggestion", "task"].forEach(k =>
        $("clCount-" + k).textContent = st.comments.filter(c => c.kind === k).length);
    document.querySelectorAll(".cl-tabs .tab").forEach(t => t.classList.toggle("active", t.dataset.cl === clTab));
    const items = st.comments.filter(c => c.kind === clTab);
    const host = $("ocCollabList");
    if (!items.length) { host.innerHTML = `<div class="cl-empty">Нет ${CL_LABEL[clTab]}ов — напишите первым.</div>`; return; }
    host.innerHTML = items.map((c, ci) =>
        `<div class="cl-item${c.done ? " done" : ""}">
            ${c.kind === "task" ? `<input type="checkbox" class="cl-check" data-ci="${ci}" ${c.done ? "checked" : ""}>` : ""}
            <span class="cl-who">${esc(c.who)}</span>
            <span class="cl-body">${esc(c.text)}</span>
            <span class="cl-time">${c.time}</span></div>`).join("");
    host.querySelectorAll(".cl-check").forEach(ch => ch.onchange = () => {
        const arr = st.comments.filter(c => c.kind === clTab);
        arr[+ch.dataset.ci].done = ch.checked; ocFlushNow(); renderCollab();
    });
}
document.querySelectorAll(".cl-tabs .tab").forEach(t =>
    t.onclick = () => { clTab = t.dataset.cl; renderCollab(); });
function postCollab() {
    const inp = $("ocCommentText"), v = inp.value.trim();
    if (!v) return;
    const st = active();
    (st.comments = st.comments || []).push({ kind: clTab, who: resolveNameValue("fioReporter") || "Иван Петров", text: v, time: nowHM(), done: false });
    inp.value = ""; ocFlushNow(); renderCollab();
}
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
        <span class="badge ${b.kind} mi-badge">${KIND_META[b.kind].badge}</span>
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
    const st = active();
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
        <div class="ap-row"><span class="ap-num">5</span><span class="ap-main"><b>Этап: ${st.stage}</b>
            <span>${st.stage === "ON AIR" ? "Сюжет в эфире" : "Клик —перевести на следующий этап"}</span></span>
            <button data-ap="stage" ${st.stage === "ON AIR" ? "disabled" : ""}>→ Дальше</button></div>
    </div>`;
    const act = { doc: exportWord, imp: importWord,
                  csv: () => exportCsv(";"), mogrt: () => exportMogrt(";"),
                  stage: advanceStage };
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
            <td style="text-align:right;font-family:var(--mono);color:var(--green)">${mmss(d)}</td></tr>`;
    }).join("");
    $("ocSummary").innerHTML = `<h3>${esc(st.title || "Без названия")}</h3>
        <p class="muted">Этап: ${st.stage} · ID: ${String(st.id).padStart(8, "0")} · ${esc(resolveNameValue("fioReporter") || "корреспондент не указан")}</p>
        ${state.blocks.length ? `<table><tr><th>#</th><th>Тип</th><th>Спикер</th><th>Текст</th><th>Длит.</th></tr>${rows}</table>
        <p><b style="font-family:var(--mono);color:var(--green)">${mmss(total)}</b> — суммарный хронометраж</p>`
        : '<p class="muted">Сценарий пуст.</p>'}`;
}
function renderSources() {
    const used = new Map();
    state.blocks.forEach(b => b.parts.forEach(p => {
        const cur = used.get(p.file) || { n: 0, dur: 0 };
        used.set(p.file, { n: cur.n + 1, dur: cur.dur + (p.out - p.in) });
    }));
    $("ocSources").innerHTML = used.size ? [...used.entries()].map(([name, u]) =>
        `<div class="src-item" data-src="${esc(name)}"><span class="src-name">${esc(name)}</span>
         <span class="src-n">${u.n} фр.</span><span class="mi-dur">${mmss(u.dur)}</span></div>`).join("")
        : '<p class="muted">Фрагменты ещё не размечены. Откройте папку с исходниками (меню «Проект» → «Папка исходников…»), отметьте In/Out в мониторе и вставьте фрагмент в блок.</p>';
    $("ocSources").querySelectorAll("[data-src]").forEach(el => el.onclick = () => {
        const name = el.dataset.src;
        switchMediaTab("media");
        const vf = videoFiles.find(v => v.name === name);
        if (vf) loadVideo(vf);
        else toast("Папка с исходниками не выбрана или файл недоступен — Проект → «Папка исходников…»", "warn");
    });
}
function renderSocial() {
    const head = state.blocks.find(b => b.kind === "headline");
    const lead = state.blocks.find(b => b.kind === "vod" || b.kind === "vo");
    const text = ((head && head.text ? head.text + ". " : "") + (lead ? lead.text.replace(/\s+/g, " ") : "")).trim()
        || active().title;
    $("ocSocial").innerHTML = `<h3>Пост для соцсетей<button class="copy-btn" id="ocCopySocial">Copy</button></h3>
        <div id="ocSocialText" style="background:#101a22;border:1px solid var(--line);border-radius:3px;padding:10px;white-space:pre-wrap">${esc(text)}</div>
        <p class="muted">Черновик собран из HEADLINE и первой текстовой подводки — правьте в SCRIPT.</p>`;
    $("ocCopySocial").onclick = () => copyText(text, "Пост скопирован");
}
function copyText(t, okMsg) {
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject())
        .then(() => toast(okMsg, "ok"))
        .catch(() => toast("Браузер не дал доступ к буферу обмена", "err"));
}

/* ---------- NEWSWIRE click → поиск в assigns? (нет), only render ---------- */

/* ---------- общие обновления ---------- */
function ocRefreshAll() {
    renderHead(); renderAssignments(); renderTotal(); renderCollab();
    if (mediaTab === "sots") renderSots();
    if (mediaTab === "graphics") renderGraphics();
    if (mediaTab === "approval") renderApproval();
    if (centerTab === "summary") renderSummary();
    if (centerTab === "sources") renderSources();
    if (centerTab === "social") renderSocial();
}

/* ---------- обёртки над движком (app.js) ---------- */
const _rb = renderBlocks;
renderBlocks = function () { _rb(); ocRefreshAll(); };
const _ss = saveState;
saveState = function () { _ss(); ocFlushSoon(); };
const _rfl = refreshVideoList;
refreshVideoList = function () { _rfl(); $("ocVidCount").textContent = videoFiles.length; };
const _os = openSearch;
openSearch = function () { if ($("view-script").hidden) switchCenterTab("script"); _os(); };
/* черновик .json — с метаданными сюжета (этап, даты, комментарии); id не переносим */
saveDraft = function () {
    const st = active();
    download(slug($("storyTitle").value) + "_черновик.json",
        JSON.stringify({ blocks: state.blocks, nextId: state.nextId, req: store.get("ss_req", {}),
                         meta: { title: st.title, day: st.day, time: st.time, stage: st.stage,
                                 stageDates: st.stageDates, targetSec: st.targetSec,
                                 comments: st.comments, modified: st.modified } }, null, 1),
        "application/json");
    toast("Черновик сохранён (с этапом и комментариями)", "ok");
};
const _ldd = loadDraftData;
loadDraftData = function (d) {
    const ok = _ldd(d);
    if (ok && d && d.meta && typeof d.meta === "object") {
        const st = active();
        if (d.meta.stage && OC.STAGES.includes(d.meta.stage)) st.stage = d.meta.stage;
        if (d.meta.stageDates && typeof d.meta.stageDates === "object") st.stageDates = d.meta.stageDates;
        if (Array.isArray(d.meta.comments)) st.comments = d.meta.comments;
        if (Number.isFinite(+d.meta.targetSec) && +d.meta.targetSec > 0) st.targetSec = +d.meta.targetSec;
        if (Number.isFinite(+d.meta.day)) st.day = +d.meta.day;
        if (d.meta.time) st.time = d.meta.time;
        ocFlushNow(); renderHead(); renderAssignments();
    }
    return ok;
};

/* верхняя навигация: «Авторы» — реквизиты, «Проект» — меню, остальные (кроме Story) — заглушки */
document.querySelectorAll(".gnav .gn").forEach(b => {
    if (b.id === "gnProject") return;
    b.onclick = () => b.dataset.view ? switchCenterTab(b.dataset.view)
        : b.classList.contains("active") ? null : toast("Активен рабочий экран «" + b.textContent + "»: интерфейс заточен под Story", "warn");
});

/* ---------- меню «Проект»: файлы сюжета и экспорты ---------- */
const PJ_ITEMS = [
    { act: "new",  lbl: "➕ Создать…",       title: "Новый сюжет в текущем проекте", fn: () => newStoryDialog() },
    { act: "open", lbl: "📂 Открыть…",       title: "Загрузить черновик из файла .json — вернутся блоки, реквизиты и fps", fn: () => loadDraft() },
    { act: "save", lbl: "💾 Сохранить…",     title: "Сохранить текущий сюжет в файл-черновик .json и продолжить позже", fn: () => saveDraft() },
    { sep: true },
    { act: "dir",  lbl: "📁 Папка исходников…", title: "Выбрать папку с видеофайлами (можно по сети) — список появится в панели MEDIA", fn: () => pickFolderCompat() },
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
document.addEventListener("keydown", e => { if (e.key === "Escape") closeProjMenu(); });
["ocBell", "ocHelp", "ocApps"].forEach(id =>
    $(id).onclick = () => toast("Раздел в разработке", "warn"));

/* ---------- старт ---------- */
window.addEventListener("beforeunload", () => { clearTimeout(ocFlushT); ocFlushNow(); });
(function ocInit() {
    renderWire();
    if (!localStorage.getItem("ss_view")) setView("thumbs-big");   /* вид по умолчанию — сетка как в референсе */
    let list = store.get("oc_stories", null);
    let aid = store.get("oc_active", null);
    if (!Array.isArray(list) || !list.length) {
        list = seedStories();
        aid = list[0].id;
        OC.stories = list; OC.activeId = aid;
        persistStories();
    } else {
        OC.stories = list; OC.activeId = list.some(s => s.id === aid) ? aid : list[0].id;
        OC.nextNum = Math.max(OC.nextNum, ...list.map(s => s.id + 1));
    }
    loadStory(OC.activeId);
    renderWire();
})();
