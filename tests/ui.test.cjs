const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "../js/app.js"), "utf8");
const octopus = fs.readFileSync(path.join(__dirname, "../js/octopus.js"), "utf8");
function fn(source, name) {
    const start = source.search(new RegExp("^(?:async )?function " + name + "\\(", "m"));
    assert.notEqual(start, -1, name);
    const lineEnd = source.indexOf("\n", start);
    if (source.slice(start, lineEnd).endsWith("}")) return source.slice(start, lineEnd);
    return source.slice(start, source.indexOf("\n}", start) + 2);
}
function section(source, start, end) {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    assert.ok(a >= 0 && b > a, start);
    return source.slice(a, b);
}
function setup(blocks = []) {
    let document;
    class Element {
        constructor(tag = "div") {
            this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.style = {};
            this.attrs = {}; this.listeners = {}; this.className = ""; this.value = "";
            this.hidden = false; this.disabled = false; this.textContent = "";
            this.offsetWidth = 220; this.offsetHeight = 180; this.scrollHeight = 20;
            this.classList = {
                contains: c => this.className.split(/\s+/).includes(c),
                add: (...cs) => { this.className = [...new Set(this.className.split(/\s+/).concat(cs))].join(" "); },
                remove: (...cs) => { this.className = this.className.split(/\s+/).filter(c => !cs.includes(c)).join(" "); },
                toggle: (c, on) => { if (on ?? !this.classList.contains(c)) this.classList.add(c); else this.classList.remove(c); }
            };
        }
        setAttribute(k, v) { this.attrs[k] = String(v); }
        getAttribute(k) { return this.attrs[k]; }
        get isConnected() { return this === document.body || !!this.parentNode?.isConnected; }
        appendChild(el) { el.parentNode = this; this.children.push(el); return el; }
        remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; }
        contains(el) { return el === this || this.children.some(c => c.contains(el)); }
        addEventListener(k, f) { (this.listeners[k] ||= []).push(f); }
        removeEventListener(k, f) { this.listeners[k] = (this.listeners[k] || []).filter(x => x !== f); }
        dispatch(k, extra = {}) {
            const e = { target: this, currentTarget: this, preventDefault() { this.prevented = true; },
                stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra };
            for (const f of this.listeners[k] || []) f(e);
            if (!e.stopped && this.parentNode) this.parentNode.dispatch(k, e);
            return e;
        }
        click() { if (!this.disabled) { this.onclick?.({ target: this }); this.dispatch("click"); } }
        focus() { document.activeElement = this; this.dispatch("focus"); this.dispatch("focusin"); }
        select() { this.setSelectionRange(0, this.value.length); }
        setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
        scrollIntoView() { this.scrolled = true; }
        getBoundingClientRect() { return { left: 40, bottom: 80, top: 50, width: 220 }; }
        matches(s) {
            const id = s.match(/#([\w-]+)/), cls = [...s.matchAll(/\.([\w-]+)/g)], attr = s.match(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/);
            const tag = s.match(/^[a-z]+/i);
            return (!id || this.id === id[1]) && cls.every(m => this.classList.contains(m[1])) &&
                (!tag || this.tagName === tag[0].toUpperCase()) && (!attr ||
                    String(attr[1].startsWith("data-") ? this.dataset[attr[1].slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] : this.attrs[attr[1]]) === String(attr[2] ?? this.attrs[attr[1]]));
        }
        closest(s) { return s.split(",").some(q => this.matches(q.trim())) ? this : this.parentNode?.closest(s); }
        querySelectorAll(s) {
            const all = this.children.flatMap(c => [c, ...c.querySelectorAll("*")]);
            if (s === "*") return all;
            return all.filter(el => s.split(",").some(q => {
                const bits = q.trim().split(/\s+/), last = bits.pop();
                return el.matches(last) && (!bits.length || el.parentNode?.closest(bits.join(" ")));
            }));
        }
        querySelector(s) { return this.querySelectorAll(s)[0] || null; }
        set innerHTML(html) {
            this._html = html; this.children.forEach(c => { c.parentNode = null; }); this.children = [];
            const stack = [this];
            for (const token of html.match(/<[^>]*>|[^<]+/g) || []) {
                if (token.startsWith("</")) { if (stack.length > 1) stack.pop(); continue; }
                if (!token.startsWith("<")) { stack.at(-1).textContent += token; continue; }
                const tag = token.match(/^<([\w-]+)/)?.[1]; if (!tag) continue;
                const el = new Element(tag);
                for (const m of token.matchAll(/([\w-]+)="([^"]*)"/g)) {
                    el.setAttribute(m[1], m[2]);
                    if (m[1] === "class") el.className = m[2];
                    else if (m[1].startsWith("data-")) el.dataset[m[1].slice(5)] = m[2];
                    else el[m[1]] = m[2];
                }
                stack.at(-1).appendChild(el);
                if (!/^(input|br|hr)$/.test(tag) && !token.endsWith("/>")) stack.push(el);
            }
        }
        get innerHTML() { return this._html || ""; }
    }
    document = new Element("document"); document.body = new Element("body"); document.appendChild(document.body);
    document.createElement = tag => new Element(tag);
    document.getElementById = id => document.querySelector("#" + id);
    const ids = ["blocks", "btnAddBlock", "btnSend", "curBlock", "sendHint", "markInTc", "markOutTc", "markDuration",
        "player", "curTc", "fileDur", "monFile", "videoList", "fpsInput", "readSpeed", "totalDur", "miniTl",
        "findBar", "findInput", "findCount", "findNext", "findPrev", "findClose", "btnFind", "ocTotal", "ocTotalPlan"];
    ids.forEach(id => { const el = new Element(id.startsWith("btn") || /find(Next|Prev)/.test(id) ? "button" : id.endsWith("Input") ? "input" : "div"); el.id = id; document.body.appendChild(el); });
    const $ = id => document.getElementById(id), events = [];
    $("fpsInput").value = "25"; $("readSpeed").value = "540";
    Object.assign($("player"), { duration: 10, readyState: 1, currentTime: 2, src: "blob:file", currentSrc: "blob:file", error: null, play: () => Promise.resolve() });
    const c = vm.createContext({ document, $, state: { blocks, nextId: 100 }, videoFiles: [], currentBlockId: null,
        curFile: "", curRelPath: "", markIn: null, markOut: null, marksSet: false, limitToMarks: false, previewLoop: false,
        findHits: [], findPos: -1, DEFAULT_FPS: 25, videoLoadSeq: 0, videoLoading: false,
        SS_HOOK: { afterRender() {}, afterDuration() {}, commentCount: () => 0, beforeSearch() {}, draftLoaded() {} },
        icon: () => "", badgeHtml: k => k, saveState: () => events.push("save"), saveReq() {}, histBefore: () => events.push("history"), histTyping() {},
        updateScrub() {}, updateUsedDots() {}, dragCleanup() {}, toast: s => events.push(s), dupWarning() {},
        active: () => ({ targetSec: 5 }), mmss: s => String(s), confirm2: async () => true,
        setTimeout: f => { f(); return 1; }, clearTimeout() {}, ensureUrl: async f => f.url,
        store: { get: () => ({}), set() {} }, normalizeBlocks: b => b, loadReq() {}
    });
    c.window = c; c.innerWidth = 1000; c.innerHeight = 700;
    const names = ["esc", "fpsVal", "tc", "durHuman", "newBlock", "typeNumbers", "blockTitle", "readCps", "estDur", "partsDur", "blockDur", "durTc",
        "autogrow", "focusBlock", "setCurrentBlock", "renderBlocks", "refreshDur", "refreshTiming", "updateMiniTl",
        "closeAddKindMenu", "showAddKindMenu", "bindAddBlockButton", "addAndFocus", "docTrigger",
        "closeBlockCtx", "showBlockCtxMenu",
        "clearFindHighlight", "openSearch", "closeSearch", "collectFind", "gotoFind", "doFind",
        "refreshTargets", "updateMarksText", "updateMarks", "pullPart", "loadVideo", "loadDraftData"];
    if (app.includes("function sendReason(")) names.push("sendReason");
    vm.runInContext([section(app, "const KIND_META =", "function badgeHtml"),
        section(app, "const PART_KINDS =", "let currentBlockId"), ...names.map(n => fn(app, n)), fn(octopus, "renderTotal"),
        section(app, 'bindAddBlockButton($("btnAddBlock"));', "/* ---------- перетаскивание блоков"),
        section(app, '$("findInput").addEventListener("input"', "/* ---------- экспорт: CSV"),
        section(app, '$("btnSend").addEventListener', "/* ---------- горячие клавиши плеера"),
        section(app, "REQ_IDS.forEach(k => {\n    if (NAME_IDS", "/* ---------- модальные вопросы")
            .replace("REQ_IDS.forEach", '["readSpeed", "fpsInput"].forEach').replace("NAME_IDS.includes(k)", "false")
    ].join("\n"), c);
    if (octopus.includes("SS_HOOK.afterDuration =")) vm.runInContext(octopus.match(/^SS_HOOK.afterDuration =.*$/m)[0], c);
    c.renderBlocks();
    return { c, $, document, events };
}
const block = (id, kind = "sync", extra = {}) => ({ id, kind, text: "", speaker: "", role: "", parts: [], ...extra });

