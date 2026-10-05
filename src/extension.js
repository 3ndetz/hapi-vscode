'use strict';
const vscode = require('vscode');
const { Connections } = require('./connections');
const { Chat } = require('./chat');
const { normalizeUrl } = require('./client');
const { title } = require('./messages');
const { chatMode, openWeb } = require('./web');
const { Sidebar } = require('./sidebar');
const { groupSessions } = require('./folders');

class Manager {
    constructor(context) {
        this.context = context; this.vscode = vscode; this.connections = new Connections(context); this.chats = [];
        this.sidebar = new Sidebar(this);
        context.subscriptions.push(this.sidebar, vscode.window.registerWebviewViewProvider('hapiChat.web', this.sidebar, { webviewOptions: { retainContextWhenHidden: true } }));
        this.changed = new vscode.EventEmitter(); this.onDidChangeTreeData = this.changed.event;
        this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
        this.status.command = 'hapiChat.selectConnection'; context.subscriptions.push(this.status, this.changed, this.connections);
        context.subscriptions.push(vscode.window.registerTreeDataProvider('hapiChat.sessions', this));
        const commands = {
            addConnection: () => this.configure(),
            selectConnection: () => this.selectConnection(),
            editConnection: async item => { const id = item?.connectionId || (await this.pickConnection())?.id; if (id) return this.configure(id); },
            removeConnection: item => this.remove(item?.connectionId),
            openChat: item => item?.sessionId ? this.open(item.connectionId, item.sessionId, item.label) : this.pickChat(),
            newChat: item => this.newChat(item?.connectionId, item?.directory),
            refresh: () => this.changed.fire(undefined),
            changeChatMode: () => this.changeChatMode(),
            openHub: item => this.openHub(item?.connectionId),
            openBrowser: () => this.openBrowser(),
            showChats: () => vscode.commands.executeCommand('hapiChat.sessions.focus'),
            copyLoginToken: item => this.copyLoginToken(item?.connectionId)
        };
        for (const [name, handler] of Object.entries(commands)) {
            context.subscriptions.push(vscode.commands.registerCommand(`hapiChat.${name}`, async (...args) => {
                try { return await handler(...args); } catch (error) { void vscode.window.showErrorMessage(error.message); }
            }));
        }
        context.subscriptions.push(vscode.window.registerWebviewPanelSerializer('hapiChat.chat', {
            deserializeWebviewPanel: async (panel, state) => {
                if (typeof state?.connectionId === 'string' && typeof state?.sessionId === 'string' && this.connections.find(state.connectionId)) {
                    this.attach(panel, state.connectionId, state.sessionId, typeof state.draft === 'string' ? state.draft : '');
                } else { panel.dispose(); }
            }
        }));
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('hapiChat')) this.updateSelection();
        }));
        context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(() => this.sidebar.update()));
        context.subscriptions.push({ dispose: () => { for (const chat of [...this.chats]) { chat.dispose(); chat.panel.dispose(); } } });
        this.updateSelection();
    }
    updateSelection() {
        const selected = this.connections.selected();
        this.status.text = `$(comment-discussion) HAPI${selected ? `: ${selected.name}` : ''} (${chatMode(vscode) === 'web' ? 'Web' : 'Custom'})`;
        this.status.tooltip = selected?.url || 'Add a HAPI connection'; this.status.show();
        void vscode.commands.executeCommand('setContext', 'hapiChat.hasConnections', this.connections.list().length > 0);
        this.changed.fire(undefined);
        this.sidebar.update();
    }
    async pickConnection() {
        const connections = this.connections.list();
        if (!connections.length) return this.configure();
        const selected = await vscode.window.showQuickPick(connections.map(c => ({ label: c.name, description: c.url, connection: c })), { title: 'HAPI connection' });
        return selected?.connection;
    }
    async selectConnection() {
        const selected = await this.pickConnection();
        if (selected) { await this.connections.select(selected.id); this.updateSelection(); if (chatMode(vscode) === 'web' && vscode.workspace.getConfiguration('hapiChat').get('webLocation', 'sidebar') === 'sidebar') await this.openHub(selected.id); }
        return selected;
    }
    async changeChatMode() {
        const selected = await vscode.window.showQuickPick([
            { label: 'Web', description: 'Full HAPI website in VS Code (default)', mode: 'web' },
            { label: 'Custom', description: 'Minimal API chat interface', mode: 'custom' }
        ], { title: 'HAPI chat interface' });
        if (selected) await vscode.workspace.getConfiguration('hapiChat').update('chatMode', selected.mode, vscode.ConfigurationTarget.Global);
    }
    async openHub(id) {
        const connection = id ? this.connections.find(id) : this.connections.selected() || await this.pickConnection();
        if (connection) await this.sidebar.open(connection.id);
    }
    async openBrowser() {
        const connection = this.connections.selected() || await this.pickConnection();
        if (connection) await openWeb(vscode, connection.url);
    }
    async copyLoginToken(id) {
        const connection = id ? this.connections.find(id) : await this.pickConnection();
        if (!connection) return;
        const token = await this.context.secrets.get(this.connections.secretKey(connection.id));
        if (!token) throw new Error('No saved token. Edit this connection to enter it.');
        await vscode.env.clipboard.writeText(token);
        const timer = setTimeout(() => { void (async () => {
            // Preserve anything the user copied after our token.
            if (await vscode.env.clipboard.readText() === token) await vscode.env.clipboard.writeText('');
        })().catch(() => {}); }, 60_000);
        this.context.subscriptions.push({ dispose: () => clearTimeout(timer) });
        void vscode.window.showInformationMessage(`Login token for ${connection.name} copied. Paste it into that hub's login form. Clipboard clears after one minute if unchanged.`);
    }
    async configure(id) {
        const old = id ? this.connections.find(id) : undefined;
        const name = await vscode.window.showInputBox({ title: 'HAPI connection name', value: old?.name || '', prompt: 'A name for this hub or machine', validateInput: v => v.trim() ? undefined : 'Enter a name.' });
        if (name === undefined) return;
        const url = await vscode.window.showInputBox({ title: 'HAPI hub URL', value: old?.url || 'http://localhost:3006/', prompt: 'Include the full path when HAPI is served under a prefix.', validateInput: v => { try { normalizeUrl(v); } catch (error) { return error.message; } } });
        if (url === undefined) return;
        const changedUrl = old && normalizeUrl(url) !== old.url;
        const token = await vscode.window.showInputBox({ title: 'HAPI access token', password: true, ignoreFocusOut: true,
            prompt: old && !changedUrl ? 'Leave empty to keep the saved token.' : 'Stored in VS Code SecretStorage. Use the hub login token.',
            validateInput: v => old && !changedUrl || v.trim() ? undefined : 'Enter a token for this hub.' });
        if (token === undefined) return;
        // An edited endpoint must not keep sending the previous hub's credential.
        const connection = await this.connections.save({ id: old?.id, name, url }, token.trim() || undefined);
        this.sidebar.remove(connection.id);
        for (const chat of [...this.chats]) if (chat.connectionId === connection.id) chat.panel.dispose();
        await this.connections.select(connection.id); this.updateSelection();
        try {
            await this.connections.client(connection.id).authenticate(); void vscode.window.showInformationMessage(`Connected to ${connection.name}.`);
            if (chatMode(vscode) === 'web' && vscode.workspace.getConfiguration('hapiChat').get('webLocation', 'sidebar') === 'sidebar') await this.openHub(connection.id);
        }
        catch (error) { void vscode.window.showErrorMessage(`${connection.name}: ${error.message} The connection is saved; edit it to retry.`); }
        return connection;
    }
    async remove(id) {
        id ||= (await this.pickConnection())?.id;
        if (!id) return;
        const connection = this.connections.find(id);
        if (await vscode.window.showWarningMessage(`Remove ${connection.name} and its saved token? Custom chat panels will close. Website tabs and logins are managed separately.`, { modal: true }, 'Remove') !== 'Remove') return;
        for (const chat of [...this.chats]) if (chat.connectionId === id) chat.panel.dispose();
        this.sidebar.remove(id);
        await this.connections.remove(id); this.updateSelection();
        const active = this.sidebar.entries.find(e => e.id === this.sidebar.activeId);
        if (active) { await this.connections.select(active.connectionId); this.updateSelection(); }
    }
    getTreeItem(item) { return item; }
    async getChildren(element) {
        if (!element) return this.connections.list().map(c => {
            const item = new vscode.TreeItem(c.name, this.connections.selected()?.id === c.id ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
            item.id = c.id; item.connectionId = c.id; item.contextValue = 'hapiConnection'; item.description = this.connections.selected()?.id === c.id ? 'selected' : undefined;
            item.tooltip = c.url; item.iconPath = new vscode.ThemeIcon('plug'); return item;
        });
        if (!element.connectionId || element.sessionId) return [];
        try {
            const result = element.folderSessions ? { sessions: element.folderSessions } : await this.connections.client(element.connectionId).sessions();
            if (!element.folderSessions) return groupSessions(result.sessions || []).map(folder => {
                const item = new vscode.TreeItem(folder.name, vscode.TreeItemCollapsibleState.Collapsed);
                item.id = `${element.connectionId}:folder:${folder.key}`; item.connectionId = element.connectionId;
                item.directory = folder.directory; item.folderSessions = folder.sessions; item.contextValue = 'hapiFolder';
                item.description = `${folder.sessions.length} · ${folder.directory}${folder.machine ? ` · ${folder.machine}` : ''}`; item.tooltip = `${folder.directory}\n${folder.machine}`;
                item.iconPath = new vscode.ThemeIcon('folder'); return item;
            });
            return result.sessions.map(s => {
                const item = new vscode.TreeItem(title(s)); item.id = `${element.connectionId}:${s.id}`;
                item.connectionId = element.connectionId; item.sessionId = s.id;
                item.description = `${s.active ? (s.thinking ? 'working' : 'online') : 'offline'}${s.pendingRequestsCount ? ' · needs input' : ''}`;
                item.tooltip = `${s.metadata?.path || ''}\n${s.id}`; item.iconPath = new vscode.ThemeIcon(s.active ? 'comment-discussion' : 'history');
                item.command = { command: 'hapiChat.openChat', title: 'Open Chat', arguments: [item] }; return item;
            });
        } catch (error) { const item = new vscode.TreeItem(error.message); item.iconPath = new vscode.ThemeIcon('warning'); return [item]; }
    }
    async pickChat(id) {
        const connection = id ? this.connections.find(id) : this.connections.selected() || await this.pickConnection();
        if (!connection) return;
        const result = await this.connections.client(connection.id).sessions();
        const selected = await vscode.window.showQuickPick((result.sessions || []).map(s => ({ label: title(s), description: s.active ? 'online' : 'offline', detail: s.metadata?.path, session: s })), { title: `Open chat · ${connection.name}`, matchOnDescription: true, matchOnDetail: true });
        if (selected) await this.open(connection.id, selected.session.id, title(selected.session));
    }
    attach(panel, connectionId, sessionId, draft) {
        const chat = new Chat(this, connectionId, sessionId, panel, draft); this.chats.push(chat); return chat;
    }
    open(connectionId, sessionId, label) {
        if (chatMode(vscode) === 'web') {
            const connection = this.connections.find(connectionId);
            if (!connection) throw new Error('This connection was removed.');
            if (vscode.workspace.getConfiguration('hapiChat').get('webLocation', 'sidebar') === 'browser') return openWeb(vscode, connection.url, sessionId);
            return this.sidebar.open(connectionId, sessionId, label || sessionId);
        }
        return this.openCustom(connectionId, sessionId);
    }
    openCustom(connectionId, sessionId) {
        const existing = this.chats.find(c => c.connectionId === connectionId && c.sessionId === sessionId);
        if (existing) { existing.panel.reveal(); return existing; }
        const panel = vscode.window.createWebviewPanel('hapiChat.chat', 'HAPI Chat', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
        return this.attach(panel, connectionId, sessionId);
    }
    async newChat(id, initialDirectory) {
        const connection = id ? this.connections.find(id) : this.connections.selected() || await this.pickConnection();
        if (!connection) return;
        if (chatMode(vscode) === 'web') {
            if (vscode.workspace.getConfiguration('hapiChat').get('webLocation', 'sidebar') === 'browser') await openWeb(vscode, connection.url, 'new');
            else await this.sidebar.open(connection.id, 'new', 'New chat', initialDirectory);
            return;
        }
        const client = this.connections.client(connection.id);
        const { machines = [] } = await client.machines();
        const online = machines.filter(m => m.active);
        if (!online.length) throw new Error('No online HAPI runner. Start a runner connected to this hub before creating a chat.');
        const selected = await vscode.window.showQuickPick(online.map(m => ({ label: m.metadata?.displayName || m.metadata?.host || m.id, machine: m })), { title: `Run on machine · ${connection.name}` });
        if (!selected) return;
        const m = selected.machine;
        let agents;
        try { agents = (await client.request(`api/machines/${encodeURIComponent(m.id)}/agent-availability`)).agents?.filter(a => a.available).map(a => a.agent); }
        catch (error) { if (![404, 409].includes(error.status)) throw error; }
        agents ||= ['codex', 'claude', 'gemini', 'opencode', 'cursor', 'copilot', 'pi', 'kimi', 'grok'];
        if (!agents.length) throw new Error('No agents available on this runner. Install and sign in to an agent on that machine.');
        const agent = await vscode.window.showQuickPick(agents, { title: 'Agent' });
        if (!agent) return;
        const directory = await vscode.window.showInputBox({ title: 'Working directory on the runner machine',
            value: initialDirectory || m.metadata?.workspaceRoots?.[0] || m.metadata?.homeDir || '', prompt: 'Use a path on the selected machine. Its workspace rules and project configuration apply.', validateInput: v => v.trim() ? undefined : 'Enter a directory.' });
        if (directory === undefined) return;
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Starting HAPI chat…' }, async () => {
            const result = await client.spawn(m.id, directory.trim(), agent);
            if (result.type !== 'success' || typeof result.sessionId !== 'string') throw new Error('The runner did not return a session. Check its connection and agent login.');
            await this.open(connection.id, result.sessionId); this.changed.fire(undefined);
        });
    }
    async answer(request) {
        const nested = request.tool?.includes('request_user_input');
        const questions = request.arguments?.questions;
        if (!Array.isArray(questions) || !questions.length) throw new Error('This request format is not supported in the minimal client. Open this chat in the hub browser to answer it.');
        const answers = {};
        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            const options = (q.options || []).map(o => ({ label: o.label, description: o.description, value: o.label }));
            options.push({ label: 'Write an answer…', custom: true });
            const chosen = await vscode.window.showQuickPick(options, { title: q.header || 'Agent question', placeHolder: q.question, canPickMany: !!q.multiSelect });
            if (!chosen) return;
            const list = Array.isArray(chosen) ? chosen : [chosen];
            let values = list.filter(o => !o.custom).map(o => o.value);
            if (list.some(o => o.custom)) {
                const text = await vscode.window.showInputBox({ title: q.header || 'Agent question', prompt: q.question, ignoreFocusOut: true });
                if (text === undefined) return; values.push(text);
            }
            if (!values.length) return;
            answers[nested ? q.id || String(i) : String(i)] = nested ? { answers: values } : values;
        }
        return { answers };
    }
}
function activate(context) { return new Manager(context); }
module.exports = { activate, Manager };
