const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const app = fs.readFileSync(path.join(__dirname, "../js/app.js"), "utf8");
const octopus = fs.readFileSync(path.join(__dirname, "../js/octopus.js"), "utf8");
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function section(source, start, end) {
    assert.ok(source.includes(start), start);
    assert.ok(source.includes(end), end);
    return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}
function fn(source, name) {
    const start = source.search(new RegExp("^(?:async )?function " + name + "\\(", "m"));
    assert.notEqual(start, -1, name);
    return source.slice(start, source.indexOf("\n}", start) + 2);
}
function localStore(initial = {}) {
    const data = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
    return {
        data, quota: Infinity,
        get length() { return data.size; },
        key(i) { return [...data.keys()][i]; },
        getItem(k) { return data.get(k) ?? null; },
        setItem(k, v) {
            if ([...data].filter(([key]) => key !== k).reduce((n, [, s]) => n + s.length, 0) + v.length > this.quota) {
                const e = new Error("quota"); e.name = "QuotaExceededError"; throw e;
            }
            data.set(k, String(v));
        },
        removeItem(k) { data.delete(k); }
    };
}
function database(initial = {}) {
    let data = new Map(Object.entries(initial).map(([k, v]) => [k, plain(v)]));
    const queue = [];
    const db = {
        readError: false, failNextWrite: false,
        get data() { return data; },
        transaction(name, mode) {
            assert.equal(name, "kv");
            let working;
            const requests = [];
            const t = {
                mode, aborted: false, error: null,
                objectStore: () => ({
                    get(k) { const r = {}; requests.push(() => {
                        if (db.readError) { t.error = new Error("ReadError"); t.abort(); return; }
                        r.result = plain(working.get(k)); r.onsuccess?.();
                    }); return r; },
                    put(v, k) { const copy = plain(v), r = {}; requests.push(() => { working.set(k, copy); r.result = k; r.onsuccess?.(); }); return r; },
                    delete(k) { requests.push(() => working.delete(k)); return {}; },
                    clear() { requests.push(() => working.clear()); return {}; }
                }),
                abort() { this.aborted = true; },
                requests() {
                    working = new Map([...data].map(([k, v]) => [k, plain(v)]));
                    while (requests.length && !this.aborted) requests.shift()();
                },
                finish() {
                    if (db.failNextWrite && mode === "readwrite") {
                        db.failNextWrite = false; this.error = new Error("CommitFailed"); this.aborted = true;
                    }
                    if (this.aborted) this.onabort?.();
                    else { if (mode === "readwrite") data = working; this.oncomplete?.(); }
                }
            };
            queue.push(t); return t;
        },
        indexedDB: { open() { const r = {}; queueMicrotask(() => { r.result = db; r.onsuccess(); }); return r; } },
        async tick() { for (let i = 0; i < 30; i++) await Promise.resolve(); },
        async request() { await this.tick(); const t = queue.shift(); assert.ok(t, "pending transaction"); t.requests(); return t; },
        async step() { const t = await this.request(); t.finish(); await this.tick(); return t; },
        async drain() { await this.tick(); for (let i = 0; queue.length; i++) { assert.ok(i < 100); await this.step(); } }
    };
    return db;
}
const story = (title = "A", id = 1) => ({ id, title, blocks: [{ id: 1, kind: "vo", text: title, parts: [] }], nextId: 2 });
const snapshot = (title = "A", rev = "r1") => ({ stories: [story(title)], activeId: 1, rev });
function setup({ db = database(), ls = localStore(), init = false, choose = 0 } = {}) {
    const elements = new Map(), listeners = {}, timers = new Map(), warnings = [], choices = [], downloads = [];
    let timer = 0;
    function element(id) {
        if (!elements.has(id)) elements.set(id, {
            value: ({ storyTitle: "A", fpsInput: "25", readSpeed: "130" })[id] || "", textContent: "", hidden: false,
            classList: { add() {}, remove() {}, toggle() {} },
            addEventListener() {}, setAttribute() {}, focus() {}, appendChild() {}, append() {},
            querySelectorAll: () => [], remove() {}
        });
        return elements.get(id);
    }
    const c = vm.createContext({
        crypto: webcrypto, console, localStorage: ls, indexedDB: db.indexedDB,
        document: { getElementById: element, addEventListener: (n, f) => { listeners[n] = f; }, hidden: false },
        state: { blocks: [story().blocks[0]], nextId: 2 },
        REQ_IDS: ["storyTitle", "fpsInput", "readSpeed", "fioReporter", "fioCam", "fioEditor"],
        NAME_IDS: ["fioReporter", "fioCam", "fioEditor"],
        SS_HOOK: { afterSave() {} },
        toast: s => warnings.push(s), download: (...args) => downloads.push(args),
        nowHM: () => "12:34", dateHM: () => "17.09 12:34", normalizeBlocks: plain,
        undoStack: [], redoStack: [], currentBlockId: null,
        renderBlocks() {}, setView() {}, loadReq() {}, seedStories: () => [story("seed")],
        setTimeout: f => { timers.set(++timer, f); return timer; }, clearTimeout: n => timers.delete(n)
    });
    c.window = c;
    c.addEventListener = (n, f) => { listeners[n] = f; };
    vm.runInContext([
        section(app, "const $ =", "/* Точки расширения"),
        section(app, "const IDB =", "/* ---------- выбор папки"),
        fn(app, "resolveNameValue"), fn(app, "saveReq"), fn(app, "saveState"),
        fn(octopus, "newStory"),
        section(octopus, "const OC =", "const nowHM ="),
        section(octopus, "window.SS_IDB_OK = false;", "/* ---------- управление сюжетами"),
        section(octopus, "function renderHead()", '$("fpsInput").addEventListener'),
        'SS_HOOK.afterSave = () => { sbDirty(); ocFlushSoon(); };'
    ].join("\n"), c);
    c.ocChooseSnapshot = (candidates, recovery) => {
        choices.push(plain({ candidates, recovery }));
        assert.equal(element("workspace").inert, true);
        return candidates[choose];
    };
    if (init) vm.runInContext(octopus.slice(octopus.lastIndexOf('window.addEventListener("beforeunload"')), c);
    else vm.runInContext('OC.stories = [seedStories()[0]]; OC.stories[0].title = "A"; OC.activeId = 1; ocInitDone = true; window.SS_STORAGE_LOADING = false; window.SS_IDB_OK = true;', c);
    return { c, db, ls, elements, listeners, timers, warnings, choices, downloads, element,
        run: code => vm.runInContext(code, c) };
}