test("toolbar and empty state open the real menu; click, Enter, Space, Escape work", () => {
    const { c, $, document } = setup();
    assert.ok($("btnEmptyAddBlock"));
    $("btnEmptyAddBlock").click();
    assert.equal($("addKindMenu").style.left, "40px");
    assert.equal($("addKindMenu").style.top, "84px");
    document.dispatch("keydown", { key: "Escape", target: document.activeElement });
    assert.equal($("addKindMenu"), null);
    assert.equal(document.activeElement, $("btnEmptyAddBlock"));
    for (const key of ["Enter", " "]) {
        $("btnAddBlock").dispatch("keydown", { key });
        const menu = $("addKindMenu"); assert.ok(menu);
        document.dispatch("mousedown", { target: menu.children[1] });
        assert.equal($("addKindMenu"), menu);
        document.dispatch("keydown", { key, target: document.activeElement });
        assert.equal($("addKindMenu"), null);
    }
    $("btnAddBlock").click(); $("addKindMenu").children[3].click();
    assert.equal(c.state.blocks.length, 3);
    assert.equal(c.state.blocks[2].kind, "sync");
    $("btnAddBlock").click(); document.dispatch("mousedown", { target: $("blocks") });
    assert.equal($("addKindMenu"), null);
    assert.equal(document.listeners.keydown.length, 0);
});

