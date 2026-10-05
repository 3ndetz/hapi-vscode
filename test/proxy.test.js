'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http');
const { websiteProxy } = require('../src/proxy');
const { HapiClient } = require('../src/client');
const { mockHub } = require('./mock-hub');
test('sidebar login consumes SecretStorage server-side and scopes capabilities to one hub', async () => {
    const a = await mockHub('/path/', 'private-a'), b = await mockHub('/other/', 'private-b');
    const ca = new HapiClient(a.url, () => a.token), cb = new HapiClient(b.url, () => b.token);
    const pa = await websiteProxy(ca), pb = await websiteProxy(cb);
    try {
        const local = pa.loginUrl(a.url + 'sessions/test'); const capability = new URL(local).searchParams.get('token');
        assert.ok(!local.includes(a.token)); assert.equal(new URL(local).hostname, '127.0.0.1');
        assert.equal((await fetch(local)).status, 200);
        assert.ok(!a.requests.some(r => r.query.token), 'The loopback capability never reaches the hub URL.');
        const login = async (base, token, origin) => fetch(base + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify({ accessToken: token }) });
        const good = await login(pa.base, capability, new URL(pa.base).origin); assert.equal(good.status, 200); assert.ok((await good.json()).token);
        assert.equal(a.requests.find(r => r.route === 'api/auth').data.accessToken, a.token);
        assert.equal((await login(pb.base, capability)).status, 401);
        assert.equal((await login(pa.base, capability, 'https://attacker.example')).status, 401);
        assert.equal((await login(pa.base, 'wrong')).status, 401);
        assert.equal(b.authCount, 0);
        assert.equal((await fetch(new URL('../api/auth', pa.base))).status, 403);
        assert.throws(() => pa.loginUrl('https://different.example/'));
    } finally { pa.dispose(); pb.dispose(); ca.dispose(); cb.dispose(); await a.close(); await b.close(); }
});
test('website proxy forwards streaming API and upgrades WebSockets without changing data', async () => {
    const sockets = new Set();
    const upstream = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: first\n\n'); setTimeout(() => res.end('data: second\n\n'), 10); });
    upstream.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    upstream.on('upgrade', (req, socket, head) => { socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: probe\r\n\r\n'); if (head.length) socket.write(head); socket.on('data', data => socket.write(data)); });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const proxy = await websiteProxy({ url: `http://127.0.0.1:${upstream.address().port}/`, authenticate: async () => 'jwt' });
    try {
        assert.equal(await (await fetch(proxy.base + 'api/events')).text(), 'data: first\n\ndata: second\n\n');
        await new Promise((resolve, reject) => {
            const request = http.request(proxy.base + 'socket', { headers: { connection: 'Upgrade', upgrade: 'probe' } });
            request.on('upgrade', (_, socket, head) => { const check = bytes => { assert.equal(bytes.toString(), 'echo'); socket.destroy(); resolve(); }; if (head.length) check(head); else { socket.on('data', check); socket.on('error', reject); socket.write('echo'); } });
            request.on('error', reject); request.end();
        });
    } finally { proxy.dispose(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => upstream.close(resolve)); }
});