test("complete storage scripts compile", () => {
    assert.doesNotThrow(() => new vm.Script(app));
    assert.doesNotThrow(() => new vm.Script(octopus));
});

test("saveState/saveReq with large quota uses this tab DOM and schedules persistence", async () => {
    const h = setup();
    h.element("storyTitle").value = "local";
    h.element("fioReporter").value = "reporter";
    h.ls.setItem("ss_req", JSON.stringify({ storyTitle: "foreign", fioReporter: "foreign" }));
    h.c.saveState();
    assert.equal(h.run('store.get("ss_req", {}).storyTitle'), "local");
    assert.equal(h.timers.size, 1);
    h.c.ocFlushNow();
    await h.db.drain();
    const saved = h.db.data.get("oc_snapshot");
    assert.equal(saved.stories[0].req.storyTitle, "local");
    assert.equal(saved.stories[0].req.fioReporter, "reporter");
    assert.equal(h.ls.getItem("ss_blocks"), null);
});

test("saved waits for transaction complete, never renderHead or request success", async () => {
    const h = setup();
    h.c.ocFlushNow();
    h.c.renderHead();
    assert.doesNotMatch(h.element("sbSaved").textContent, / saved/);
    const t = await h.db.request();
    assert.doesNotMatch(h.element("sbSaved").textContent, / saved/);
    assert.equal(h.db.data.get("oc_snapshot"), undefined);
    t.finish();
    await h.db.tick();
    assert.match(h.element("sbSaved").textContent, / saved/);
});

