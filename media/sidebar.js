'use strict';
const api = acquireVsCodeApi();
const frames = new Map(); const profile = document.getElementById('profile');
const close = document.getElementById('close-chat');
const settings = document.getElementById('settings'), toggle = document.getElementById('settings-toggle');
const zoom = document.getElementById('web-zoom');
let activeId = '';
const showSettings = open => { settings.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); };
toggle.addEventListener('click', () => showSettings(settings.hidden));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !settings.hidden) { showSettings(false); toggle.focus(); } });
document.addEventListener('pointerdown', event => { if (!settings.contains(event.target) && !toggle.contains(event.target)) showSettings(false); });
// Pointer events inside a cross-origin website do not bubble into its parent.
window.addEventListener('blur', () => { if (document.activeElement?.tagName === 'IFRAME') showSettings(false); });
zoom.addEventListener('change', () => api.postMessage({ type: 'zoom', value: Number(zoom.value) }));
const proxyMode = document.getElementById('proxy-mode');
proxyMode.addEventListener('change', () => api.postMessage({ type: 'proxy', mode: proxyMode.value }));
document.addEventListener('click', event => { const action = event.target.closest('[data-action]')?.dataset.action; if (action) { showSettings(false); api.postMessage({ type: 'action', action }); } });
profile.addEventListener('change', () => api.postMessage({ type: 'profile', id: profile.value }));
close.addEventListener('click', () => { showSettings(false); api.postMessage({ type: 'close', id: activeId }); });
window.addEventListener('message', event => {
    if (event.data?.type === 'hapi-navigation') {
        for (const [id, frame] of frames) if (event.source === frame.contentWindow && event.origin === new URL(frame.src).origin) {
            if (typeof event.data.path === 'string') api.postMessage({ type: 'navigate', id, path: event.data.path });
            return;
        }
        return;
    }
    // VS Code forwards messages from its preload window, whose WindowProxy
    // differs between runtimes. Trust the webview origin, never a hub iframe.
    if (event.origin !== window.origin || event.data?.type !== 'state') return;
    const state = event.data;
    activeId = state.activeId || '';
    if (state.panel && state.navigation) api.setState(state.navigation);
    document.body.classList.toggle('panel', !!state.panel);
    document.documentElement.style.colorScheme = state.syncTheme ? state.theme : 'normal';
    profile.replaceChildren(...state.profiles.map(p => { const option = document.createElement('option'); option.value = p.id; option.textContent = p.name; return option; }));
    profile.value = state.selected || '';
    const activeProfile = state.profiles.find(p => p.id === state.entries.find(e => e.id === state.activeId)?.connectionId) || state.profiles.find(p => p.id === state.selected);
    proxyMode.value = activeProfile?.proxyMode || 'inherit'; proxyMode.disabled = !activeProfile;
    proxyMode.options[0].textContent = `Global setting (${state.globalProxy ? 'proxy' : 'direct'})`;
    const percent = Number.isFinite(state.webZoom) && state.webZoom >= 50 && state.webZoom <= 200 ? state.webZoom : 70;
    for (const option of zoom.querySelectorAll('[data-custom]')) option.remove();
    if (![...zoom.options].some(option => Number(option.value) === percent)) {
        const option = document.createElement('option'); option.value = String(percent); option.textContent = `${percent}%`; option.dataset.custom = 'true'; zoom.append(option);
    }
    zoom.value = String(percent);
    const active = state.entries.find(e => e.id === activeId);
    const title = active ? `${active.title} · ${activeProfile?.name || ''}` : activeProfile?.name || 'Choose chat';
    document.getElementById('chat-title').textContent = title;
    document.getElementById('choose-chat').title = `${title} — Choose a chat in Connections and Folders`;
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
        // Resize the native viewport before scaling it; menus, scroll and pointer
        // coordinates stay native. Updating scale never reloads the website.
        frame.style.width = frame.style.height = `${10000 / percent}%`;
        frame.style.transform = `scale(${percent / 100})`;
    }
    close.disabled = !active;
    document.getElementById('empty').hidden = state.entries.length > 0;
});
api.postMessage({ type: 'ready' });
