'use strict';
const vscode = require('vscode');
const assert = require('node:assert/strict');
const { mockHub } = require('./mock-hub');
const waitFor = async predicate => {
    for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error('Timed out waiting for live chat updates.');
};
async function run() {
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
        chatA.panel.dispose(); assert.ok(manager.chats.includes(chatB)); assert.equal(sa.active, true, 'Closing a panel does not stop its agent.');
        for (const chat of [...manager.chats]) chat.panel.dispose();
        await manager.connections.remove(ca.id); await manager.connections.remove(cb.id);
        assert.equal(await manager.context.secrets.get(manager.connections.secretKey(ca.id)), undefined);
        assert.equal(manager.chats.length, 0);
        console.log('HOST CHECK PASSED: real VS Code, 3 parallel panels, 2 hubs, live messages, approvals, native spawn, SecretStorage and cleanup.');
    } finally {
        manager?.connections.dispose();
        for (const chat of [...manager?.chats || []]) chat.panel.dispose();
        await a.close(); await b.close();
    }
}
module.exports = { run };