test("context menu opens on empty background only, anchored to pointer, and closes on outside click", () => {
    const { c, $, document } = setup([block(1, "sync"), block(2, "vo")]);
    const row = $("blocks").children[0];
    row.dispatch("contextmenu");
    assert.equal($("addKindMenu"), null);
    row.querySelector(".doc-text").dispatch("contextmenu");
    assert.equal($("addKindMenu"), null);
    $("blocks").dispatch("contextmenu", { clientX: 55, clientY: 66 });
    const menu = $("addKindMenu"); assert.ok(menu);
    assert.equal(menu.style.left, "55px"); assert.equal(menu.style.top, "66px");
    $("blocks").dispatch("contextmenu", { clientX: 12, clientY: 8 });
    assert.equal($("addKindMenu").style.left, "12px");
    $("blocks").dispatch("contextmenu", { clientX: 30, clientY: 40 });
    assert.equal($("addKindMenu").style.left, "30px");
    $("blocks").dispatch("mousedown", { target: $("findBar") });
    assert.equal($("addKindMenu"), null);
    $("blocks").dispatch("contextmenu", { clientX: 1, clientY: 2 });
    assert.ok($("addKindMenu"));
    document.dispatch("keydown", { key: "Escape", target: document.activeElement });
    assert.equal($("addKindMenu"), null);
    assert.equal(c.state.blocks.length, 2);
});

