const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../js/app.js"), "utf8");
const names = ["currentStoryId", "wholeFileDuration", "addWholeFilePart", "serializeDoc", "histBefore",
    "histRestore", "doUndo", "doRedo", "typeNumbers", "esc", "crc32", "zipStore", "wxRun", "wxPara",
    "wordBookmarkName", "wordBookmarkId", "wxBookmark", "buildDocx", "parseWordHead", "normWs",
    "wordItemsToBlocks", "docunzip", "docxParaText", "parseDocx", "buildWordPlan", "applyWordReview"];
function functionSource(name) {
    const start = source.search(new RegExp("^(?:async )?function " + name + "\\(", "m"));
    assert.notEqual(start, -1, name);
    const end = source.indexOf("\n}", start);
    return source.slice(start, end + 2);
}
function constantSource(name) {
    const start = source.indexOf("const " + name + " =");
    const end = name === "CRC_T" ? source.indexOf("})();", start) + 5 : source.indexOf(";", start) + 1;
    return source.slice(start, end);
}
function xmlNode(name, attrs = {}, children = [], value = "") {
    return {
        nodeName: name, nodeType: name === "#text" ? 3 : 1, childNodes: children,
        get textContent() { return value + children.map(n => n.textContent).join(""); },
        getAttribute(key) { return Object.hasOwn(attrs, key) ? attrs[key] : null; },
        getElementsByTagName(tag) {
            return children.flatMap(n => [...(n.nodeName === tag ? [n] : []), ...n.getElementsByTagName(tag)]);
        }
    };
}
function unescapeXml(s) {
    return s.replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[n]));
}
class FixtureDOMParser {
    parseFromString(xml) {
        const root = xmlNode("#document"), stack = [root];
        for (const token of xml.match(/<[^>]*>|[^<]+/g) || []) {
            if (token.startsWith("<?")) continue;
            if (token.startsWith("</")) { stack.pop(); continue; }
            if (token.startsWith("<")) {
                const name = token.match(/^<([^\s/>]+)/)[1];
                const attrs = Object.fromEntries([...token.matchAll(/([^\s=]+)="([^"]*)"/g)]
                    .map(m => [m[1], unescapeXml(m[2])]));
                const node = xmlNode(name, attrs);
                stack.at(-1).childNodes.push(node);
                if (!token.endsWith("/>")) stack.push(node);
            } else stack.at(-1).childNodes.push(xmlNode("#text", {}, [], unescapeXml(token)));
        }
        return root;
    }
}
function setup(blocks = []) {
    const elements = new Map(), videos = [], revoked = [], timers = new Map(), events = [];
    let timerId = 0;
    const context = vm.createContext({
        TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, Blob, Response, DecompressionStream,
        DOMParser: FixtureDOMParser,
        state: { blocks, nextId: 100 }, OC: { activeId: 12 }, videoFiles: [], wordPlan: null,
        URL: { createObjectURL: () => "blob:owned-" + videos.length, revokeObjectURL: u => revoked.push(u) },
        document: { createElement(tag) {
            assert.equal(tag, "video");
            const video = { duration: NaN, removeAttribute(name) { delete this[name]; }, load() { this.cleaned = true; } };
            videos.push(video);
            return video;
        } },
        $: id => {
            if (!elements.has(id)) elements.set(id, { value: id === "storyTitle" ? "Тест & сюжет" : "", hidden: false });
            return elements.get(id);
        },
        setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
        clearTimeout: id => timers.delete(id),
        resolveNameValue: () => "", renderBlocks: () => events.push("render"), saveState: () => events.push("save"),
        toast: msg => events.push(msg), blockTitle: b => String(b.id),
        closeWordReview: () => { context.wordPlan = null; events.push("close"); }
    });
    vm.runInContext([constantSource("CRC_T"), constantSource("PART_KINDS"), constantSource("TITR_KINDS"),
        "const durationLoads = new WeakMap(); const undoStack = [], redoStack = []; let typingBurst = 0;",
        ...names.map(functionSource)].join("\n"), context);
    return { c: context, videos, revoked, timers, events,
        undo: () => vm.runInContext("undoStack", context),
        tick: async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }
    };
}
const block = (id, kind = "sync", extra = {}) => ({ id, kind, text: "до", speaker: "Имя", role: "Роль", parts: [], ...extra });
const plain = value => JSON.parse(JSON.stringify(value));

test("real DOCX ZIP carries story/block bookmarks and roundtrips all kinds and empty titles", async () => {
    const blocks = ["vo", "sync", "standup", "life", "spiegel", "vod", "headline"].map((kind, i) =>
        block(i + 30, kind, { text: "строка & <текст>\nвторая", speaker: "", role: kind === "standup" ? "Роль" : "" }));
    const { c } = setup(blocks);
    const zip = c.buildDocx();
    const xml = await c.docunzip(zip.buffer, "word/document.xml");
    assert.match(xml, /SS_S_3132/);
    assert.equal((xml.match(/w:bookmarkStart/g) || []).length, 8);
    const parsed = await c.parseDocx(zip.buffer);
    assert.equal(parsed.storyId, "12");
    assert.deepEqual(Array.from(parsed.blocks, b => b.id), blocks.map(b => String(b.id)));
    assert.equal(c.buildWordPlan(parsed).rows.some(r => r.changed), false);
    const edited = xml.replace("Закадровый текст 1", "Совсем другой заголовок").replaceAll("Heading2", "Normal");
    const changed = await c.parseDocx(c.zipStore([{ name: "word/document.xml", data: edited }]).buffer);
    assert.equal(changed.blocks[0].id, "30");
    assert.equal(changed.blocks[0].text, blocks[0].text);
    assert.equal(c.buildWordPlan(changed).rows.some(r => r.changed), false);
});

