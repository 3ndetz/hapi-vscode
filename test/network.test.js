'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http'), os = require('node:os');
const { Network, bypass } = require('../src/network');
const { HapiClient } = require('../src/client');
const { websiteProxy } = require('../src/proxy');
const { mockHub } = require('./mock-hub');
const { mockProxy } = require('./mock-proxy');
test('proxy and explicit direct mode cover native auth, API and embedded website traffic without changing global settings', async () => {
    const host = Object.values(os.networkInterfaces()).flat().find(n => !n.internal && n.family === 'IPv4')?.address;
    assert.ok(host, 'A non-loopback interface is required to verify real proxy routing.');
    const hub = await mockHub('/hub/', 'network-test-key', host), proxy = await mockProxy();
    const settings = { proxy: proxy.url, proxyAuthorization: 'Basic private-proxy-auth' };
    const env = { HTTP_PROXY: proxy.url, HTTPS_PROXY: proxy.url };
    const network = new Network(() => settings, env), client = new HapiClient(hub.url, () => hub.token, network.fetch.bind(network));
    client.network = network;
    const adapter = await websiteProxy(client);
    try {
        await client.sessions(); assert.ok(proxy.requests.length > 0, 'Default mode uses the VS Code proxy.');
        const count = proxy.requests.length;
        network.dispose();
        assert.equal((await fetch(adapter.loginUrl(hub.url))).status, 200);
        assert.ok(proxy.requests.length > count, 'Website requests also use the proxy.');
        assert.ok(proxy.requests.every(r => r.auth === settings.proxyAuthorization));
        const beforeDirect = proxy.requests.length;
        settings.useProxy = false;
        await client.sessions();
        assert.equal((await fetch(adapter.loginUrl(hub.url))).status, 200);
        assert.equal(proxy.requests.length, beforeDirect, 'Disabling ignores configured and environment proxies.');
        settings.useProxy = true; settings.proxySupport = 'off';
        await client.sessions(); assert.equal(proxy.requests.length, beforeDirect);
        settings.proxySupport = 'override'; settings.noProxy = [host];
        await client.sessions(); assert.equal(proxy.requests.length, beforeDirect);
        settings.noProxy = []; settings.proxy = '';
        network.dispose();
        await client.sessions(); assert.ok(proxy.requests.length > beforeDirect, 'Environment fallback works when http.proxy is empty.');
        assert.deepEqual(env, { HTTP_PROXY: proxy.url, HTTPS_PROXY: proxy.url });
    } finally { adapter.dispose(); client.dispose(); network.dispose(); await proxy.close(); await hub.close(); }
});
test('proxy routing preserves streaming and raw WebSocket upgrades', async () => {
    const host = Object.values(os.networkInterfaces()).flat().find(n => !n.internal && n.family === 'IPv4')?.address;
    const sockets = new Set(), server = http.createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: first\n\n'); setTimeout(() => res.end('data: last\n\n'), 30);
    });
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    server.on('upgrade', (req, socket) => { socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: probe\r\n\r\n'); socket.on('data', bytes => socket.write(bytes)); });
    await new Promise(resolve => server.listen(0, host, resolve));
    const proxy = await mockProxy(), settings = { proxy: proxy.url }, network = new Network(() => settings, {});
    const url = `http://${host}:${server.address().port}/`;
    const adapter = await websiteProxy({ url, network, authenticate: async () => 'jwt' });
    try {
        for (const direct of [false, true]) {
            settings.useProxy = !direct; const before = proxy.requests.length;
            assert.equal(await (await network.fetch(url)).text(), 'data: first\n\ndata: last\n\n');
            assert.equal(await (await fetch(adapter.base)).text(), 'data: first\n\ndata: last\n\n');
            await new Promise((resolve, reject) => {
                const req = http.request(adapter.base + 'socket', { headers: { connection: 'Upgrade', upgrade: 'probe' } });
                req.on('upgrade', (_, socket, head) => {
                    const check = bytes => { assert.equal(bytes.toString(), 'echo'); socket.destroy(); resolve(); };
                    if (head.length) check(head); else { socket.on('data', check); socket.on('error', reject); socket.write('echo'); }
                }); req.on('error', reject); req.end();
            });
            assert.equal(proxy.requests.length > before, !direct);
        }
    } finally { adapter.dispose(); network.dispose(); await proxy.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
});
test('loopback and exclusions bypass proxy; credentials never appear in validation errors', () => {
    assert.equal(bypass(new URL('http://127.0.0.1/'), []), true);
    assert.equal(bypass(new URL('http://[::1]/'), []), true);
    assert.equal(bypass(new URL('https://a.example.com:443/'), ['.example.com:443']), true);
    assert.equal(bypass(new URL('https://a.example.com/'), ['example.com:80']), false);
    const network = new Network(() => ({ proxy: 'socks5://private:secret@proxy.invalid' }), {});
    assert.throws(() => network.dispatcher('https://hub.invalid/'), e => !e.message.includes('private') && !e.message.includes('secret'));
    network.dispose();
});
