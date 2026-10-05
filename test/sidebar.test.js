'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const { Sidebar } = require('../src/sidebar'), { Connections } = require('../src/connections');
const { mockHub } = require('./mock-hub');
test('sidebar profile follows the active chat, keeps other hubs loaded, and restores only safe metadata', async () => {
    const hub = await mockHub(); const values = new Map(), secrets = new Map(); let state;
    const context = { extensionUri: process.cwd(), subscriptions: [], globalState: { get: (k, d) => values.get(k) ?? d, update: async (k, v) => values.set(k, v) },
        secrets: { get: async k => secrets.get(k), store: async (k, v) => secrets.set(k, v), delete: async k => secrets.delete(k) } };
    const connections = new Connections(context);
    const a = await connections.save({ name: 'A', url: hub.url }, hub.token), b = await connections.save({ name: 'B', url: hub.url }, 'different-key');
    const vscode = { Uri: { joinPath: (...p) => path.join(...p) }, ColorThemeKind: { Light: 1, HighContrastLight: 4 },
        workspace: { getConfiguration: () => ({ get: (_, fallback) => fallback }) }, commands: { executeCommand: async () => {} }, window: { activeColorTheme: { kind: 2 } } };
    const manager = { context, connections, vscode, updateSelection: () => sidebar.update() };
    const sidebar = new Sidebar(manager);
    const view = { webview: { cspSource: 'https://resource.example', asWebviewUri: s => s, onDidReceiveMessage: () => {}, postMessage: async s => { state = s; } }, onDidDispose: () => {}, onDidChangeVisibility: () => {}, show: () => {} };
    try {
        sidebar.resolveWebviewView(view);
        await sidebar.open(a.id, 'same', 'Chat A'); await sidebar.open(b.id, 'same', 'Chat B');
        assert.equal(sidebar.entries.length, 2); assert.equal(state.selected, b.id); assert.equal(state.theme, 'dark');
        const first = sidebar.entries[0];
        await sidebar.receive({ type: 'activate', id: first.id });
        assert.equal(state.selected, a.id); assert.equal(sidebar.entries.length, 2);
        const restored = values.get('sidebarTabs');
        assert.ok(!JSON.stringify(restored).includes('token=')); assert.ok(!JSON.stringify(restored).includes(hub.token));
        assert.ok(!view.webview.html.includes(hub.token)); assert.ok(!JSON.stringify(state).includes('different-key'));
        await sidebar.receive({ type: 'close', id: first.id });
        assert.equal(state.selected, b.id); assert.equal(sidebar.entries.length, 1);
        sidebar.remove(b.id); assert.equal(sidebar.entries.length, 0); assert.equal(sidebar.proxies.has(b.id), false);
        await values.set('sidebarTabs', restored); await sidebar.restore();
        assert.equal(sidebar.entries.length, 2); assert.equal(sidebar.activeId, first.id); assert.equal(state.selected, a.id);
        vscode.window.activeColorTheme.kind = 4; sidebar.update(); assert.equal(state.theme, 'light');
    } finally { sidebar.dispose(); connections.dispose(); await hub.close(); }
});