test("pending snapshot is immutable and old commit cannot hide newer input", async () => {
    const h = setup();
    h.c.state.blocks[0].text = "first";
    h.c.ocFlushNow();
    const t = await h.db.request();
    h.c.state.blocks[0].text = "second";
    h.c.saveState();
    t.finish();
    await h.db.tick();
    assert.equal(h.db.data.get("oc_snapshot").stories[0].blocks[0].text, "first");
    assert.doesNotMatch(h.element("sbSaved").textContent, / saved/);
    h.c.ocFlushNow();
    await h.db.drain();
    assert.equal(h.db.data.get("oc_snapshot").stories[0].blocks[0].text, "second");
    assert.match(h.element("sbSaved").textContent, / saved/);
});

test("atomic CAS allows only one of two readers of the same revision", async () => {
    const db = database({ oc_snapshot: snapshot() });
    const a = setup({ db }), b = setup({ db });
    a.run('ocBaseRev = ocQueuedRev = "r1"'); b.run('ocBaseRev = ocQueuedRev = "r1"');
    a.element("storyTitle").value = "winner"; b.element("storyTitle").value = "loser";
    a.c.ocFlushNow(); b.c.ocFlushNow();
    await db.drain();
    assert.equal(db.data.get("oc_snapshot").stories[0].title, "winner");
    assert.equal(db.data.get("oc_snapshot_backup").rev, "r1");
    assert.equal(b.ls.getItem("oc_stories"), null);
    const recovery = b.c.ocReadRecovery();
    assert.equal(recovery[0].snapshot.stories[0].title, "loser");
    assert.equal(recovery[0].baseRev, "r1");
    assert.match(b.element("quotaInfo").textContent, /Конфликт.*Сохраните черновик\/снимок, перезагрузите/);
    assert.doesNotMatch(b.element("sbSaved").textContent, / saved/);
});

test("LS migration abort preserves every source key and recovery", async () => {
    const ls = localStore({ oc_stories: [story("legacy")], oc_active: 1, ss_blocks: [story().blocks[0]], ss_nextId: 2 });
    const before = new Map(ls.data);
    const db = database(); db.failNextWrite = true;
    const h = setup({ db, ls, init: true });
    await db.drain();
    for (const [k, v] of before) assert.equal(ls.getItem(k), v, k);
    assert.notEqual(h.c.SS_LS_MIGRATED, true);
    assert.ok(h.c.ocReadRecovery().length);
    assert.doesNotMatch(h.element("sbSaved").textContent, / saved/);
});

test("successful migration removes LS only after commit and creates backup", async () => {
    const h = setup({ ls: localStore({ oc_stories: [story("legacy")], oc_active: 1 }), init: true });
    let write;
    for (let i = 0; i < 20; i++) {
        const t = await h.db.request();
        if (t.mode === "readwrite") { write = t; break; }
        t.finish();
    }
    assert.ok(write);
    assert.ok(h.ls.getItem("oc_stories"));
    assert.notEqual(h.c.SS_LS_MIGRATED, true);
    write.finish(); await h.db.drain();
    assert.equal(h.ls.getItem("oc_stories"), null);
    assert.equal(h.c.SS_LS_MIGRATED, true);
    assert.equal(h.db.data.get("oc_snapshot").stories[0].title, "legacy");
    assert.ok(h.db.data.get("oc_snapshot_backup"));
});

test("fallback recovery survives restart with IDB A and offers both versions", async () => {
    const db = database({ oc_snapshot: snapshot() }), ls = localStore();
    const a = setup({ db, ls });
    a.run('ocBaseRev = ocQueuedRev = "r1"');
    a.element("storyTitle").value = "B";
    db.failNextWrite = true;
    a.c.ocFlushNow(); await db.drain();
    const recovery = a.c.ocReadRecovery()[0];
    assert.equal(recovery.snapshot.stories[0].title, "B");
    assert.ok(recovery.timestamp); assert.equal(recovery.baseRev, "r1");
    const b = setup({ db, ls, init: true, choose: 1 });
    await db.drain();
    assert.equal(b.choices.length, 1);
    assert.equal(b.choices[0].candidates[0].snapshot.stories[0].title, "A");
    assert.equal(b.choices[0].candidates[1].snapshot.stories[0].title, "B");
    assert.equal(b.c.OC.stories[0].title, "B");
    assert.ok(ls.getItem(recovery.key));
    assert.equal(db.data.get("oc_snapshot").stories[0].title, "A");
});

