'use strict';
const { randomBytes, randomUUID } = require('node:crypto');
const { websiteProxy } = require('./proxy');
const { webUrl } = require('./web');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
class Sidebar {
    constructor(manager) { this.manager = manager; this.entries = []; this.proxies = manager.websiteAdapters || new Map(); this.activeId = ''; }
    resolveWebviewView(view) {
        this.view = view;
        const vscode = this.manager.vscode;
        view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.manager.context.extensionUri, 'media')] };
        const nonce = randomBytes(24).toString('base64');
        const asset = name => escape(view.webview.asWebviewUri(vscode.Uri.joinPath(this.manager.context.extensionUri, 'media', name)).toString());
        view.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://127.0.0.1:*; style-src ${escape(view.webview.cspSource)}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${asset('sidebar.css')}"></head><body><header><label for="profile">Hub</label><select id="profile" aria-label="Saved HAPI profile"></select><button data-action="newChat" title="New chat" aria-label="New chat">＋</button><button data-action="showChats" title="Connections and folders" aria-label="Connections and folders">☰</button><button data-action="browser" title="Open in integrated browser" aria-label="Open in integrated browser">↗</button></header><nav aria-label="Open HAPI chats"><label for="conversation">Chat</label><select id="conversation" aria-label="Open chat"></select><button id="close-chat" title="Close this chat" aria-label="Close this chat">×</button><button data-action="openBeside" title="Open this chat beside" aria-label="Open this chat beside">◫</button><button data-action="newWindow" title="New chat window beside" aria-label="New chat window beside">＋</button><button data-action="detach" title="Move chat into a separate window" aria-label="Move chat into a separate window">↗</button><button data-action="reloadChat" title="Reload this website" aria-label="Reload this website">↻</button></nav><section id="empty"><h2>Your chats open here</h2><p>Select a chat in HAPI Connections on the left, or start a new chat.</p><button data-action="showChats">Connections and folders</button><button data-action="newChat">New chat</button></section><main id="frames"></main><script nonce="${nonce}" src="${asset('sidebar.js')}"></script></body></html>`;
        view.webview.onDidReceiveMessage(message => { void this.receive(message).catch(error => vscode.window.showErrorMessage(error.message)); }, undefined, this.manager.context.subscriptions);
        view.onDidDispose(() => { this.view = undefined; }, undefined, this.manager.context.subscriptions);
        (view.onDidChangeVisibility || view.onDidChangeViewState).call(view, () => { if (view.visible) this.update(); }, undefined, this.manager.context.subscriptions);
        void this.restoreSaved().catch(() => {});
    }
    async receive(message) {
        const m = this.manager;
        if (message?.type === 'ready') return this.update();
        if (message?.type === 'navigate') {
            const entry = this.entries.find(e => e.id === message.id);
            if (!entry || typeof message.path !== 'string') return;
            const base = new URL(m.connections.find(entry.connectionId).url);
            const previous = entry.sessionId;
            const suffix = message.path.startsWith(base.pathname) ? message.path.slice(base.pathname.length) : undefined;
            if (suffix === '') entry.sessionId = undefined;
            else if (/^sessions\/[^/?#]+\/?$/.test(suffix || '')) {
                try { entry.sessionId = decodeURIComponent(suffix.split('/')[1]); } catch { return; }
            } else return;
            if (previous === entry.sessionId) return;
            if (entry.sessionId && entry.sessionId !== 'new') entry.title = entry.sessionId;
            const local = new URL(entry.url); local.pathname = message.path; entry.url = local.href;
            this.save(); this.update(); return;
        }
        if (message?.type === 'profile' && m.connections.find(message.id)) { await m.connections.select(message.id); m.updateSelection(); await m.openHub(message.id); }
        if (message?.type === 'activate' && this.entries.some(e => e.id === message.id)) { this.activeId = message.id; await m.connections.select(this.entries.find(e => e.id === message.id).connectionId); this.save(); m.updateSelection(); }
        if (message?.type === 'close') { this.entries = this.entries.filter(e => e.id !== message.id); if (this.activeId === message.id) this.activeId = this.entries.at(-1)?.id || ''; const active = this.entries.find(e => e.id === this.activeId); if (active) await m.connections.select(active.connectionId); this.save(); m.updateSelection(); }
        if (message?.type === 'action') {
            const active = this.entries.find(e => e.id === this.activeId);
            if (message.action === 'browser') { if (active) await require('./web').openWeb(m.vscode, m.connections.find(active.connectionId).url, active.sessionId); else await m.openBrowser(); }
            if (message.action === 'newChat') await m.newChat();
            if (message.action === 'addConnection') await m.configure();
            if (message.action === 'openHub') await m.openHub();
            if (message.action === 'showChats') await m.vscode.commands.executeCommand('hapiChat.sessions.focus');
            if (message.action === 'reloadChat' && active) { active.reload = (active.reload || 0) + 1; this.update(); }
            if (message.action === 'openBeside') await m.openWindow(active);
            if (message.action === 'newWindow') await m.newWindow(active);
        }
    }
    async open(connectionId, sessionId, label, directory, savedInstanceId, restoring = false) {
        if (!restoring) await this.restoreSaved();
        const m = this.manager, connection = m.connections.find(connectionId);
        if (!connection) throw Error('This connection was removed.');
        let promise = this.proxies.get(connectionId);
        if (!promise) {
            const savedPort = m.context.globalState.get('sidebarProxyPorts', {})[connectionId];
            const port = Number.isInteger(savedPort) && savedPort > 1023 && savedPort < 65536 ? savedPort : 0;
            promise = websiteProxy(m.connections.client(connectionId), port);
            this.proxies.set(connectionId, promise); promise.catch(() => this.proxies.delete(connectionId));
            void promise.then(proxy => m.context.globalState.update('sidebarProxyPorts', { ...m.context.globalState.get('sidebarProxyPorts', {}), [connectionId]: proxy.port }), () => {}).catch(() => {});
        }
        const proxy = await promise;
        const remote = new URL(webUrl(connection.url, sessionId));
        if (directory) remote.searchParams.set('directory', directory);
        const instanceId = sessionId === 'new' ? savedInstanceId || randomUUID() : undefined;
        const id = JSON.stringify([connectionId, sessionId || '', directory || '', ...(instanceId ? [instanceId] : [])]);
        if (!this.entries.some(e => e.id === id)) this.entries.push({ id, connectionId, sessionId, directory, instanceId, title: label || (sessionId === 'new' ? 'New chat' : connection.name), url: proxy.loginUrl(remote.href) });
        this.activeId = id;
        this.save();
        await m.connections.select(connectionId); m.updateSelection();
        if (!restoring) await this.reveal();
        this.update();
    }
    async reveal() {
        // A resolved view can reveal itself, including after being moved or hidden.
        if (!this.view) {
            const commands = await this.manager.vscode.commands.getCommands(true);
            const command = ['hapiChat.conversation.focus', 'hapiChat.conversation.open', 'workbench.view.extension.hapiChatConversations'].find(id => commands.includes(id));
            const unavailable = () => new Error('The HAPI Chat sidebar is not available in this window. Run Developer: Reload Window to load the installed extension, then open HAPI Chat again.');
            if (!command) throw unavailable();
            await this.manager.vscode.commands.executeCommand(command);
            // Workbench commands can finish before the extension host receives the view.
            for (let n = 0; !this.view && n < 100; n++) await new Promise(resolve => setTimeout(resolve, 50));
            if (!this.view) throw unavailable();
        }
        this.view.show(false);
    }
    update() {
        if (!this.view) return;
        const m = this.manager;
        void this.view.webview.postMessage({ type: 'state', profiles: m.connections.list(), selected: this.panel ? this.entries[0]?.connectionId : m.connections.selected()?.id, entries: this.entries, activeId: this.activeId,
            panel: !!this.panel, navigation: this.panel ? this.metadata() : undefined,
            theme: [m.vscode.ColorThemeKind.Light, m.vscode.ColorThemeKind.HighContrastLight].includes(m.vscode.window.activeColorTheme.kind) ? 'light' : 'dark',
            syncTheme: m.vscode.workspace.getConfiguration('hapiChat').get('syncEditorTheme', true) });
    }
    save() {
        // Persist only navigation metadata, never the loopback login capability.
        void this.manager.context.globalState.update('sidebarTabs', { entries: this.entries.map(({ connectionId, sessionId, directory, instanceId, title }) => ({ connectionId, sessionId, directory, instanceId, title })), activeId: this.activeId, activeIndex: this.entries.findIndex(e => e.id === this.activeId) });
    }
    restoreSaved() {
        if (!this.restored) {
            this.restored = true;
            this.restoring = this.restore().finally(() => { this.restoring = undefined; });
        }
        return this.restoring || Promise.resolve();
    }
    async restore() {
        const state = this.manager.context.globalState.get('sidebarTabs');
        if (!Array.isArray(state?.entries)) return;
        const selected = this.manager.connections.selected()?.id;
        for (const entry of state.entries) {
            if (!this.manager.connections.find(entry.connectionId) || entry.sessionId !== undefined && typeof entry.sessionId !== 'string') continue;
            await this.open(entry.connectionId, entry.sessionId, typeof entry.title === 'string' ? entry.title : undefined, typeof entry.directory === 'string' ? entry.directory : undefined, typeof entry.instanceId === 'string' && /^[a-f0-9-]{36}$/i.test(entry.instanceId) ? entry.instanceId : undefined, true);
        }
        if (this.entries.some(e => e.id === state.activeId)) this.activeId = state.activeId;
        else if (Number.isInteger(state.activeIndex) && this.entries[state.activeIndex]) this.activeId = this.entries[state.activeIndex].id;
        const active = this.entries.find(e => e.id === this.activeId);
        if (active || selected) await this.manager.connections.select(active?.connectionId || selected);
        this.save(); this.manager.updateSelection();
    }
    remove(connectionId) {
        this.entries = this.entries.filter(e => e.connectionId !== connectionId);
        if (!this.entries.some(e => e.id === this.activeId)) this.activeId = this.entries.at(-1)?.id || '';
        this.proxies.get(connectionId)?.then(proxy => proxy.dispose(), () => {}); this.proxies.delete(connectionId); this.save(); this.update();
    }
    dispose() { for (const proxy of this.proxies.values()) proxy.then(p => p.dispose(), () => {}); this.proxies.clear(); }
}
module.exports = { Sidebar };
