'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const { Sidebar } = require('../src/sidebar'), { Connections } = require('../src/connections');
const { mockHub } = require('./mock-hub');
test('sidebar opening survives missing focus commands and preserves the view location', async () => {
    let calls = [], shown = 0;
    const view = { show: preserveFocus => { assert.equal(preserveFocus, false); shown++; } };
    const vscode = { commands: {
        getCommands: async () => ['hapiChat.conversation.open', 'workbench.view.extension.hapiChatConversations'],
        executeCommand: async command => { calls.push(command); sidebar.view = view; }
    } };
    const sidebar = new Sidebar({ vscode });
    await sidebar.reveal();
    assert.deepEqual(calls, ['hapiChat.conversation.open']); assert.equal(shown, 1);
    vscode.commands.getCommands = async () => { throw Error('Existing views must not depend on generated commands.'); };
    await sidebar.reveal(); assert.equal(shown, 2);
    sidebar.view = undefined; calls = [];
    vscode.commands.getCommands = async () => ['workbench.view.extension.hapiChatConversations'];
    await sidebar.reveal(); assert.deepEqual(calls, ['workbench.view.extension.hapiChatConversations']);
    sidebar.view = undefined; calls = [];
    vscode.commands.getCommands = async () => ['hapiChat.conversation.focus', 'hapiChat.conversation.open'];
    await sidebar.reveal(); assert.deepEqual(calls, ['hapiChat.conversation.focus']);
    sidebar.view = undefined;
    vscode.commands.getCommands = async () => [];
    await assert.rejects(sidebar.reveal(), /Developer: Reload Window/);
});
test('sidebar profile follows the active chat, keeps other hubs loaded, and restores only safe metadata', async () => {
    const hub = await mockHub(); const values = new Map(), secrets = new Map(); let state;
    const context = { extensionUri: process.cwd(), subscriptions: [], globalState: { get: (k, d) => values.get(k) ?? d, update: async (k, v) => values.set(k, v) },
        secrets: { get: async k => secrets.get(k), store: async (k, v) => secrets.set(k, v), delete: async k => secrets.delete(k) } };
    const connections = new Connections(context);
    const a = await connections.save({ name: 'A', url: hub.url }, hub.token), b = await connections.save({ name: 'B', url: hub.url }, 'different-key');
    const settings = new Map(), commands = [];
    const vscode = { Uri: { joinPath: (...p) => path.join(...p) }, ColorThemeKind: { Light: 1, HighContrastLight: 4 }, ConfigurationTarget: { Global: 1 },
        workspace: { getConfiguration: () => ({ get: (key, fallback) => settings.get(key) ?? fallback,
            update: async (key, value, target) => { assert.equal(target, 1); settings.set(key, value); } }) },
        commands: { executeCommand: async command => commands.push(command) }, window: { activeColorTheme: { kind: 2 } } };
    const manager = { context, connections, vscode, updateSelection: () => sidebar.update() };
    const sidebar = new Sidebar(manager);
    const view = { webview: { cspSource: 'https://resource.example', asWebviewUri: s => s, onDidReceiveMessage: () => {}, postMessage: async s => { state = s; } }, onDidDispose: () => {}, onDidChangeVisibility: () => {}, show: () => {} };
    try {
        sidebar.resolveWebviewView(view);
        await sidebar.open(a.id, 'same', 'Chat A'); await sidebar.open(b.id, 'same', 'Chat B');
        assert.equal(sidebar.entries.length, 2); assert.equal(state.selected, b.id); assert.equal(state.theme, 'dark');
        const first = sidebar.entries[0];
        assert.equal(state.webZoom, 70);
        const adapters = [...sidebar.proxies.values()], urls = sidebar.entries.map(e => e.url);
        await sidebar.receive({ type: 'zoom', value: 85 });
        assert.equal(state.webZoom, 85); assert.equal(settings.get('webZoom'), 85);
        for (const value of [0, 201, NaN, '70']) await sidebar.receive({ type: 'zoom', value });
        assert.equal(settings.get('webZoom'), 85, 'Invalid renderer values cannot overwrite saved zoom.');
        assert.deepEqual([...sidebar.proxies.values()], adapters); assert.deepEqual(sidebar.entries.map(e => e.url), urls);
        assert.ok(sidebar.entries.every(e => !e.reload), 'Changing website scale preserves websites and streams.');
        await connections.select(a.id);
        await sidebar.receive({ type: 'action', action: 'showChats' });
        assert.equal(connections.selected().id, b.id, 'The full tree focuses the hub pinned to this chat.');
        assert.equal(commands.at(-1), 'hapiChat.sessions.focus');
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
        await sidebar.open(a.id, 'new'); const newId = sidebar.activeId; await sidebar.open(a.id, 'new');
        assert.notEqual(sidebar.activeId, newId, 'New chat always creates a fresh form, even after the old website navigates to its spawned session.');
        assert.equal(sidebar.entries.length, 4);
        const active = sidebar.entries.find(entry => entry.id === sidebar.activeId);
        await sidebar.receive({ type: 'action', action: 'reloadChat' });
        assert.equal(active.reload, 1); assert.equal(sidebar.entries.length, 4);
        await Promise.all([sidebar.open(a.id, 'rapid-click'), sidebar.open(a.id, 'rapid-click')]);
        assert.equal(sidebar.entries.filter(e => e.sessionId === 'rapid-click').length, 1, 'Rapid repeated clicks cannot leak duplicate pages or adapters.');
        assert.equal(sidebar.proxies.size, sidebar.entries.length);
        assert.ok(!JSON.stringify(values.get('sidebarTabs')).includes('reload'), 'Reload state is transient; stored chat navigation stays unchanged.');
        vscode.window.activeColorTheme.kind = 4; sidebar.update(); assert.equal(state.theme, 'light');
        const count = sidebar.entries.length;
        sidebar.dispose();
        const reloadedManager = { ...manager, vscode: { ...vscode, commands: {
            getCommands: async () => ['hapiChat.conversation.focus'],
            executeCommand: async () => reloaded.resolveWebviewView(view)
        } }, updateSelection: () => reloaded.update() };
        const reloaded = new Sidebar(reloadedManager);
        try {
            await reloaded.open(a.id, 'after-update', 'Opened after an update');
            assert.equal(reloaded.entries.length, count + 1, 'The first tree click after an update preserves all previously open chats.');
            assert.equal(reloaded.entries.find(entry => entry.id === reloaded.activeId).sessionId, 'after-update');
            assert.ok(!JSON.stringify(values.get('sidebarTabs')).includes('token='));
        } finally { reloaded.dispose(); }
    } finally { sidebar.dispose(); connections.dispose(); await hub.close(); }
});
