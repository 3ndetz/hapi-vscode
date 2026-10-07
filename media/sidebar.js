'use strict';
const api = acquireVsCodeApi();
const frames = new Map(); const profile = document.getElementById('profile');
const settings = document.getElementById('settings'), toggle = document.getElementById('settings-toggle');
const font = document.getElementById('font-scale');
let activeId = '';
const findBar = document.getElementById('find-bar'), findInput = document.getElementById('find-input'), findStatus = document.getElementById('find-status');
const sendFind = data => { const frame = frames.get(activeId); if (frame) frame.contentWindow.postMessage(data, new URL(frame.src).origin); };
const search = (backwards = false, reset = false) => { findStatus.textContent = ''; sendFind({ type: 'hapi-find-text', query: findInput.value, backwards, reset }); };
const openFind = () => { showSettings(false); findBar.hidden = false; findInput.focus(); findInput.select(); if (findInput.value) search(false, true); };
const closeFind = () => { findBar.hidden = true; findStatus.textContent = ''; sendFind({ type: 'hapi-find-close' }); frames.get(activeId)?.focus(); };
findInput.addEventListener('input', () => search(false, true));
findInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); search(event.shiftKey); } });
document.getElementById('find-previous').addEventListener('click', () => search(true));
document.getElementById('find-next').addEventListener('click', () => search());
document.getElementById('find-close').addEventListener('click', closeFind);
const updateFont = () => {
    const frame = frames.get(activeId);
    font.disabled = frame?.dataset.fontSupported !== 'true';
    const scale = Number(frame?.dataset.fontScale || 1);
    font.value = [...font.options].some(option => option.value === String(scale)) ? String(scale) : '';
    font.options[0].textContent = frame?.dataset.fontScale ? `${Math.round(scale * 100)}% (HAPI)` : 'HAPI setting';
    font.title = font.disabled ? 'Use HAPI Display settings if this hub does not support the native font bridge.' : 'Native HAPI font size, saved only for this website instance.';
};
font.addEventListener('change', () => {
    const frame = frames.get(activeId);
    if (frame) frame.contentWindow.postMessage({ type: 'hapi-set-font-scale', scale: Number(font.value) }, new URL(frame.src).origin);
});
document.addEventListener('click', event => {
    const destination = event.target.closest('[data-target]');
    if (destination) { showSettings(false); api.postMessage({ type: 'location', target: destination.dataset.target, operation: destination.dataset.operation }); return; }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'findPage') { openFind(); return; }
    if (action) { showSettings(false); api.postMessage({ type: 'action', action }); }
});
const showSettings = open => { settings.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); };
toggle.addEventListener('click', () => showSettings(settings.hidden));
document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); openFind(); }
    if (event.key === 'Escape' && !findBar.hidden) { event.preventDefault(); closeFind(); }
    else if (event.key === 'Escape' && !settings.hidden) { showSettings(false); toggle.focus(); }
});
document.addEventListener('pointerdown', event => { if (!settings.contains(event.target) && !toggle.contains(event.target)) showSettings(false); });
// Pointer events inside a cross-origin website do not bubble into its parent.
window.addEventListener('blur', () => { if (document.activeElement?.tagName === 'IFRAME') showSettings(false); });
const proxyMode = document.getElementById('proxy-mode');
proxyMode.addEventListener('change', () => api.postMessage({ type: 'proxy', mode: proxyMode.value }));
profile.addEventListener('change', () => api.postMessage({ type: 'profile', id: profile.value }));
window.addEventListener('message', event => {
    if (['hapi-navigation', 'hapi-display', 'hapi-open-external', 'hapi-find-open', 'hapi-find-result'].includes(event.data?.type)) {
        for (const [id, frame] of frames) if (event.source === frame.contentWindow && event.origin === new URL(frame.src).origin) {
            if (id === activeId && event.data.type === 'hapi-find-open') openFind();
            if (id === activeId && event.data.type === 'hapi-find-result' && event.data.query === findInput.value) findStatus.textContent = !event.data.supported ? 'Search unavailable' : !event.data.query ? '' : event.data.found ? 'Found' : 'No results';
            if (event.data.type === 'hapi-navigation' && typeof event.data.path === 'string') api.postMessage({ type: 'navigate', id, path: event.data.path });
            if (event.data.type === 'hapi-open-external' && typeof event.data.url === 'string') api.postMessage({ type: 'externalLink', id, url: event.data.url });
            if (event.data.type === 'hapi-display' && Number.isFinite(event.data.fontScale)) {
                frame.dataset.fontSupported = String(event.data.supported === true);
                frame.dataset.fontScale = String(event.data.fontScale); updateFont();
            }
            return;
        }
        return;
    }
    // VS Code forwards messages from its preload window, whose WindowProxy
    // differs between runtimes. Trust the webview origin, never a hub iframe.
    if (event.origin !== window.origin) return;
    if (event.data?.type === 'find') { openFind(); return; }
    if (event.data?.type !== 'state') return;
    const state = event.data;
    if (activeId !== state.activeId && !findBar.hidden) closeFind();
    activeId = state.activeId || '';
    if (state.panel && state.navigation) api.setState(state.navigation);
    document.body.classList.toggle('panel', !!state.panel);
    document.documentElement.style.colorScheme = state.syncTheme ? state.theme : 'normal';
    profile.replaceChildren(...state.profiles.map(p => { const option = document.createElement('option'); option.value = p.id; option.textContent = p.name; return option; }));
    profile.value = state.selected || '';
    const activeProfile = state.profiles.find(p => p.id === state.entries.find(e => e.id === state.activeId)?.connectionId) || state.profiles.find(p => p.id === state.selected);
    proxyMode.value = activeProfile?.proxyMode || 'inherit'; proxyMode.disabled = !activeProfile;
    proxyMode.options[0].textContent = `Global setting (${state.globalProxy ? 'proxy' : 'direct'})`;
    const active = state.entries.find(e => e.id === state.activeId);
    const title = active ? `${active.title} · ${activeProfile?.name || ''}` : activeProfile?.name || 'HAPI';
    document.getElementById('chat-title').textContent = title;
    const ids = new Set(state.entries.map(e => e.id));
    for (const [id, frame] of frames) if (!ids.has(id)) { frame.remove(); frames.delete(id); }
    for (const entry of state.entries) {
        let frame = frames.get(entry.id);
        if (!frame) {
            frame = document.createElement('iframe'); frame.title = entry.title;
            frame.allow = 'clipboard-read; clipboard-write; microphone; camera; fullscreen';
            frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox');
            frame.src = entry.url; frames.set(entry.id, frame); document.getElementById('frames').append(frame);
        }
        if (frame.dataset.reload !== String(entry.reload || 0)) { frame.dataset.reload = String(entry.reload || 0); if (entry.reload) frame.src = entry.url; }
        frame.hidden = entry.id !== state.activeId;
        frame.title = entry.title;
    }
    updateFont();
    document.getElementById('empty').hidden = state.entries.length > 0;
});
api.postMessage({ type: 'ready' });
