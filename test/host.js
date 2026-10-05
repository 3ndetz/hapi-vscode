'use strict';
const vscode = require('vscode');
const assert = require('node:assert/strict');
const { mockHub } = require('./mock-hub');
const waitFor = async predicate => {
    for (let n = 0; n < 600; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error('Timed out waiting for live chat updates.');
};
async function run() {
    const configuration = vscode.workspace.getConfiguration('hapiChat');
    assert.equal(configuration.get('chatMode'), 'web', 'The full website is the default interface.');
    const a = await mockHub('/workflow/1/', 'isolated-key-a'), b = await mockHub('/hub/', 'isolated-key-b');
    let manager;
    try {
        const extension = vscode.extensions.getExtension('3ndetz.hapi-chat');
        assert.ok(extension, 'Extension is installed in the development host.');
        manager = await extension.activate();
        const ca = await manager.connections.save({ name: 'Test Hub A', url: a.url }, a.token);
        const cb = await manager.connections.save({ name: 'Test Hub B', url: b.url }, b.token);
        const sa = a.addSession('same-session-id'), sb = b.addSession('same-session-id'), second = a.addSession('second');
        await manager.connections.select(ca.id); manager.updateSelection();
        const roots = await manager.getChildren(); const folders = await manager.getChildren(roots.find(r => r.connectionId === ca.id));
        assert.equal(folders.length, 1); assert.equal(folders[0].directory, '/workspace');
        assert.equal((await manager.getChildren(folders[0])).length, 2);
        const beforeLogin = a.authCount;
        const unavailable = new Set(['hapiChat.web.focus']);
        manager.vscode = { ...vscode, commands: { ...vscode.commands,
            getCommands: async (...args) => (await vscode.commands.getCommands(...args)).filter(id => !unavailable.has(id)),
            executeCommand: (command, ...args) => {
                if (unavailable.has(command)) throw Error(`command '${command}' not found`);
                return vscode.commands.executeCommand(command, ...args);
            }
        } };
        try {
            sa.active = false;
            const offlineFolders = await manager.getChildren(roots.find(item => item.connectionId === ca.id));
            const sessions = await manager.getChildren(offlineFolders[0]);
            const offline = sessions.find(item => item.sessionId === sa.id);
            assert.equal(offline.description, 'offline');
            await vscode.commands.executeCommand(offline.command.command, ...offline.command.arguments);
            await waitFor(() => a.requests.some(r => r.route === `sessions/${sa.id}`) && a.authCount > beforeLogin);
            unavailable.add('hapiChat.web.open');
            await vscode.commands.executeCommand(offline.command.command, ...offline.command.arguments);
            assert.equal(manager.sidebar.entries.length, 1, 'Reopening an offline chat uses the existing sidebar without generated commands.');
        } finally { manager.vscode = vscode; sa.active = true; }
        await waitFor(() => a.requests.some(r => r.route === `sessions/${sa.id}`) && a.authCount > beforeLogin);
        await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Light Modern', vscode.ConfigurationTarget.Global);
        await waitFor(() => a.requests.some(r => r.route === 'api/sessions' && r.query.scheme === 'light'));
        await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Global);
        await waitFor(() => a.requests.some(r => r.route === 'api/sessions' && r.query.scheme === 'dark'));
        await manager.connections.select(cb.id); manager.updateSelection();
        await manager.open(cb.id, sb.id);
        await manager.newChat(cb.id);
        await manager.openHub(ca.id);
        await waitFor(() => b.requests.some(r => r.route === `sessions/${sb.id}`) && b.requests.some(r => r.route === 'sessions/new') && a.requests.some(r => r.route === ''));
        assert.equal(manager.chats.length, 0, 'Default mode loads actual websites instead of creating custom panels.');
        assert.equal(manager.sidebar.entries.length, 4, 'Multiple website conversations live in the sidebar.');
        assert.ok(!manager.sidebar.view.webview.html.includes(a.token));
        assert.ok(!JSON.stringify(manager.context.globalState.get('sidebarTabs')).includes('token='));
        await manager.sidebar.receive({ type: 'activate', id: manager.sidebar.entries.find(e => e.connectionId === cb.id && e.sessionId === sb.id).id });
        assert.equal(manager.connections.selected().id, cb.id, 'The header follows the active conversation profile.');
        assert.ok(!b.requests.some(r => r.route.endsWith('/spawn')), 'Web new chat delegates to the website form.');
        for (const r of [...a.requests, ...b.requests].filter(r => !r.route.startsWith('api/'))) {
            assert.equal(r.auth, undefined); assert.equal(r.query.token, undefined, 'Never pass keys in browser URLs.');
        }
        await manager.copyLoginToken(cb.id);
        assert.equal(await vscode.env.clipboard.readText(), b.token, 'Copy the explicitly chosen profile key.');
        await vscode.env.clipboard.writeText('');
        await configuration.update('chatMode', 'custom', vscode.ConfigurationTarget.Global);
        const chatA = manager.open(ca.id, sa.id), chatB = manager.open(cb.id, sb.id), chatC = manager.open(ca.id, second.id);
        assert.equal(manager.chats.length, 3);
        assert.equal(manager.open(ca.id, sa.id), chatA, 'Repeated open focuses the existing panel.');
        chatB.panel.reveal(vscode.ViewColumn.Beside);
        await Promise.all([chatA.refresh(), chatB.refresh(), chatC.refresh()]);
        await waitFor(() => chatA.live && chatB.live && chatC.live && chatA.ready && chatB.ready && chatC.ready);
        await manager.connections.select(cb.id); manager.updateSelection();
        assert.equal(chatA.connectionId, ca.id); assert.equal(chatB.connectionId, cb.id);
        await Promise.all([chatA.receive({ type: 'send', text: 'parallel A' }), chatB.receive({ type: 'send', text: 'parallel B' }), chatC.receive({ type: 'send', text: 'parallel C' })]);
        await waitFor(() => chatA.window.messages.some(m => m.content?.content?.data?.message === 'Reply: parallel A') && chatB.window.messages.some(m => m.content?.content?.data?.message === 'Reply: parallel B'));
        assert.ok(a.messages.get(sa.id).some(m => m.content?.content?.text === 'parallel A'));
        assert.ok(!a.messages.get(sa.id).some(m => m.content?.content?.text === 'parallel B'));
        assert.ok(b.messages.get(sb.id).some(m => m.content?.content?.text === 'parallel B'));
        assert.equal(chatA.panel.webview.html.includes(a.token), false); assert.equal(chatB.panel.webview.html.includes(b.token), false);
        const html = chatA.panel.webview.html;
        assert.ok(html.includes("default-src 'none'")); assert.ok(!html.includes("'unsafe-inline'"));
        sa.agentState.requests['approval'] = { tool: 'shell', arguments: { command: 'echo test' } };
        await chatA.refresh(); await chatA.receive({ type: 'permission', id: 'approval', action: 'approve' });
        assert.equal(sa.agentState.requests.approval, undefined);
        const created = await manager.connections.client(cb.id).spawn('machine', '/workspace/other', 'codex');
        const newChat = manager.open(cb.id, created.sessionId); await newChat.refresh(); assert.equal(newChat.session.active, true);
        await configuration.update('chatMode', 'web', vscode.ConfigurationTarget.Global);
        await manager.open(cb.id, created.sessionId);
        await waitFor(() => b.requests.some(r => r.route === `sessions/${created.sessionId}`));
        assert.ok(manager.chats.includes(newChat), 'Switching interfaces preserves existing custom panels.');
        chatA.panel.dispose(); assert.ok(manager.chats.includes(chatB)); assert.equal(sa.active, true, 'Closing a panel does not stop its agent.');
        for (const chat of [...manager.chats]) chat.panel.dispose();
        await manager.connections.remove(ca.id); await manager.connections.remove(cb.id);
        manager.sidebar.remove(ca.id); manager.sidebar.remove(cb.id);
        assert.equal(await manager.context.secrets.get(manager.connections.secretKey(ca.id)), undefined);
        assert.equal(manager.chats.length, 0);
        console.log('HOST CHECK PASSED: offline tree chats with missing focus commands, real VS Code sidebar, live light/dark website sync, folder groups, saved profiles, parallel websites on 2 hubs, native new-chat form, mixed interfaces, 3 custom panels, live messages, approvals, native spawn and SecretStorage cleanup.');
    } finally {
        manager?.connections.dispose();
        manager?.sidebar.dispose();
        for (const chat of [...manager?.chats || []]) chat.panel.dispose();
        await a.close(); await b.close();
        await configuration.update('chatMode', undefined, vscode.ConfigurationTarget.Global);
        await vscode.workspace.getConfiguration('workbench').update('colorTheme', undefined, vscode.ConfigurationTarget.Global);
    }
}
module.exports = { run };
