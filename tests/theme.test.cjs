const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../js/theme.js"), "utf8");
function setup(saved = null, dark = false, blocked = false) {
    const listeners = {}, windowListeners = {}, selectListeners = {};
    const select = { value: "", addEventListener: (name, fn) => { selectListeners[name] = fn; } };
    const root = { dataset: {} }, writes = [];
    const media = { matches: dark, addEventListener: (name, fn) => { media.change = fn; } };
    let ready = false;
    vm.runInNewContext(source, {
        window: { matchMedia: () => media, addEventListener: (name, fn) => { windowListeners[name] = fn; } },
        document: { documentElement: root, getElementById: () => ready ? select : null,
            addEventListener: (name, fn) => { listeners[name] = fn; } },
        localStorage: { getItem: () => { if (blocked) throw new Error("blocked"); return saved; },
            setItem: (key, value) => { if (blocked) throw new Error("blocked"); writes.push([key, value]); } }
    });
    return { root, media, select, writes,
        ready() { ready = true; listeners.DOMContentLoaded(); },
        choose(value) { select.value = value; selectListeners.change(); },
        storage(key, newValue) { windowListeners.storage({ key, newValue }); }
    };
}

test("theme is applied before DOM ready and existing dark default is preserved", () => {
    for (const saved of [null, "invalid", "dark"]) {
        const h = setup(saved);
        assert.equal(h.root.dataset.theme, "dark");
        h.ready(); assert.equal(h.select.value, "dark");
    }
    assert.equal(setup("light", true).root.dataset.theme, "light");
    const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
    assert.ok(html.indexOf('src="js/theme.js"') < html.indexOf('href="css/style.css"'));
    assert.match(html, /id="themeSelect"/);
});

test("theme selection persists and restores on reload", () => {
    const h = setup(); h.ready(); h.choose("light");
    assert.equal(h.root.dataset.theme, "light");
    assert.deepEqual(h.writes, [["ss_theme", "light"]]);
    const restored = setup(h.writes[0][1]); restored.ready();
    assert.equal(restored.select.value, "light");
    assert.equal(restored.root.dataset.theme, "light");
    h.choose("dark"); assert.equal(h.root.dataset.theme, "dark");
});

test("system preference follows OS changes only in system mode", () => {
    const h = setup("system", false); h.ready();
    assert.equal(h.root.dataset.theme, "light");
    assert.equal(h.select.value, "system");
    h.media.matches = true; h.media.change(); assert.equal(h.root.dataset.theme, "dark");
    h.choose("light"); h.media.change(); assert.equal(h.root.dataset.theme, "light");
    h.choose("system"); assert.equal(h.root.dataset.theme, "dark");
});

test("storage denial does not block switching and tab changes synchronize", () => {
    const h = setup(null, false, true); h.ready();
    h.choose("light"); assert.equal(h.root.dataset.theme, "light");
    h.storage("unrelated", "dark"); assert.equal(h.root.dataset.theme, "light");
    h.storage("ss_theme", "system"); assert.equal(h.select.value, "system");
    h.storage("ss_theme", "invalid"); assert.equal(h.root.dataset.theme, "dark");
    h.choose("light"); h.storage(null, null); assert.equal(h.select.value, "dark");
});