test("complete app script compiles", () => {
    assert.doesNotThrow(() => new vm.Script(source, { filename: "js/app.js" }));
});

test("legacy DOCX survives localized styles; malformed and conflicting bookmarks are rejected", async () => {
    const { c } = setup([block(1)]);
    const zip = c.buildDocx();
    const original = await c.docunzip(zip.buffer, "word/document.xml");
    const parse = xml => c.parseDocx(c.zipStore([{ name: "word/document.xml", data: xml },
        { name: "word/styles.xml", data: '<w:styles><w:style w:styleId="2"><w:name w:val="Заголовок 2"/></w:style></w:styles>' }
    ]).buffer);
    const legacy = await parse(original.replace(/<w:bookmark(?:Start|End)\b[^>]*\/>/g, "").replaceAll("Heading2", "2"));
    assert.equal(legacy.storyId, undefined);
    assert.equal(legacy.blocks[0].id, undefined);
    assert.equal(c.buildWordPlan(legacy).rows[0].changed, false);
    await assert.rejects(parse(original.replace("SS_B_31", "SS_B_bad")), /повреждён ID/);
    await assert.rejects(parse(original.replace("<w:body>", '<w:body><w:bookmarkStart w:name="SS_S_3133"/>')), /разных сюжетов/);
    const clearRole = await parse(original.replace("Имя, Роль", "Имя"));
    const row = c.buildWordPlan(clearRole).rows[0];
    assert.equal(row.speakerChanged, false);
    assert.equal(row.roleChanged, true);
    assert.equal(row.it.role, "");
    const emptyHead = await parse(original.replace("Синхрон 1. Имя, Роль", ""));
    const emptyRow = c.buildWordPlan(emptyHead).rows[0];
    assert.equal(emptyRow.speakerChanged, false);
    assert.equal(emptyRow.roleChanged, false);
});

test("ID wins over numbering/order; unknown ID never falls back; foreign story rejected", () => {
    const { c } = setup([block(8), block(4)]);
    const plan = c.buildWordPlan({ storyId: "12", blocks: [
        { id: "4", kind: "sync", num: 1, text: "правка" },
        { id: "999", kind: "sync", num: 1, speaker: "Имя", text: "чужой" }
    ] });
    assert.equal(plan.rows.find(r => r.changed).b.id, 4);
    assert.equal(plan.fresh.length, 1);
    assert.equal(plan.rows.find(r => r.b.id === 8).changed, false);
    assert.throws(() => c.buildWordPlan({ storyId: "13", blocks: [] }), /ID сюжета/);
});

test("legacy number and unique speaker matching work, ambiguities and duplicate IDs do not apply", () => {
    const { c } = setup([block(1), block(2), block(3, "vod"), block(4, "vod")]);
    let p = c.buildWordPlan({ blocks: [{ kind: "sync", num: 2, text: "номер" }] });
    assert.equal(p.rows.find(r => r.changed).b.id, 2);
    p = c.buildWordPlan({ blocks: [{ kind: "sync", speaker: "Имя", text: "имя" }, { kind: "vod", text: "лид" }] });
    assert.equal(p.ambiguous.length, 2);
    assert.equal(p.rows.some(r => r.changed || r.missing), false);
    p = c.buildWordPlan({ blocks: [{ id: "1", text: "а" }, { id: "1", text: "б" }] });
    assert.equal(p.ambiguous.length, 2);
    assert.equal(p.rows.some(r => r.changed), false);
    p = c.buildWordPlan({ blocks: [{ kind: "sync", num: 1, text: "а" }, { kind: "sync", num: 1, text: "б" }] });
    assert.equal(p.ambiguous.length, 2);
    c.state.blocks[1].speaker = "Другой";
    p = c.buildWordPlan({ blocks: [{ kind: "sync", speaker: "Другой", text: "имя" }] });
    assert.equal(p.rows.find(r => r.changed).b.id, 2);
    p = c.buildWordPlan({ blocks: [{ kind: "sync", num: 1, text: "legacy" }, { id: "1", text: "ID" }] });
    assert.equal(p.rows.find(r => r.changed).it.text, "ID");
});

