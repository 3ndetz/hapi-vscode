'use strict';
const { Sidebar } = require('./sidebar');
const { randomUUID } = require('node:crypto');

// A panel has its own loopback origin so its event streams never starve another
// website's API requests. Profile selection and navigation remain independent.
class WebsitePanel extends Sidebar {
    constructor(manager, panel) {
        super(manager); this.panel = panel; this.restored = true; this.adapterId = randomUUID();
        panel.iconPath = manager.vscode.Uri.joinPath(manager.context.extensionUri, 'media', 'icon.png');
        this.resolveWebviewView(panel);
        panel.onDidDispose(() => { this.dispose(); manager.webPanels = manager.webPanels.filter(p => p !== this); }, undefined, manager.context.subscriptions);
    }
    async open(...args) {
        if (this.entries[0]?.connectionId !== args[0]) this.release(this.entries[0]);
        this.entries = [];
        await super.open(...args.slice(0, 4), undefined, false, this.adapterId);
        const entry = this.entries[0];
        this.panel.title = `${entry.title} · ${this.manager.connections.find(entry.connectionId).name}`;
        this.update();
        return this;
    }
    reveal() { this.panel.reveal(this.panel.viewColumn, false); }
    async adopt(entry) { await super.adopt(entry); this.adapterId = entry.adapterId; this.update(); }
    metadata() {
        const entry = this.entries[0];
        if (!entry) return;
        const { connectionId, sessionId, directory, title } = entry;
        return { connectionId, sessionId, directory, title, adapterId: this.adapterId };
    }
    save() { this.update(); }
    update() {
        if (this.panel && this.entries[0]) this.panel.title = `${this.entries[0].title} · ${this.manager.connections.find(this.entries[0].connectionId)?.name || ''}`;
        return super.update();
    }
    restoreSaved() { return Promise.resolve(); }
    async receive(message) {
        const m = this.manager, active = this.entries[0];
        if (message?.type === 'profile' && m.connections.find(message.id)) return this.open(message.id);
        if (message?.type === 'close') return this.panel.dispose();
        if (message?.type === 'action' && message.action === 'newChat' && active) return this.open(active.connectionId, 'new', 'New chat', active.directory);
        if (message?.type === 'action' && message.action === 'detach') {
            this.reveal();
            const command = 'workbench.action.moveEditorToNewWindow';
            if (!(await m.vscode.commands.getCommands(true)).includes(command)) throw Error('This VS Code version cannot move editors into a separate window. Drag the chat tab to another editor group instead.');
            return m.vscode.commands.executeCommand(command);
        }
        return super.receive(message);
    }
    dispose() { this.release(this.entries[0]); }
}
module.exports = { WebsitePanel };