test("typing and repeated search navigation preserve focus and select the matching field", () => {
    const { c, $, document } = setup([block(1, "sync", { speaker: "Иван", role: "Иван врач", text: "текст Иван", folded: true })]);
    const input = $("findInput"); input.focus(); input.value = "Иван"; input.setSelectionRange(4, 4);
    input.dispatch("input");
    const row = $("blocks").children[0], speaker = row.querySelector(".b-speaker"), role = row.querySelector(".b-role"), text = row.querySelector(".doc-text");
    assert.equal(document.activeElement, input); assert.equal(input.selectionStart, 4);
    assert.equal(speaker.classList.contains("find-hit"), true); assert.equal(speaker.selectionEnd, 4);
    assert.equal(text.selectionEnd, undefined); assert.equal(row.classList.contains("folded"), false);
    input.dispatch("keydown", { key: "Enter" });
    assert.equal(role.classList.contains("find-hit"), true); assert.equal(role.selectionStart, 0);
    $("findNext").focus(); $("findNext").click();
    assert.equal(document.activeElement, input); assert.equal(text.selectionStart, 6); assert.equal(text.scrolled, true);
    input.dispatch("keydown", { key: "Enter", shiftKey: true }); assert.equal(role.classList.contains("find-hit"), true);
    input.value = "нет"; input.dispatch("input"); assert.equal(document.querySelectorAll(".find-hit").length, 0);
    c.closeSearch(); assert.equal($("findBar").hidden, true);
});

test("text, PACE and FPS update derived duration without replacing editor nodes", () => {
    const { $, document } = setup([block(1, "vo")]);
    const row = $("blocks").children[0], text = row.querySelector(".doc-text"); text.focus();
    text.value = "a".repeat(90); text.dispatch("input");
    assert.equal($("ocTotal").textContent, "10"); assert.equal($("ocTotal").classList.contains("over"), true);
    $("readSpeed").value = "1080"; $("readSpeed").dispatch("input");
    assert.equal($("ocTotal").textContent, "5"); assert.equal($("ocTotal").classList.contains("over"), false);
    $("fpsInput").value = "30"; $("fpsInput").dispatch("change");
    assert.equal($("blocks").children[0], row); assert.equal(document.activeElement, text);
    assert.equal(row.querySelector(".doc-dur").textContent, "~00:05");
});

test("speaker/role focus chooses persistent target; invalid marks disable Send and direct pullPart", () => {
    const { c, $, document, events } = setup([block(1), block(2), block(3, "vo")]);
    c.videoFiles = [{ name: "a.mp4", relPath: "dir/a.mp4", url: "blob:file" }];
    c.curFile = "a.mp4"; c.curRelPath = "dir/a.mp4"; c.markIn = 1; c.markOut = 4;
    const row = $("blocks").children[1]; row.querySelector(".b-role").focus(); c.updateMarks();
    assert.equal(c.currentBlockId, 2); assert.equal(row.classList.contains("send-target"), true);
    $("btnSend").focus(); assert.equal(row.classList.contains("send-target"), true);
    assert.equal($("btnSend").disabled, false); assert.equal($("markDuration").textContent, "00:00:03:00");
    for (const [start, end, duration] of [[NaN, 4, 10], [1, Infinity, 10], [4, 4, 10], [5, 4, 10], [-1, 4, 10], [1, 11, 10], [1, 4, NaN]]) {
        c.markIn = start; c.markOut = end; $("player").duration = duration; c.updateMarks();
        assert.equal($("btnSend").disabled, true); assert.ok($("sendHint").textContent);
        assert.equal($("btnSend").title, $("sendHint").textContent);
        c.pullPart(c.state.blocks[1]); assert.equal(c.state.blocks[1].parts.length, 0);
    }
    assert.equal(events.includes("history"), false);
    c.markIn = 1; c.markOut = 4; $("player").duration = 10; c.updateMarks();
    $("btnSend").click(); assert.equal(c.state.blocks[1].parts.length, 1);
    assert.equal(document.activeElement, $("blocks").children[1].querySelector(".doc-text"));
    c.state.blocks.splice(1, 1); c.renderBlocks(); assert.equal(c.currentBlockId, null); assert.equal($("btnSend").disabled, true);
});
