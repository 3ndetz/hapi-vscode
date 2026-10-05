'use strict';
const api = acquireVsCodeApi();
const frames = new Map(); const profile = document.getElementById('profile');
document.addEventListener('click', event => { const action = event.target.closest('[data-action]')?.dataset.action; if (action) api.postMessage({ type: 'action', action }); });
profile.addEventListener('change', () => api.postMessage({ type: 'profile', id: profile.value }));
window.addEventListener('message', event => {
    if (event.source && event.source !== window || event.data?.type !== 'state') return;
    const state = event.data;
    document.documentElement.style.colorScheme = state.syncTheme ? state.theme : 'normal';
    profile.replaceChildren(...state.profiles.map(p => { const option = document.createElement('option'); option.value = p.id; option.textContent = p.name; return option; }));
    profile.value = state.selected || '';
    const ids = new Set(state.entries.map(e => e.id));
    for (const [id, frame] of frames) if (!ids.has(id)) { frame.remove(); frames.delete(id); }
    document.getElementById('tabs').replaceChildren(...state.entries.map(entry => {
        let frame = frames.get(entry.id);
        if (!frame) {
            frame = document.createElement('iframe'); frame.title = entry.title;
            frame.allow = 'clipboard-read; clipboard-write; microphone; camera; fullscreen';
            frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox');
            frame.src = entry.url; frames.set(entry.id, frame); document.getElementById('frames').append(frame);
        }
        frame.hidden = entry.id !== state.activeId;
        const tab = document.createElement('div'); tab.className = `tab${entry.id === state.activeId ? ' active' : ''}`;
        const button = document.createElement('button'); button.textContent = entry.title; button.title = `${state.profiles.find(p => p.id === entry.connectionId)?.name || ''}: ${entry.title}`;
        button.onclick = () => api.postMessage({ type: 'activate', id: entry.id });
        const close = document.createElement('button'); close.textContent = '×'; close.setAttribute('aria-label', `Close ${entry.title}`); close.onclick = () => api.postMessage({ type: 'close', id: entry.id });
        tab.append(button, close); return tab;
    }));
    document.getElementById('empty').hidden = state.entries.length > 0;
});
api.postMessage({ type: 'ready' });
