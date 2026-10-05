'use strict';
(() => {
    const vscode = acquireVsCodeApi();
    const $ = id => document.getElementById(id);
    const draft = $('draft');
    let state = vscode.getState() || {};
    let initialized = false;
    const nodes = new Map();
    const send = message => vscode.postMessage(message);
    const clearError = () => { $('error').hidden = true; };
    function persist() { vscode.setState({ connectionId: state.connectionId, sessionId: state.sessionId, draft: draft.value }); }
    function action(type) { clearError(); send({ type }); }
    document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => action(button.dataset.action)));
    $('older').addEventListener('click', () => action('older'));
    draft.value = state.draft || '';
    draft.addEventListener('input', () => { persist(); send({ type: 'draft', text: draft.value }); });
    draft.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('composer').requestSubmit(); }
    });
    $('composer').addEventListener('submit', e => {
        e.preventDefault();
        if (!draft.value.trim() || state.busy || !state.active || state.controlled) return;
        clearError(); send({ type: 'send', text: draft.value });
    });
    function node(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }
    function renderRows(rows) {
        const container = $('messages');
        const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 90;
        const scrollHeight = container.scrollHeight;
        const scrollTop = container.scrollTop;
        const fragment = document.createDocumentFragment();
        const keep = new Set();
        for (const row of rows) {
            keep.add(row.id);
            let entry = nodes.get(row.id);
            if (!entry) {
                const element = node('article', `message ${row.role}`);
                const label = node('div', 'label');
                const expandable = row.kind !== 'text' && row.role !== 'user';
                const details = expandable ? node('details', 'details') : node('div', 'body');
                const summary = expandable ? node('summary', '', row.kind) : undefined;
                const body = node('pre', 'text');
                if (summary) details.append(summary);
                details.append(body); element.append(label, details);
                entry = { element, label, body }; nodes.set(row.id, entry);
            }
            entry.label.textContent = row.role === 'user'
                ? `You${row.deliveryState === 'indeterminate' ? ' · delivery unknown, check hub' : row.invokedAt === null ? ' · queued' : ''}`
                : 'Agent';
            // Never interpret agent content as HTML, commands or external resource URLs.
            if (entry.body.textContent !== row.text) entry.body.textContent = row.text;
            fragment.append(entry.element);
        }
        $('rows').replaceChildren(fragment);
        for (const id of nodes.keys()) if (!keep.has(id)) nodes.delete(id);
        if (atBottom) container.scrollTop = container.scrollHeight;
        else container.scrollTop = scrollTop + Math.max(0, container.scrollHeight - scrollHeight);
    }
    function renderRequests(requests) {
        const fragment = document.createDocumentFragment();
        for (const [id, request] of Object.entries(requests)) {
            const card = node('div', 'request');
            card.append(node('strong', '', `Agent needs input · ${request.tool}`));
            const details = node('details', 'details');
            details.append(node('summary', '', 'Request details'), node('pre', 'text', JSON.stringify(request.arguments, null, 2)));
            card.append(details);
            const asks = ['AskUserQuestion', 'request_user_input'].some(name => request.tool?.includes(name));
            for (const [label, decision] of asks ? [['Answer questions', 'answer'], ['Deny', 'deny']] : [['Approve once', 'approve'], ['Deny', 'deny']]) {
                const button = node('button', '', label); button.disabled = state.busy;
                button.addEventListener('click', () => { clearError(); send({ type: 'permission', id, action: decision }); });
                card.append(button);
            }
            fragment.append(card);
        }
        $('permissions').replaceChildren(fragment);
    }
    window.addEventListener('message', event => {
        const message = event.data;
        if (message.type === 'error') { $('error').textContent = message.text; $('error').hidden = false; return; }
        if (message.type === 'sent') { draft.value = ''; persist(); return; }
        if (message.type !== 'state') return;
        state = message;
        if (!initialized) { draft.value = state.draft || draft.value; initialized = true; }
        persist();
        $('title').textContent = state.title || 'HAPI Chat';
        $('connection').textContent = `${state.connection || ''} · ${state.url || ''}`;
        $('status').textContent = `${state.active ? (state.thinking ? 'Working' : 'Online') : 'Offline'} · ${state.live ? 'Live' : 'Reconnecting'}`;
        $('status').className = state.active ? 'online' : 'muted';
        $('notice').textContent = `${state.path || ''}${state.controlled ? ' · Controlled by a terminal. Take remote control to send.' : ''}`;
        $('resume').hidden = state.active;
        $('takeover').hidden = !state.controlled || !state.active;
        $('stop').hidden = !state.thinking || !state.active;
        $('older').hidden = !state.hasMore;
        $('older').disabled = state.busy;
        $('send').disabled = state.busy || !state.active || state.controlled;
        draft.disabled = state.busy;
        $('send-status').textContent = state.busy ? 'Sending request…' : !state.active ? 'Resume to continue this chat.' : '';
        renderRows(state.rows || []); renderRequests(state.requests || {});
    });
    send({ type: 'ready' });
})();
