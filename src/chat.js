'use strict';
const { randomUUID } = require('node:crypto');
const { MessageWindow } = require('./window');
const { decodeMessage, title } = require('./messages');
const { chatHtml } = require('./html');

class Chat {
    constructor(manager, connectionId, sessionId, panel, draft = '') {
        this.manager = manager; this.connectionId = connectionId; this.sessionId = sessionId; this.panel = panel;
        this.window = new MessageWindow(); this.closed = false; this.live = false; this.busy = false; this.draft = draft;
        this.disposables = [];
        const { vscode, context } = manager;
        panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');
        panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] };
        panel.webview.html = chatHtml(vscode, panel.webview, context.extensionUri);
        this.disposables.push(panel.webview.onDidReceiveMessage(message => void this.receive(message).catch(error => this.error(error))));
        this.disposables.push(panel.onDidDispose(() => this.dispose()));
        this.poll = setInterval(() => void this.refresh(), 15_000);
        this.startStream();
    }
    client() { return this.manager.connections.client(this.connectionId); }
    startStream() {
        this.subscription?.dispose();
        try {
            this.subscription = this.client().subscribe(this.sessionId, event => this.event(event), live => { this.live = live; this.render(); });
        } catch (error) { this.error(error); }
    }
    event(event) {
        if (this.closed) return;
        if (event.sessionId && event.sessionId !== this.sessionId) return;
        if (event.type === 'message-received' && event.message) { this.window.ingest([event.message]); this.render(); return; }
        if (event.type === 'messages-consumed') { this.window.consumed(event.localIds || [], event.invokedAt); this.render(); }
        if (event.type === 'message-cancelled') { this.window.cancelled(event.messageId, event.localId); this.render(); }
        if (event.type === 'messages-indeterminate') {
            const ids = new Set(event.localIds || []);
            this.window.ingest(this.window.messages.filter(m => ids.has(m.localId)).map(m => ({ ...m, deliveryState: 'indeterminate' })));
            this.render();
        }
        if (event.type === 'messages-invalidated') this.window = new MessageWindow();
        if (event.type === 'connection-changed' || event.type.startsWith('session-') || event.type.startsWith('messages-') || event.type === 'message-cancelled') this.schedule();
    }
    schedule() {
        if (!this.refreshTimer) this.refreshTimer = setTimeout(() => { this.refreshTimer = undefined; void this.refresh(); }, 300);
    }
    async refresh() {
        if (this.closed) return;
        if (this.refreshing) { this.trailing = true; return this.refreshing; }
        const id = this.sessionId;
        const window = this.window;
        this.refreshing = (async () => {
            try {
                const result = await this.client().session(id);
                if (this.closed || id !== this.sessionId) return;
                this.session = result.session;
                await window.sync(this.client(), id);
                if (id !== this.sessionId || window !== this.window) { this.trailing = true; return; }
                this.render();
            } catch (error) { this.error(error); }
        })().finally(() => {
            this.refreshing = undefined;
            if (this.trailing) { this.trailing = false; this.schedule(); }
        });
        return this.refreshing;
    }
    render() {
        if (this.closed) return;
        const connection = this.manager.connections.find(this.connectionId);
        const session = this.session;
        this.panel.title = `${connection?.name || 'HAPI'} · ${title(session).slice(0, 70)}`;
        const rows = this.window.messages.flatMap(decodeMessage);
        // Replace streamed snapshots by their stream identity, preserving ordinary chat rows.
        const latest = new Map();
        for (let i = 0; i < rows.length; i++) if (rows[i].streamId) latest.set(rows[i].streamId, i);
        void this.panel.webview.postMessage({ type: 'state', connectionId: this.connectionId, sessionId: this.sessionId,
            connection: connection?.name, url: connection?.url, title: title(session), path: session?.metadata?.path,
            active: !!session?.active, thinking: !!session?.thinking, live: this.live, busy: this.busy,
            controlled: !session?.metadata?.capabilities?.concurrentClients && !!session?.agentState?.controlledByUser,
            requests: session?.agentState?.requests || {},
            rows: rows.filter((row, index) => !row.streamId || latest.get(row.streamId) === index), hasMore: this.window.hasMore,
            draft: this.draft });
    }
    error(error) { if (!this.closed) void this.panel.webview.postMessage({ type: 'error', text: error.message || 'HAPI request failed.' }); }
    async migrate(id) {
        if (!id || id === this.sessionId) return;
        if (this.manager.chats.some(chat => chat !== this && chat.connectionId === this.connectionId && chat.sessionId === id)) {
            throw new Error('The resumed session is already open in another tab. Use that chat to send this draft.');
        }
        this.subscription?.dispose(); this.sessionId = id; this.window = new MessageWindow(); this.session = undefined;
        this.startStream();
    }
    async receive(message) {
        if (this.closed || !message || typeof message.type !== 'string') return;
        if (message.type === 'ready') { this.ready = true; this.render(); await this.refresh(); return; }
        if (message.type === 'draft') { if (typeof message.text === 'string') this.draft = message.text; return; }
        if (message.type === 'newChat') { await this.manager.newChat(this.connectionId); return; }
        if (message.type === 'openChat') { await this.manager.pickChat(this.connectionId); return; }
        if (message.type === 'switchConnection') { await this.manager.selectConnection(); return; }
        if (this.busy) return;
        this.busy = true; this.render();
        try {
            if (message.type === 'send' && typeof message.text === 'string' && message.text.trim()) {
                if (!this.session?.active) throw new Error('Resume this session before sending a message.');
                if (!this.session?.metadata?.capabilities?.concurrentClients && this.session?.agentState?.controlledByUser) throw new Error('Take remote control before sending to this terminal-controlled session.');
                const localId = this.pendingSend?.text === message.text && this.pendingSend?.sessionId === this.sessionId ? this.pendingSend.localId : randomUUID();
                this.pendingSend = { text: message.text, sessionId: this.sessionId, localId };
                await this.client().send(this.sessionId, message.text, localId);
                if (!this.window.messages.some(m => m.localId === localId)) {
                    this.window.ingest([{ id: localId, localId, seq: null, createdAt: Date.now(), invokedAt: null,
                        content: { role: 'user', content: { type: 'text', text: message.text } } }]);
                }
                this.pendingSend = undefined;
                this.draft = '';
                void this.panel.webview.postMessage({ type: 'sent' });
                this.schedule();
            } else if (message.type === 'refresh') { await this.refresh(); }
            else if (message.type === 'older') { await this.window.older(this.client(), this.sessionId); }
            else if (message.type === 'resume') {
                const response = this.session?.metadata?.lifecycleState === 'archived'
                    ? await this.client().action(this.sessionId, 'reopen') : await this.client().action(this.sessionId, 'resume');
                await this.migrate(response.sessionId);
                await this.refresh();
            } else if (message.type === 'takeover') { await this.client().action(this.sessionId, 'switch'); await this.refresh(); }
            else if (message.type === 'stop') { await this.client().action(this.sessionId, 'abort'); }
            else if (message.type === 'permission' && typeof message.id === 'string' && ['approve', 'deny', 'answer'].includes(message.action)) {
                const request = this.session?.agentState?.requests?.[message.id];
                if (!request) throw new Error('This request is no longer pending. Refresh the chat.');
                const body = message.action === 'answer' ? await this.manager.answer(request) : {};
                if (body !== undefined) await this.client().permission(this.sessionId, message.id, message.action !== 'deny', body);
                await this.refresh();
            } else if (message.type === 'openBrowser') {
                const connection = this.manager.connections.find(this.connectionId);
                if (connection) await this.manager.vscode.env.openExternal(this.manager.vscode.Uri.parse(new URL(`sessions/${encodeURIComponent(this.sessionId)}`, connection.url).href));
            }
        } catch (error) { this.error(error); }
        finally { this.busy = false; this.render(); }
    }
    dispose() {
        if (this.closed) return;
        this.closed = true; clearInterval(this.poll); clearTimeout(this.refreshTimer); this.subscription?.dispose();
        for (const disposable of this.disposables) disposable.dispose();
        this.manager.chats = this.manager.chats.filter(chat => chat !== this);
    }
}
module.exports = { Chat };
