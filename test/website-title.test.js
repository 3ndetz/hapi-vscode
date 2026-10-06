'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { Sidebar } = require('../src/sidebar');

test('native website navigation uses readable metadata and ignores stale or closed session reads', async () => {
    const pending = new Map(), requests = [];
    const manager = { context: { globalState: { update: async () => {} } }, connections: {
        find: () => ({ url: 'https://hub.example/workflow/1/', name: 'Hub' }),
        client: () => ({ session: id => { requests.push(id); return new Promise(resolve => pending.set(id, resolve)); } })
    } };
    const sidebar = new Sidebar(manager), entry = { id: 'website', connectionId: 'hub', sessionId: 'initial', title: 'Initial', url: 'http://127.0.0.1:12345/workflow/1/sessions/initial' };
    sidebar.entries.push(entry);
    const navigate = id => sidebar.receive({ type: 'navigate', id: entry.id, path: '/workflow/1/sessions/' + id });
    const slow = navigate('slow'), latest = navigate('latest');
    pending.get('latest')({ session: { id: 'latest', metadata: { name: 'Current conversation' } } }); await latest;
    assert.equal(entry.title, 'Current conversation');
    pending.get('slow')({ session: { id: 'slow', metadata: { name: 'Outdated conversation' } } }); await slow;
    assert.equal(entry.title, 'Current conversation');
    assert.equal(new URL(entry.url).pathname, '/workflow/1/sessions/latest');
    const summary = navigate('summary');
    pending.get('summary')({ session: { id: 'summary', metadata: { summary: { text: 'Native summary title' } } } }); await summary;
    assert.equal(entry.title, 'Native summary title');
    const mismatch = navigate('mismatch');
    pending.get('mismatch')({ session: { id: 'another', metadata: { name: 'Wrong chat' } } }); await mismatch;
    assert.equal(entry.title, 'Chat');
    const disposed = navigate('closed'); sidebar.entries = [];
    pending.get('closed')({ session: { id: 'closed', metadata: { name: 'Closed chat' } } }); await disposed;
    assert.equal(entry.title, 'Chat');
    sidebar.entries = [entry];
    await sidebar.receive({ type: 'navigate', id: entry.id, path: '/outside/sessions/invalid' });
    assert.equal(entry.sessionId, 'closed');
    const count = requests.length;
    await navigate('new'); assert.equal(entry.title, 'New chat');
    await sidebar.receive({ type: 'navigate', id: entry.id, path: '/workflow/1/' });
    assert.equal(entry.title, 'Hub'); assert.equal(requests.length, count);
    entry.sessionId = 'restored'; entry.title = 'restored';
    const restored = sidebar.refreshTitle(entry);
    pending.get('restored')({ session: { id: 'restored', metadata: { name: 'Restored readable title' } } }); await restored;
    assert.equal(entry.title, 'Restored readable title', 'Saved API IDs from older versions get repaired on opening.');
});
