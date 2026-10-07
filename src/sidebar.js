'use strict';
const { randomBytes, randomUUID } = require('node:crypto');
const { websiteProxy } = require('./proxy');
const { webUrl } = require('./web');
const { title } = require('./messages');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
class Sidebar {
    constructor(manager) { this.manager = manager; this.entries = []; this.proxies = manager.websiteAdapters || new Map(); this.activeId = ''; }
    resolveWebviewView(view) {
        this.view = view;
        const vscode = this.manager.vscode;
        view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.manager.context.extensionUri, 'media')] };
        const nonce = randomBytes(24).toString('base64');
        const asset = name => escape(view.webview.asWebviewUri(vscode.Uri.joinPath(this.manager.context.extensionUri, 'media', name)).toString());
        view.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://127.0.0.1:*; style-src ${escape(view.webview.cspSource)}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${asset('sidebar.css')}"></head><body>
<header><button id="settings-toggle" title="Hub and proxy settings" aria-label="Hub and proxy settings" aria-expanded="false" aria-controls="settings"><span id="chat-title">HAPI</span><span aria-hidden="true">⚙</span></button></header>
<section id="settings" aria-label="Chat settings" hidden>
<div class="setting"><label for="profile">Hub</label><select id="profile" aria-label="Saved HAPI profile"></select></div>
<div class="setting"><label for="proxy-mode">Proxy</label><select id="proxy-mode" aria-label="Proxy mode for this hub" title="Saved for this hub. Applies to API and embedded website."><option value="inherit">Global setting</option><option value="proxy">Use VS Code proxy</option><option value="direct">Direct connection</option></select></div>
<div class="setting"><label for="font-scale">Font</label><select id="font-scale" aria-label="HAPI font size" title="Native HAPI font size, saved only for this website instance." disabled><option value="" disabled>HAPI setting</option><option value="0.8">80%</option><option value="0.9">90%</option><option value="1">100%</option><option value="1.1">110%</option><option value="1.2">120%</option></select></div>
<div class="actions">${['Open in', 'Move to', 'Copy to', 'New'].map((label, i) => `<details><summary>${label}</summary>${[['left', 'left tab'], ['window', 'new window'], ['tab', 'new tab']].map(([target, name]) => `<button data-operation="${['open', 'move', 'copy', 'new'][i]}" data-target="${target}">${i === 3 ? 'New chat in ' : ''}${name[0].toUpperCase() + name.slice(1)}</button>`).join('')}</details>`).join('')}<button data-action="externalBrowser">Open in browser</button></div>
</section>
<section id="empty"><h2>Your chats open here</h2><p>Choose a saved Hub above, or select a chat in HAPI Connections on the left.</p></section><main id="frames"></main><script nonce="${nonce}" src="${asset('sidebar.js')}"></script></body></html>`;
        view.webview.onDidReceiveMessage(message => { void this.receive(message).catch(error => vscode.window.showErrorMessage(error.message)); }, undefined, this.manager.context.subscriptions);
        view.onDidDispose(() => { this.view = undefined; }, undefined, this.manager.context.subscriptions);
        (view.onDidChangeVisibility || view.onDidChangeViewState).call(view, () => { if (view.visible) this.update(); }, undefined, this.manager.context.subscriptions);
        void this.restoreSaved().catch(() => {});
    }
    async receive(message) {
        const m = this.manager;
        if (message?.type === 'ready') return this.update();
        if (message?.type === 'externalLink') {
            const entry = this.entries.find(e => e.id === message.id);
            if (entry) return require('./external-browser').openExternalLink(m, entry, message.url);
            return;
        }
        if (message?.type === 'location') {
            const active = this.entries.find(e => e.id === this.activeId);
            return m.openAt(active, message.target, message.operation, this);
        }
        if (message?.type === 'proxy') {
            const id = this.entries.find(e => e.id === this.activeId)?.connectionId || m.connections.selected()?.id;
            if (id) await m.setConnectionProxy(id, message.mode);
            return;
        }
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
            entry.title = entry.sessionId === 'new' ? 'New chat' : entry.sessionId ? 'Chat' : m.connections.find(entry.connectionId).name;
            const local = new URL(entry.url); local.pathname = message.path; entry.url = local.href;
            this.save(); this.update(); await this.refreshTitle(entry); return;
        }
        if (message?.type === 'profile' && m.connections.find(message.id)) { await m.connections.select(message.id); m.updateSelection(); await m.openHub(message.id); }
        if (message?.type === 'activate' && this.entries.some(e => e.id === message.id)) { this.activeId = message.id; await m.connections.select(this.entries.find(e => e.id === message.id).connectionId); this.save(); m.updateSelection(); }
        if (message?.type === 'close') { this.release(this.entries.find(e => e.id === message.id)); this.entries = this.entries.filter(e => e.id !== message.id); if (this.activeId === message.id) this.activeId = this.entries.at(-1)?.id || ''; const active = this.entries.find(e => e.id === this.activeId); if (active) await m.connections.select(active.connectionId); this.save(); m.updateSelection(); }
        if (message?.type === 'action') {
            const active = this.entries.find(e => e.id === this.activeId);
            if (message.action === 'browser') { if (active) await require('./web').openWeb(m.vscode, m.connections.find(active.connectionId).url, active.sessionId); else await m.openBrowser(); }
            if (message.action === 'externalBrowser') await require('./external-browser').openExternalBrowser(m, active);
            if (message.action === 'newChat') await m.newChat();
            if (message.action === 'addConnection') await m.configure();
            if (message.action === 'openHub') await m.openHub();
            if (message.action === 'showChats') {
                if (active) { await m.connections.select(active.connectionId); m.updateSelection(); }
                await m.vscode.commands.executeCommand('hapiChat.sessions.focus');
            }
            if (message.action === 'reloadChat' && active) { active.reload = (active.reload || 0) + 1; this.update(); }
            if (message.action === 'openBeside') await m.openWindow(active);
            if (message.action === 'newWindow') await m.newWindow(active);
        }
    }
    async open(connectionId, sessionId, label, directory, savedInstanceId, restoring = false, savedAdapterId) {
        if (!restoring) await this.restoreSaved();
        const m = this.manager, connection = m.connections.find(connectionId);
        if (!connection) throw Error('This connection was removed.');
        const instanceId = sessionId === 'new' ? savedInstanceId || randomUUID() : undefined;
        const id = JSON.stringify([connectionId, sessionId || '', directory || '', ...(instanceId ? [instanceId] : [])]);
        const existing = this.entries.find(e => e.id === id);
        const adapterId = existing?.adapterId || savedAdapterId || randomUUID();
        // Each website opens two long-lived SSE streams. Sharing one HTTP/1
        // loopback origin exhausts Chromium's six connection slots and stalls POSTs.
        const key = JSON.stringify([connectionId, adapterId]);
        let promise = this.proxies.get(key);
        if (!promise) {
            const savedPort = m.context.globalState.get('sidebarProxyPorts', {})[key];
            const port = Number.isInteger(savedPort) && savedPort > 1023 && savedPort < 65536 ? savedPort : 0;
            promise = websiteProxy(m.connections.client(connectionId), port);
            this.proxies.set(key, promise); promise.catch(() => this.proxies.delete(key));
            void promise.then(proxy => m.context.globalState.update('sidebarProxyPorts', { ...m.context.globalState.get('sidebarProxyPorts', {}), [key]: proxy.port }), () => {}).catch(() => {});
        }
        const proxy = await promise;
        const remote = new URL(webUrl(connection.url, sessionId));
        if (directory) remote.searchParams.set('directory', directory);
        if (!this.entries.some(e => e.id === id)) this.entries.push({ id, connectionId, sessionId, directory, instanceId, adapterId, title: label && label !== sessionId ? label : sessionId === 'new' ? 'New chat' : sessionId ? 'Chat' : connection.name, url: proxy.loginUrl(remote.href) });
        else if (!existing && this.entries.find(e => e.id === id).adapterId !== adapterId) this.release({ connectionId, adapterId });
        this.activeId = id;
        this.save();
        await m.connections.select(connectionId); m.updateSelection();
        if (!restoring) await this.reveal();
        this.update();
        void this.refreshTitle(this.entries.find(e => e.id === id));
    }
    async refreshTitle(entry) {
        if (!entry?.sessionId || entry.sessionId === 'new') return;
        const sessionId = entry.sessionId;
        const request = entry.titleRequest = (entry.titleRequest || 0) + 1;
        try {
            const { session } = await this.manager.connections.client(entry.connectionId).session(sessionId);
            // Navigation and profile changes may overtake this read. Never apply
            // an old response to a different session or a closed website.
            if (!session || session.id !== sessionId || !this.entries.includes(entry) || entry.sessionId !== sessionId || entry.titleRequest !== request) return;
            const name = title({ metadata: session.metadata });
            const directory = session.metadata?.path;
            if (entry.title !== name || entry.workingDirectory !== directory) {
                entry.title = name; entry.workingDirectory = typeof directory === 'string' ? directory : undefined;
                this.save(); this.update();
            }
        } catch { /* The website remains usable if its metadata is unavailable. */ }
    }
    async adopt(entry) {
        await this.restoreSaved();
        await this.reveal();
        await this.manager.connections.select(entry.connectionId);
        const existing = this.entries.find(e => e.id === entry.id);
        if (existing) this.closeEntry(existing);
        this.entries.push({ ...entry }); this.activeId = entry.id;
        this.save(); this.manager.updateSelection();
    }
    closeEntry(entry, release = true) {
        if (!entry) return;
        if (release) this.release(entry);
        this.entries = this.entries.filter(e => e !== entry);
        if (this.activeId === entry.id) this.activeId = this.entries.at(-1)?.id || '';
        this.save(); this.update();
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
        void this.view.webview.postMessage({ type: 'state', profiles: m.connections.list(), selected: this.entries.find(e => e.id === this.activeId)?.connectionId || m.connections.selected()?.id, entries: this.entries, activeId: this.activeId,
            panel: !!this.panel, navigation: this.panel ? this.metadata() : undefined,
            globalProxy: m.vscode.workspace.getConfiguration('hapiChat').get('useVSCodeProxy', true),
            theme: [m.vscode.ColorThemeKind.Light, m.vscode.ColorThemeKind.HighContrastLight].includes(m.vscode.window.activeColorTheme.kind) ? 'light' : 'dark',
            syncTheme: m.vscode.workspace.getConfiguration('hapiChat').get('syncEditorTheme', true) });
    }
    save() {
        // Persist only navigation metadata, never the loopback login capability.
        void this.manager.context.globalState.update('sidebarTabs', { entries: this.entries.map(({ connectionId, sessionId, directory, instanceId, adapterId, title }) => ({ connectionId, sessionId, directory, instanceId, adapterId, title })), activeId: this.activeId, activeIndex: this.entries.findIndex(e => e.id === this.activeId) }).catch(error => this.manager.vscode.window.showErrorMessage(error.message));
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
            await this.open(entry.connectionId, entry.sessionId, typeof entry.title === 'string' ? entry.title : undefined, typeof entry.directory === 'string' ? entry.directory : undefined, typeof entry.instanceId === 'string' && /^[a-f0-9-]{36}$/i.test(entry.instanceId) ? entry.instanceId : undefined, true, typeof entry.adapterId === 'string' && /^[a-f0-9-]{36}$/i.test(entry.adapterId) ? entry.adapterId : undefined);
        }
        if (this.entries.some(e => e.id === state.activeId)) this.activeId = state.activeId;
        else if (Number.isInteger(state.activeIndex) && this.entries[state.activeIndex]) this.activeId = this.entries[state.activeIndex].id;
        const active = this.entries.find(e => e.id === this.activeId);
        if (active || selected) await this.manager.connections.select(active?.connectionId || selected);
        this.save(); this.manager.updateSelection();
    }
    remove(connectionId) {
        for (const [key, promise] of this.proxies) if (JSON.parse(key)[0] === connectionId) { promise.then(proxy => proxy.dispose(), () => {}); this.proxies.delete(key); }
        this.entries = this.entries.filter(e => e.connectionId !== connectionId);
        if (!this.entries.some(e => e.id === this.activeId)) this.activeId = this.entries.at(-1)?.id || '';
        this.save(); this.update();
    }
    release(entry) {
        if (!entry) return;
        const key = JSON.stringify([entry.connectionId, entry.adapterId]);
        this.proxies.get(key)?.then(proxy => proxy.dispose(), () => {}); this.proxies.delete(key);
    }
    dispose() { for (const proxy of this.proxies.values()) proxy.then(p => p.dispose(), () => {}); this.proxies.clear(); }
}
module.exports = { Sidebar };
