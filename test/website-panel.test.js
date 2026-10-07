'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { WebsitePanel } = require('../src/website-panel'), { Sidebar } = require('../src/sidebar'), { Connections } = require('../src/connections');
const { mockHub } = require('./mock-hub');
test('independent website panels duplicate chats, pin profiles, retain safe navigation and isolate website connections', async () => {
    const a = await mockHub(), b = await mockHub('/other/', 'other-key'), saved = new Map(), secrets = new Map();
    const context = { extensionUri: process.cwd(), subscriptions: [], globalState: { get: (k, d) => saved.get(k) ?? d, update: async (k, v) => saved.set(k, v) },
        secrets: { get: async k => secrets.get(k), store: async (k, v) => secrets.set(k, v), delete: async k => secrets.delete(k) } };
    const connections = new Connections(context), ca = await connections.save({ name: 'A', url: a.url }, a.token), cb = await connections.save({ name: 'B', url: b.url }, b.token);
    const manager = { context, connections, websiteAdapters: new Map(), webPanels: [], vscode: { Uri: { joinPath: (...p) => path.join(...p) }, ColorThemeKind: { Light: 1, HighContrastLight: 4 },
        window: { activeColorTheme: { kind: 2 }, showErrorMessage: () => {} }, workspace: { getConfiguration: () => ({ get: (_, d) => d }) }, commands: { getCommands: async () => ['workbench.action.moveEditorToNewWindow'], executeCommand: async command => manager.lastCommand = command } },
        updateSelection: () => { sidebar.update(); for (const p of manager.webPanels) p.update(); } };
    const sidebar = new Sidebar(manager);
    const makePanel = () => {
        let disposed;
        const panel = { active: true, visible: true, viewColumn: 2, webview: { cspSource: 'https://resource.example', asWebviewUri: s => s, onDidReceiveMessage: () => {}, postMessage: async state => { panel.state = state; } },
            onDidDispose: f => disposed = f, onDidChangeViewState: () => {}, reveals: [], reveal: (...args) => panel.reveals.push(args), dispose: () => disposed?.() };
        const chat = new WebsitePanel(manager, panel); manager.webPanels.push(chat); return chat;
    };
    const first = makePanel(), duplicate = makePanel(), other = makePanel();
    try {
        await first.open(ca.id, 'same', 'First'); await duplicate.open(ca.id, 'same', 'Second'); await other.open(cb.id, 'elsewhere');
        assert.equal(manager.webPanels.length, 3); assert.notEqual(first.panel, duplicate.panel);
        assert.notEqual(new URL(first.entries[0].url).origin, new URL(duplicate.entries[0].url).origin, 'Duplicate conversations have separate browser connection budgets.');
        assert.notEqual(new URL(first.entries[0].url).origin, new URL(other.entries[0].url).origin);
        await connections.select(cb.id); manager.updateSelection();
        assert.equal(first.panel.state.selected, ca.id); assert.equal(other.panel.state.selected, cb.id);
        assert.ok(!JSON.stringify(first.panel.state).includes(a.token));
        assert.ok(!JSON.stringify(first.metadata()).includes('token='));
        assert.ok(!saved.has('sidebarTabs'), 'Panels do not overwrite the independently persisted sidebar.');
        // During deserialize an inactive panel may not yet expose viewColumn.
        // Revealing it then would target the active group and move the tab.
        const navigation = duplicate.metadata(), restored = makePanel();
        restored.panel.viewColumn = undefined; restored.panel.active = false;
        await restored.restore(navigation);
        assert.deepEqual(restored.panel.reveals, [], 'Restoring leaves group placement and selection to VS Code.');
        assert.equal(restored.panel.active, false);
        assert.equal(restored.metadata().adapterId, navigation.adapterId);
        assert.equal(restored.metadata().sessionId, navigation.sessionId);
        assert.ok(!saved.has('sidebarTabs'), 'Restored editor tabs stay separate from sidebar persistence.');
        manager.webPanels = manager.webPanels.filter(p => p !== restored);
        const navigated = a.addSession('navigated'); navigated.metadata.name = 'UNIONCLEF-HARD';
        await first.receive({ type: 'navigate', id: first.entries[0].id, path: '/sessions/navigated' });
        assert.equal(first.metadata().sessionId, 'navigated'); assert.equal(duplicate.metadata().sessionId, 'same');
        assert.equal(new URL(first.entries[0].url).pathname, '/sessions/navigated');
        assert.equal(first.panel.title, 'UNIONCLEF-HARD · A');
        assert.equal(first.metadata().title, 'UNIONCLEF-HARD');
        assert.equal(first.panel.state.entries[0].title, 'UNIONCLEF-HARD');
        assert.equal(first.entries[0].reload, undefined, 'Updating the tab title leaves the native website loaded.');
        await first.receive({ type: 'navigate', id: first.entries[0].id, path: '/outside' });
        assert.equal(first.metadata().sessionId, 'navigated');
        await first.receive({ type: 'navigate', id: first.entries[0].id, path: '/sessions/missing' });
        assert.equal(first.panel.title, 'Chat · A', 'Unavailable metadata never turns into a raw API identifier.');
        await first.receive({ type: 'action', action: 'detach' }); assert.equal(manager.lastCommand, 'workbench.action.moveEditorToNewWindow');
        await first.receive({ type: 'profile', id: cb.id }); assert.equal(first.metadata().connectionId, cb.id); assert.equal(duplicate.metadata().connectionId, ca.id);
        await duplicate.receive({ type: 'action', action: 'newChat' }); assert.equal(duplicate.metadata().sessionId, 'new');
        first.panel.dispose(); assert.equal(manager.webPanels.length, 2);
        assert.equal((await fetch(duplicate.entries[0].url)).status, 200, 'Closing a window leaves neighboring website adapters available.');
    } finally { sidebar.dispose(); connections.dispose(); await a.close(); await b.close(); }
});