test("absent speaker/role preserved, empty imported; one undo restores changes and deletions", () => {
    const { c, undo, events } = setup([block(1), block(2)]);
    const before = plain(c.state);
    const absent = c.buildWordPlan({ blocks: [{ id: "1", text: "до" }] }).rows[0];
    assert.equal(absent.changed, false);
    const parsed = c.wordItemsToBlocks([{ id: "1", head: "Синхрон 1.", lines: ["после"] }]);
    c.wordPlan = c.buildWordPlan(parsed);
    c.wordPlan.rows.find(r => r.b.id === 2).removed = true;
    c.applyWordReview();
    assert.equal(c.state.blocks.length, 1);
    assert.equal(c.state.blocks[0].speaker, "");
    assert.equal(c.state.blocks[0].role, "");
    assert.equal(undo().length, 1);
    assert.ok(events.includes("save"));
    c.doUndo();
    assert.deepEqual(plain(c.state), before);
    c.doRedo();
    assert.equal(c.state.blocks[0].text, "после");
});

test("review cannot apply to a switched or edited story", () => {
    for (const change of [c => { c.OC.activeId++; }, c => { c.state.blocks = c.state.blocks.slice(); },
        c => { c.state.blocks[0].text = "новый ввод"; }]) {
        const { c, undo } = setup([block(1)]);
        c.wordPlan = c.buildWordPlan({ blocks: [{ id: "1", text: "правка" }] });
        change(c);
        c.applyWordReview();
        assert.notEqual(c.state.blocks[0].text, "правка");
        assert.equal(undo().length, 0);
    }
});

test("whole-file drag waits for positive finite duration, cleans owned URL and supports undo", async () => {
    const h = setup([block(1)]), { c } = h;
    c.videoFiles = [{ name: "a.mov", relPath: "folder/a.mov", file: {}, url: "blob:player" }];
    const pending = c.addWholeFilePart(c.state.blocks[0], "folder/a.mov");
    await h.tick();
    const v = h.videos[0];
    for (const invalid of [NaN, Infinity, 0, -1]) {
        v.duration = invalid;
        v.onloadedmetadata();
        assert.equal(c.state.blocks[0].parts.length, 0);
    }
    v.duration = 12.5;
    v.ondurationchange();
    await pending;
    assert.deepEqual(plain(c.state.blocks[0].parts), [{ file: "a.mov", path: "folder/a.mov", in: 0, out: 12.5 }]);
    assert.equal(v.cleaned, true);
    assert.equal(v.onloadedmetadata, null);
    assert.deepEqual(h.revoked, ["blob:owned-1"]);
    assert.equal(h.timers.size, 0);
    c.doUndo();
    assert.equal(c.state.blocks[0].parts.length, 0);
});

test("media errors/timeouts insert nothing and clean up; a retry remains possible", async () => {
    for (const mode of ["error", "timeout"]) {
        const h = setup([block(1)]), { c } = h;
        c.videoFiles = [{ name: "a.mov", relPath: "a.mov", file: {}, dur: Infinity }];
        const p = c.addWholeFilePart(c.state.blocks[0], "a.mov");
        await h.tick();
        if (mode === "error") h.videos[0].onerror();
        else [...h.timers.values()][0]();
        await p;
        assert.equal(c.state.blocks[0].parts.length, 0);
        assert.equal(h.undo().length, 0);
        assert.equal(h.revoked.length, 1);
        assert.equal(h.videos[0].cleaned, true);
        const retry = c.addWholeFilePart(c.state.blocks[0], "a.mov");
        await h.tick();
        h.videos[1].duration = 3;
        h.videos[1].onloadedmetadata();
        await retry;
        assert.equal(c.state.blocks[0].parts[0].out, 3);
    }
});

test("drag cancels after story/block/folder changes while metadata is pending", async () => {
    for (const change of [c => { c.OC.activeId++; }, c => { c.state.blocks = [block(1)]; },
        c => { c.state.blocks.splice(0, 1); }, c => { c.videoFiles = []; },
        c => { c.state.blocks[0].kind = "vo"; }]) {
        const h = setup([block(1)]), { c } = h;
        const original = c.state.blocks[0];
        c.videoFiles = [{ name: "a.mov", relPath: "a.mov", file: {} }];
        const p = c.addWholeFilePart(original, "a.mov");
        await h.tick();
        change(c);
        h.videos[0].duration = 3;
        h.videos[0].onloadedmetadata();
        await p;
        assert.equal(original.parts.length, 0);
        assert.equal(h.undo().length, 0);
        assert.equal(h.revoked.length, 1);
    }
});

test("cached duration avoids a video probe; handle timeout does not leak a late URL", async () => {
    const h = setup([block(1)]), { c } = h;
    c.videoFiles = [{ name: "a.mov", relPath: "a.mov", dur: 8 }];
    await c.addWholeFilePart(c.state.blocks[0], "a.mov");
    assert.equal(h.videos.length, 0);
    assert.equal(c.state.blocks[0].parts[0].out, 8);
    let resolve;
    const vf = { handle: { getFile: () => new Promise(r => { resolve = r; }) } };
    const duration = c.wholeFileDuration(vf);
    assert.equal(c.wholeFileDuration(vf), duration);
    await h.tick();
    [...h.timers.values()][0]();
    await assert.rejects(duration, /время ожидания/);
    resolve({});
    await h.tick();
    assert.equal(h.videos.length, 0);
    assert.equal(h.revoked.length, 0);
});
