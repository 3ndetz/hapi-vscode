'use strict';
const vscode = require('vscode');
const assert = require('node:assert/strict');
const { mockHub } = require('./mock-hub');
const { mockProxy } = require('./mock-proxy');
const os = require('node:os');
const { Metadata } = require('../src/metadata');
const waitFor = async predicate => {
    for (let n = 0; n < 600; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error('Timed out waiting for live chat updates.');
};
async function run() {
    console.log('HOST CHECK: initializing the isolated editor.');
    const configuration = vscode.workspace.getConfiguration('hapiChat');
    assert.equal(configuration.get('chatMode'), 'web', 'The full website is the default interface.');
    const a = await mockHub('/workflow/1/', 'isolated-key-a'), b = await mockHub('/hub/', 'isolated-key-b');
    let manager;
    try {
        const extension = vscode.extensions.getExtension('3ndetz.hapi-chat');
        assert.ok(extension, 'Extension is installed in the development host.');
        manager = await extension.activate();
        console.log('HOST CHECK: extension active.');
        const address = Object.values(os.networkInterfaces()).flat().find(n => !n.internal && n.family === 'IPv4')?.address;
        const networkHub = await mockHub('/proxy-check/', 'proxy-check-key', address);
        const target = new URL(networkHub.url).host, proxy = await mockProxy(target);
        const routed = () => proxy.requests.filter(r => r.target === target).length;
        const httpConfig = vscode.workspace.getConfiguration('http');
        let networkProfile;
        try {
            await httpConfig.update('proxy', proxy.url, vscode.ConfigurationTarget.Global);
            await httpConfig.update('proxySupport', 'override', vscode.ConfigurationTarget.Global);
            networkProfile = await manager.connections.save({ name: 'Proxy routing fixture', url: networkHub.url }, networkHub.token);
            await manager.connections.client(networkProfile.id).sessions();
            assert.ok(routed() > 0, 'Extension requests honor VS Code http.proxy under the real extension host.');
            const before = routed();
            await configuration.update('useVSCodeProxy', false, vscode.ConfigurationTarget.Global);
            await waitFor(() => vscode.workspace.getConfiguration('hapiChat').get('useVSCodeProxy') === false);
            await manager.connections.client(networkProfile.id).sessions();
            assert.equal(routed(), before, 'Explicit direct mode bypasses even VS Code proxySupport override.');
        } finally {
            if (networkProfile) await manager.connections.remove(networkProfile.id);
            await configuration.update('useVSCodeProxy', undefined, vscode.ConfigurationTarget.Global);
            await httpConfig.update('proxy', undefined, vscode.ConfigurationTarget.Global);
            await httpConfig.update('proxySupport', undefined, vscode.ConfigurationTarget.Global);
            await proxy.close(); await networkHub.close();
        }
        const ca = await manager.connections.save({ name: 'Test Hub A', url: a.url }, a.token);
        const cb = await manager.connections.save({ name: 'Test Hub B', url: b.url }, b.token);
        const sa = a.addSession('same-session-id'), sb = b.addSession('same-session-id'), second = a.addSession('second');
        await waitFor(() => manager.connections.find(ca.id) && manager.connections.find(cb.id));
        await manager.connections.select(ca.id); manager.updateSelection();
        const roots = await manager.getChildren(), root = roots.find(r => r.connectionId === ca.id);
        assert.ok(root, 'The saved Hub A appears in the real tree.');
        const folders = await manager.getChildren(root);
        console.log('HOST CHECK: folder fixture', JSON.stringify({ sessions: [...a.sessions.values()].map(s => ({ id: s.id, path: s.metadata.path, machine: s.metadata.machineId })), folders: folders.map(f => ({ directory: f.directory, sessions: f.folderSessions?.length, label: f.label })) }));
        assert.equal(folders.length, 1); assert.equal(folders[0].directory, '/workspace');
        assert.equal((await manager.getChildren(folders[0])).length, 2);
        const beforeLogin = a.authCount;
        const unavailable = new Set(['hapiChat.conversation.focus']);
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
            unavailable.add('hapiChat.conversation.open');
            await vscode.commands.executeCommand(offline.command.command, ...offline.command.arguments);
            assert.equal(manager.sidebar.entries.length, 1, 'Reopening an offline chat uses the existing sidebar without generated commands.');
        } finally { manager.vscode = vscode; sa.active = true; }
        await waitFor(() => a.requests.some(r => r.route === `sessions/${sa.id}`) && a.authCount > beforeLogin);
        await vscode.commands.executeCommand('workbench.action.closeSidebar');
        assert.equal(manager.sidebar.view.visible, true, 'Closing the primary configuration sidebar leaves the separate right chat visible.');
        await vscode.commands.executeCommand('hapiChat.sessions.focus');
        assert.equal(manager.sidebar.view.visible, true, 'The folder list and chat can be visible independently on opposite sides.');
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
        const websiteA = await manager.openWindow({ connectionId: ca.id, sessionId: sa.id, label: 'Independent A' });
        console.log('HOST CHECK: first independent website window created.');
        const websiteDuplicate = await manager.openWindow({ connectionId: ca.id, sessionId: sa.id, label: 'Duplicate A' });
        const websiteB = await manager.openWindow({ connectionId: cb.id, sessionId: sb.id, label: 'Independent B' });
        await waitFor(() => manager.webPanels.length === 3 && manager.webPanels.every(p => p.panel.visible));
        // Chromium can coalesce identical simultaneous document requests. Count
        // authenticated reports from distinct JavaScript contexts instead.
        const websiteInstances = (hub, id) => new Set(hub.requests.filter(r => r.route === 'api/sessions' && r.query.page === new URL(`sessions/${id}`, hub.url).pathname && r.query.view).map(r => r.query.view)).size;
        await waitFor(() => websiteInstances(a, sa.id) >= 3 && websiteInstances(b, sb.id) >= 2);
        assert.equal(new Set(manager.webPanels.map(p => p.panel.viewColumn)).size, 3, 'Three native chat columns are visible simultaneously.');
        assert.equal(manager.sidebar.view.visible, true, 'The right sidebar stays alongside independent website windows.');
        await manager.connections.select(cb.id); manager.updateSelection();
        assert.equal(websiteA.metadata().connectionId, ca.id); assert.equal(websiteB.metadata().connectionId, cb.id);
        const schemesBefore = a.requests.filter(r => r.route === 'api/sessions' && r.query.scheme === 'light').length;
        await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Light Modern', vscode.ConfigurationTarget.Global);
        await waitFor(() => a.requests.filter(r => r.route === 'api/sessions' && r.query.scheme === 'light').length >= schemesBefore + 2);
        await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Global);
        await websiteA.receive({ type: 'action', action: 'newChat' });
        assert.equal(websiteA.metadata().sessionId, 'new'); assert.equal(websiteDuplicate.metadata().sessionId, sa.id);
        websiteA.panel.dispose(); assert.equal(manager.webPanels.length, 2);
        assert.equal(websiteDuplicate.panel.visible, true);
        await websiteB.receive({ type: 'profile', id: ca.id });
        assert.equal(websiteB.metadata().connectionId, ca.id);
        const separateForm = await manager.newWindow({ connectionId: cb.id, directory: '/workspace/other' });
        assert.equal(separateForm.metadata().directory, '/workspace/other');
        await waitFor(() => b.requests.some(r => r.route === 'sessions/new' && r.query.directory === '/workspace/other'));
        for (const panel of [...manager.webPanels]) panel.panel.dispose();
        await manager.context.globalState.pending;
        const storedProfiles = new Metadata(manager.context.globalState, manager.context.globalStorageUri).get('connections', []);
        assert.ok(storedProfiles.some(p => p.id === ca.id) && storedProfiles.some(p => p.id === cb.id), 'Native persisted storage retains both profiles after rapid edits and website navigation.');
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
        // VS Code initializes a new webview when it becomes visible. Let each
        // panel load before testing simultaneous updates in retained hidden views.
        for (const chat of [chatA, chatB, chatC]) {
            chat.panel.reveal();
            await waitFor(() => chat.live && chat.ready);
        }
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
        console.log('HOST CHECK PASSED: configured proxy and forced direct under VS Code override; three simultaneous native website columns plus right sidebar; duplicated conversations, pinned hub selectors and live theme sync; grouped folders, auto-login, new-chat forms, mixed interfaces, custom messaging and approvals, native spawn and SecretStorage cleanup.');
    } finally {
        manager?.connections.dispose();
        manager?.sidebar.dispose();
        manager?.network.dispose();
        for (const chat of [...manager?.webPanels || []]) chat.panel.dispose();
        for (const chat of [...manager?.chats || []]) chat.panel.dispose();
        await a.close(); await b.close();
        await configuration.update('chatMode', undefined, vscode.ConfigurationTarget.Global);
        await vscode.workspace.getConfiguration('workbench').update('colorTheme', undefined, vscode.ConfigurationTarget.Global);
    }
}
module.exports = { run };
