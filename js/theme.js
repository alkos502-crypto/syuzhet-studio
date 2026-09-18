"use strict";

(() => {
    const key = "ss_theme";
    const choices = new Set(["dark", "light", "system"]);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    let preference = "dark";
    try {
        const saved = localStorage.getItem(key);
        if (choices.has(saved)) preference = saved;
    } catch (e) {}
    function apply() {
        document.documentElement.dataset.theme = preference === "system"
            ? (media.matches ? "dark" : "light") : preference;
        const select = document.getElementById("themeSelect");
        if (select) select.value = preference;
    }
    apply();
    if (media.addEventListener) media.addEventListener("change", apply);
    else if (media.addListener) media.addListener(apply);
    window.addEventListener("storage", e => {
        if (e.key !== key && e.key !== null) return;
        preference = choices.has(e.newValue) ? e.newValue : "dark";
        apply();
    });
    document.addEventListener("DOMContentLoaded", () => {
        const select = document.getElementById("themeSelect");
        if (!select) return;
        apply();
        select.addEventListener("change", () => {
            preference = choices.has(select.value) ? select.value : "dark";
            apply();
            try { localStorage.setItem(key, preference); } catch (e) {}
        });
    }, { once: true });
})();
