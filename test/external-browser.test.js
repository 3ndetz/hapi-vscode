'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { openExternalBrowser } = require('../src/external-browser'), { websiteProxy } = require('../src/proxy');
const { HapiClient } = require('../src/client'), { mockHub } = require('./mock-hub');

test('external browser auto-login uses its own adapter and survives closing the chat website', async () => {
    const hub = await mockHub('/workflow/1/', 'private-browser-key'), client = new HapiClient(hub.url, () => hub.token);
    const connection = { id: 'hub', url: hub.url }, opened = [], adapters = new Map();
    const manager = { connections: { find: () => connection, client: () => client, selected: () => connection }, websiteAdapters: adapters,
        vscode: { Uri: { parse: url => url }, env: { openExternal: async url => { opened.push(url); return true; } } } };
    const chat = await websiteProxy(client);
    try {
        assert.equal((await openExternalBrowser(manager, { connectionId: 'hub', sessionId: 'chat', directory: '/work' })).autoLogin, true);
        const url = new URL(opened[0]); assert.equal(url.hostname, '127.0.0.1'); assert.notEqual(url.origin, new URL(chat.base).origin);
        assert.equal(url.pathname, '/workflow/1/sessions/chat'); assert.equal(url.searchParams.get('directory'), '/work');
        assert.ok(!opened[0].includes(hub.token)); chat.dispose();
        assert.equal((await fetch(url)).status, 200, 'The external page keeps working after the chat adapter closes.');
        const response = await fetch(new URL('../api/auth', url), { method: 'POST', headers: { 'content-type': 'application/json', origin: url.origin }, body: JSON.stringify({ accessToken: url.searchParams.get('token') }) });
        assert.equal(response.status, 200); assert.ok((await response.json()).token);
        assert.ok(!hub.requests.some(r => r.query.token), 'The local capability never reaches the actual hub.');
        assert.equal(adapters.size, 1);
    } finally { chat.dispose(); for (const promise of adapters.values()) (await promise).dispose(); client.dispose(); await hub.close(); }
});

test('browser fallback opens the original hub without credentials and failed launches release their adapter', async () => {
    const connection = { id: 'hub', url: 'https://hub.example/prefix/' }, opened = [], adapters = new Map();
    const client = { url: connection.url, authenticate: async () => { throw Error('Offline'); } };
    const manager = { connections: { find: () => connection, client: () => client, selected: () => connection }, websiteAdapters: adapters,
        vscode: { Uri: { parse: url => url }, env: { openExternal: async url => { opened.push(url); return true; } } } };
    assert.equal((await openExternalBrowser(manager, { sessionId: 'chat' })).autoLogin, false);
    assert.deepEqual(opened, ['https://hub.example/prefix/sessions/chat']); assert.equal(adapters.size, 0);
    client.authenticate = async () => 'jwt'; manager.vscode.env.openExternal = async () => false;
    await assert.rejects(openExternalBrowser(manager, { sessionId: 'chat' }), /Unable to open the browser/);
    assert.equal(adapters.size, 0);
});