test("critical IDB read errors reject and startup never overwrites unread data", async () => {
    const db = database({ oc_snapshot: snapshot() }); db.readError = true;
    const h = setup({ db, ls: localStore({ oc_stories: [story("B")] }), init: true });
    const read = h.run('IDB.read("kv", "oc_snapshot")');
    const rejected = assert.rejects(read, /ReadError/);
    await db.drain(); await rejected;
    assert.equal(db.data.get("oc_snapshot").stories[0].title, "A");
    assert.equal(h.c.OC.stories[0].title, "B");
    assert.equal(h.c.SS_IDB_OK, false);
    assert.ok(h.ls.getItem("oc_stories"));
    assert.ok(h.c.ocReadRecovery().length);
});

test("no IDB gives unique per-tab recovery, offers latest copy next startup", async () => {
    const db = database(), ls = localStore({ oc_stories: [story("legacy")] });
    db.indexedDB.open = () => { throw new Error("No IDB"); };
    const a = setup({ db, ls, init: true }); await db.drain();
    a.element("storyTitle").value = "fresh"; a.c.ocFlushNow(); await db.drain();
    const b = setup({ db, ls, init: true, choose: 1 }); await db.drain();
    assert.equal(b.c.OC.stories[0].title, "fresh");
    assert.equal(b.c.ocReadRecovery().length, 2);
    assert.equal(JSON.parse(ls.getItem("oc_stories"))[0].title, "legacy");
    assert.doesNotMatch(b.element("sbSaved").textContent, / saved/);
});

test("quota exhaustion retains legacy/recovery sources and reports unsaved", async () => {
    const ls = localStore({ oc_stories: [story("original")], oc_recovery_old: { snapshot: snapshot("old") } });
    const before = new Map(ls.data); ls.quota = 0;
    const h = setup({ ls }); h.c.SS_IDB_OK = false;
    h.c.ocFlushNow(); await h.db.drain();
    for (const [k, v] of before) assert.equal(ls.getItem(k), v);
    assert.match(h.element("sbSaved").textContent, /Не сохранено/);
    assert.equal(h.run('store.set("ss_names_fioReporter", ["name"])'), false);
    for (const [k, v] of before) assert.equal(ls.getItem(k), v);
});

test("queued writes capture values at persist time and backup previous revision", async () => {
    const h = setup();
    h.element("storyTitle").value = "first"; h.c.ocFlushNow();
    h.element("storyTitle").value = "second"; h.c.ocFlushNow();
    h.c.OC.stories[0].title = "mutable";
    await h.db.step();
    assert.equal(h.db.data.get("oc_snapshot").stories[0].title, "first");
    assert.doesNotMatch(h.element("sbSaved").textContent, / saved/);
    await h.db.drain();
    assert.equal(h.db.data.get("oc_snapshot").stories[0].title, "second");
    assert.equal(h.db.data.get("oc_snapshot_backup").stories[0].title, "first");
});

test("story switching cancels debounce and never reads foreign metadata", async () => {
    const h = setup();
    h.c.OC.stories.push(story("other", 2));
    h.element("fioReporter").value = "local reporter";
    h.c.saveState();
    h.ls.setItem("ss_req", JSON.stringify({ fioReporter: "foreign reporter" }));
    h.c.loadStory(2);
    assert.equal(h.timers.size, 0);
    await h.db.drain();
    const saved = h.db.data.get("oc_snapshot");
    assert.equal(saved.activeId, 2);
    assert.equal(saved.stories[0].req.fioReporter, "local reporter");
    assert.equal(h.element("fioReporter").value, "");
    assert.equal(h.element("readSpeed").value, "540");
    h.c.OC.stories[1].req = { readSpeed: "620" };
    h.c.loadStory(2);
    assert.equal(h.element("readSpeed").value, "620");
    await h.db.drain();
});

test("loading is inert and early saveState cannot schedule or write", async () => {
    const h = setup({ ls: localStore({ oc_stories: [story("recovered")] }), init: true });
    assert.equal(h.element("workspace").inert, true);
    h.c.saveState();
    assert.equal(h.timers.size, 0);
    await h.db.drain();
    assert.equal(h.element("workspace").inert, false);
    assert.equal(h.c.state.blocks[0].text, "recovered");
});

