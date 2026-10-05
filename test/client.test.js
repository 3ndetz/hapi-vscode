'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HapiClient, normalizeUrl, SseParser } = require('../src/client');
const { mockHub } = require('./mock-hub');

test('URL prefixes are preserved, credentials and query tokens are rejected', () => {
    assert.equal(normalizeUrl('https://example.com/workflow/1'), 'https://example.com/workflow/1/');
    assert.equal(normalizeUrl('http://localhost:3006'), 'http://localhost:3006/');
    for (const url of ['https://x/?token=private', 'https://user:secret@x', 'file:///tmp/x', 'https://x/#private', 'bad']) assert.throws(() => normalizeUrl(url));
});
test('concurrent login is serialized; independent hubs never share credentials; JWT renewal', async t => {
    const a = await mockHub('/workflow/1/', 'key-a'), b = await mockHub('/another/', 'key-b');
    const ca = new HapiClient(a.url, async () => a.token), cb = new HapiClient(b.url, async () => b.token);
    t.after(async () => { ca.dispose(); cb.dispose(); await a.close(); await b.close(); });
    await Promise.all([ca.sessions(), ca.machines(), cb.sessions()]);
    assert.equal(a.authCount, 1); assert.equal(b.authCount, 1);
    assert.equal(a.requests[0].data.accessToken, 'key-a'); assert.equal(b.requests[0].data.accessToken, 'key-b');
    assert.equal(a.requests[0].auth, undefined);
    assert.ok(a.requests.filter(r => r.route !== 'api/auth').every(r => r.auth && !r.auth.includes('key-a')));
    a.rotateJwt(); await ca.sessions(); assert.equal(a.authCount, 2);
});
test('spawn, send and approval use encoded native API paths and stable local ids', async t => {
    const hub = await mockHub(); const c = new HapiClient(hub.url, async () => hub.token);
    t.after(async () => { c.dispose(); await hub.close(); });
    const { sessionId } = await c.spawn('machine', '/workspace/subdir', 'codex');
    await c.send(sessionId, 'hello', 'stable-local-id'); await c.send(sessionId, 'hello', 'stable-local-id');
    assert.equal(hub.messages.get(sessionId).filter(m => m.localId === 'stable-local-id').length, 1);
    await c.permission(sessionId, 'request/with spaces', true, { decision: 'approved' });
    const p = hub.requests.at(-1); assert.ok(p.route.includes('request%2Fwith%20spaces/approve'));
    assert.equal(hub.requests.find(r => r.route.endsWith('/spawn')).data.startingMode, 'remote');
});
test('SSE parser handles split CRLF, multiline JSON, heartbeat and ids', () => {
    const seen = []; const parser = new SseParser((event, id) => seen.push({ event, id }));
    for (const chunk of ['id: cursor\r\ndata: {"type":\r\n', 'data: "message-received"}\r', '\n\r\n: keepalive\n\ndata: {"type":"heartbeat"}\n\n']) parser.feed(chunk);
    assert.deepEqual(seen, [{ event: { type: 'message-received' }, id: 'cursor' }, { event: { type: 'heartbeat' }, id: undefined }]);
});
test('real streaming transport delivers messages and aborts without exposing the access token', async t => {
    const hub = await mockHub('/prefix/'); const c = new HapiClient(hub.url, async () => hub.token); const session = hub.addSession();
    t.after(async () => { c.dispose(); await hub.close(); });
    let opened; const open = new Promise(resolve => { opened = resolve; });
    let received; const message = new Promise(resolve => { received = resolve; });
    const subscription = c.subscribe(session.id, e => { if (e.type === 'message-received') received(e); }, live => { if (live) opened(); });
    await open; await c.send(session.id, 'stream hello', 'local');
    const event = await message; assert.equal(event.sessionId, session.id);
    const stream = hub.requests.find(r => r.route === 'api/events'); assert.equal(stream.query.token, undefined); assert.ok(stream.auth.startsWith('Bearer test-jwt'));
    subscription.dispose();
});
test('credentials cannot leak through redirects or server error text; failed writes are not replayed', async () => {
    let calls = 0;
    const c = new HapiClient('https://example.com/prefix/', async () => 'private-key', async (url, options) => {
        assert.equal(options.redirect, 'error'); calls++;
        if (String(url).endsWith('api/auth')) return Response.json({ token: 'private-jwt' });
        return Response.json({ error: 'secret private-key private-jwt', code: 'safe_code' }, { status: 503 });
    });
    await assert.rejects(() => c.send('session', 'secret draft'), error => !error.message.includes('private') && error.message.includes('safe_code'));
    assert.equal(calls, 2); c.dispose();
});
