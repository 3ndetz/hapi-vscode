'use strict';
// Runs only in the native website. Font changes use HAPI's storage contract;
// its native font-size variable renders text without scaling the iframe.
function websiteBridge(hubUrl) {
    if (parent === window) return;
    const hub = new URL(hubUrl || location.href);
    const local = new URL(location.href);
    const inside = url => ['http:', 'https:'].includes(url.protocol) && [hub.origin, local.origin].includes(url.origin) && url.pathname.startsWith(hub.pathname);
    const destination = value => {
        const url = new URL(value, location.href);
        return ['http:', 'https:'].includes(url.protocol) && url.origin === local.origin ? new URL(url.pathname + url.search + url.hash, hub.origin) : url;
    };
    const external = value => {
        const url = destination(value);
        if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) || inside(url)) return false;
        parent.postMessage({ type: 'hapi-open-external', url: url.href }, '*');
        return true;
    };
    const clicked = event => {
        // React's media/dialog handlers run first. Do not replace their action.
        if (event.defaultPrevented || event.button > 1) return;
        const anchor = event.composedPath().find(node => node?.tagName === 'A' && node.href);
        if (!anchor) return;
        if (external(anchor.href)) { event.preventDefault(); return; }
        const url = new URL(anchor.href, location.href);
        if (url.origin === hub.origin && url.origin !== local.origin && inside(url)) {
            anchor.href = new URL(url.pathname + url.search + url.hash, local.origin).href;
        }
    };
    document.addEventListener('click', clicked);
    document.addEventListener('auxclick', clicked);
    const open = window.open;
    window.open = function (url, ...args) {
        if (url && external(url)) return null;
        if (url) {
            const internal = new URL(url, location.href);
            if (inside(internal)) url = new URL(internal.pathname + internal.search + internal.hash, local.origin).href;
        }
        return open.call(this, url, ...args);
    };
    // Every embedded instance has its own origin. Avoid repeating HAPI's
    // composer onboarding in each new chat, before React reads these keys.
    try {
        for (const feature of ['scratchlist-toggle', 'rich-composer-mentions']) {
            localStorage.setItem('hapi.fue.v1.' + feature, '1');
        }
    } catch { /* Website storage restrictions remain in force. */ }
    const key = 'hapi-font-scale', scales = [0.8, 0.9, 1, 1.1, 1.2];
    const initializedKey = 'hapi-vscode-font-initialized';
    let path, display;
    const setScale = scale => {
        const oldValue = localStorage.getItem(key), value = scale === 1 ? null : String(scale);
        if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
        // Same preference as HAPI's initializeFontScale, without transforms.
        document.documentElement.style.setProperty('--app-font-scale', String(scale));
        window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue: value, storageArea: localStorage, url: location.href }));
    };
    const report = () => {
        if (path !== location.pathname) { path = location.pathname; parent.postMessage({ type: 'hapi-navigation', path }, '*'); }
        let raw = document.documentElement.style.getPropertyValue('--app-font-scale');
        if (raw) try {
            if (!localStorage.getItem(initializedKey)) {
                // Apply the extension default once. Preserve existing native
                // choices and later explicit 100%, whose native key is absent.
                if (localStorage.getItem(key) === null) setScale(0.8);
                localStorage.setItem(initializedKey, '1');
                raw = document.documentElement.style.getPropertyValue('--app-font-scale');
            }
        } catch { /* Website storage restrictions remain in force. */ }
        const next = { type: 'hapi-display', supported: raw !== '' && Number.isFinite(Number(raw)), fontScale: Number(raw) || 1 };
        const signature = JSON.stringify(next);
        if (display !== signature) { display = signature; parent.postMessage(next, '*'); }
    };
    window.addEventListener('message', event => {
        if (event.source !== parent || event.data?.type !== 'hapi-set-font-scale' || !scales.includes(event.data.scale)) return;
        if (!document.documentElement.style.getPropertyValue('--app-font-scale')) return;
        try {
            // Same-document storage writes do not emit a browser storage event.
            // Notify HAPI's existing listener so its React state updates live.
            setScale(event.data.scale); localStorage.setItem(initializedKey, '1');
        } catch { /* Website storage restrictions remain in force. */ }
    });
    setInterval(report, 300);
}
module.exports = { websiteBridge };