test("beforeunload warns for dirty/pending, but not a committed revision", async () => {
    const h = setup({ db: database({ oc_snapshot: snapshot() }), init: true });
    await h.db.drain();
    let prevented = 0;
    const e = { preventDefault() { prevented++; } };
    h.listeners.beforeunload(e);
    assert.equal(prevented, 0);
    h.c.state.blocks[0].text = "new"; h.c.saveState();
    h.listeners.beforeunload(e);
    assert.equal(prevented, 1); assert.equal(e.returnValue, "");
    assert.equal(h.c.ocReadRecovery()[0].snapshot.stories[0].blocks[0].text, "new");
    await h.db.drain();
});

test("fresh legacy LS B beside IDB A is a choice, never silent cleanup", async () => {
    const h = setup({ db: database({ oc_snapshot: snapshot() }), ls: localStore({ oc_stories: [story("B")] }), init: true, choose: 1 });
    await h.db.drain();
    assert.equal(h.choices.length, 1);
    assert.equal(h.c.OC.stories[0].title, "B");
    assert.ok(h.ls.getItem("oc_stories"));
    h.c.ocFlushNow(); await h.db.drain();
    assert.ok(h.ls.getItem("oc_stories"));
    assert.equal(h.db.data.get("oc_snapshot_backup").stories[0].title, "A");
});

test("backup and primary both roll back on transaction abort", async () => {
    const db = database({ oc_snapshot: snapshot("A"), oc_snapshot_backup: snapshot("older", "r0") });
    const h = setup({ db }); h.run('ocBaseRev = ocQueuedRev = "r1"');
    db.failNextWrite = true;
    h.element("storyTitle").value = "B"; h.c.ocFlushNow(); await db.drain();
    assert.equal(db.data.get("oc_snapshot").rev, "r1");
    assert.equal(db.data.get("oc_snapshot_backup").rev, "r0");
});

test("corrupt primary can recover backup without overwriting either copy", async () => {
    const db = database({ oc_snapshot: { rev: "broken" }, oc_snapshot_backup: snapshot("backup", "r0") });
    const h = setup({ db, init: true }); await db.drain();
    assert.equal(h.c.OC.stories[0].title, "backup");
    assert.equal(h.c.SS_IDB_OK, false);
    assert.equal(db.data.get("oc_snapshot").rev, "broken");
    assert.equal(db.data.get("oc_snapshot_backup").rev, "r0");
});

test("migration never removes a legacy copy changed while commit is pending", async () => {
    const h = setup({ ls: localStore({ oc_stories: [story("legacy")] }), init: true });
    let write;
    for (let i = 0; i < 20; i++) {
        const t = await h.db.request();
        if (t.mode === "readwrite") { write = t; break; }
        t.finish();
    }
    h.ls.setItem("oc_stories", JSON.stringify([story("fresh LS")]));
    write.finish(); await h.db.drain();
    assert.equal(JSON.parse(h.ls.getItem("oc_stories"))[0].title, "fresh LS");
    assert.notEqual(h.c.SS_LS_MIGRATED, true);
});

test("quotaDump includes current DOM work, snapshot, backup and legacy/recovery", async () => {
    const db = database({ oc_snapshot: snapshot("A"), oc_snapshot_backup: snapshot("old", "r0") });
    const ls = localStore({ oc_stories: [story("legacy")], oc_recovery_old: { snapshot: snapshot("recovery") } });
    const h = setup({ db, ls });
    h.c.SS_IDB_OK = false;
    h.element("storyTitle").value = "unsaved DOM";
    h.run(app.slice(app.indexOf('$("quotaDump").onclick =')));
    const done = h.element("quotaDump").onclick();
    await db.drain(); await done;
    const dump = JSON.parse(h.downloads[0][1]);
    assert.equal(dump.memory.stories[0].title, "unsaved DOM");
    assert.equal(dump.persisted.oc_snapshot.stories[0].title, "A");
    assert.equal(dump.persisted.oc_snapshot_backup.stories[0].title, "old");
    assert.equal(dump.local.oc_stories[0].title, "legacy");
    assert.equal(dump.local.oc_recovery_old.snapshot.stories[0].title, "recovery");
});
