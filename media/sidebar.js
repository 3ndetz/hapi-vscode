'use strict';
const api = acquireVsCodeApi();
const frames = new Map(); const profile = document.getElementById('profile');
const settings = document.getElementById('settings'), toggle = document.getElementById('settings-toggle');
const showSettings = open => { settings.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); };
toggle.addEventListener('click', () => showSettings(settings.hidden));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !settings.hidden) { showSettings(false); toggle.focus(); } });
document.addEventListener('pointerdown', event => { if (!settings.contains(event.target) && !toggle.contains(event.target)) showSettings(false); });
// Pointer events inside a cross-origin website do not bubble into its parent.
window.addEventListener('blur', () => { if (document.activeElement?.tagName === 'IFRAME') showSettings(false); });
const proxyMode = document.getElementById('proxy-mode');
proxyMode.addEventListener('change', () => api.postMessage({ type: 'proxy', mode: proxyMode.value }));
profile.addEventListener('change', () => api.postMessage({ type: 'profile', id: profile.value }));
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
    document.getElementById('empty').hidden = state.entries.length > 0;
});
api.postMessage({ type: 'ready' });
