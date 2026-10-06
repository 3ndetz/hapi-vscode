'use strict';
const api = acquireVsCodeApi();
const frames = new Map(); const profile = document.getElementById('profile');
const conversation = document.getElementById('conversation');
const close = document.getElementById('close-chat');
document.addEventListener('click', event => { const action = event.target.closest('[data-action]')?.dataset.action; if (action) api.postMessage({ type: 'action', action }); });
profile.addEventListener('change', () => api.postMessage({ type: 'profile', id: profile.value }));
conversation.addEventListener('change', () => api.postMessage({ type: 'activate', id: conversation.value }));
close.addEventListener('click', () => api.postMessage({ type: 'close', id: conversation.value }));
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
    const ids = new Set(state.entries.map(e => e.id));
    for (const [id, frame] of frames) if (!ids.has(id)) { frame.remove(); frames.delete(id); }
    conversation.replaceChildren(...state.entries.map(entry => {
        let frame = frames.get(entry.id);
        if (!frame) {
            frame = document.createElement('iframe'); frame.title = entry.title;
            frame.allow = 'clipboard-read; clipboard-write; microphone; camera; fullscreen';
            frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox');
            frame.src = entry.url; frames.set(entry.id, frame); document.getElementById('frames').append(frame);
        }
        if (frame.dataset.reload !== String(entry.reload || 0)) { frame.dataset.reload = String(entry.reload || 0); if (entry.reload) frame.src = entry.url; }
        frame.hidden = entry.id !== state.activeId;
        const option = document.createElement('option'); option.value = entry.id;
        option.textContent = `${entry.title} · ${state.profiles.find(p => p.id === entry.connectionId)?.name || ''}`;
        return option;
    }));
    conversation.value = state.activeId || ''; conversation.disabled = close.disabled = state.entries.length === 0;
    document.getElementById('empty').hidden = state.entries.length > 0;
});
api.postMessage({ type: 'ready' });
