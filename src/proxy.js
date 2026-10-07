'use strict';
const http = require('node:http');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { normalizeUrl } = require('./client');
const { Network } = require('./network');
const { websiteBridge } = require('./website-bridge');
const { findBridge } = require('./find-bridge');
const equal = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function websiteProxy(client, preferredPort = 0) {
    const upstream = new URL(normalizeUrl(client.url));
    const network = client.network || new Network(() => ({ useProxy: false }));
    const capability = randomBytes(32).toString('hex');
    const sockets = new Set(); let origin;
    function target(req) {
        const url = new URL(req.url, origin);
        if (req.headers.host !== new URL(origin).host || !url.pathname.startsWith(upstream.pathname)) return;
        if (url.searchParams.get('token') === capability) url.searchParams.delete('token');
        return new URL(url.pathname + url.search, upstream.origin);
    }
    function headers(req) {
        const h = { ...req.headers, host: upstream.host, 'accept-encoding': 'identity' };
        if (h.origin) h.origin = upstream.origin;
        delete h.referer; delete h.cookie; delete h.connection; delete h.upgrade; delete h['transfer-encoding']; delete h['proxy-authorization'];
        return h;
    }
    const server = http.createServer(async (req, res) => {
        const url = target(req);
        if (!url) { res.writeHead(403).end('Outside configured hub.'); return; }
        if (url.pathname === upstream.pathname + 'api/auth') {
            try {
                if (req.method !== 'POST' || req.headers.origin && req.headers.origin !== origin) throw Error();
                let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 16384) throw Error(); }
                if (!equal(JSON.parse(body).accessToken, capability)) throw Error();
                const token = await client.authenticate();
                res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ token }));
            } catch { res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Unable to sign in with the saved profile. Edit its token and retry.' })); }
            return;
        }
        const abort = new AbortController();
        res.on('close', () => abort.abort());
        try {
            const incoming = await network.request(url, { method: req.method, headers: headers(req), signal: abort.signal, body: ['GET', 'HEAD'].includes(req.method) ? undefined : req });
            const h = { ...incoming.headers };
            delete h.connection; delete h['transfer-encoding'];
            if (h.location) { const location = new URL(h.location, url); if (location.origin === upstream.origin && location.pathname.startsWith(upstream.pathname)) h.location = origin + location.pathname + location.search + location.hash; }
            // Browser storage is local to this connection's random loopback port.
            delete h['set-cookie'];
            if (String(h['content-type']).includes('text/html')) {
                const chunks = [];
                incoming.body.on('data', chunk => chunks.push(chunk));
                incoming.body.on('end', () => {
                    try {
                        let bytes = Buffer.concat(chunks);
                        const zlib = require('node:zlib');
                        if (h['content-encoding'] === 'gzip') bytes = zlib.gunzipSync(bytes);
                        if (h['content-encoding'] === 'br') bytes = zlib.brotliDecompressSync(bytes);
                        if (h['content-encoding'] === 'deflate') bytes = zlib.inflateSync(bytes);
                        const bridge = `<script>(${findBridge.toString()})();(${websiteBridge.toString()})(${JSON.stringify(upstream.href).replace(/</g, '\\u003c')});</script>`;
                        const body = bytes.toString('utf8').split(upstream.origin).join(origin).replace(/<\/body>/i, bridge + '</body>');
                        delete h['content-length']; delete h['content-encoding']; delete h.etag;
                        h['cache-control'] = 'no-store';
                        res.writeHead(incoming.statusCode, h).end(body);
                    } catch { res.writeHead(502).end('Unable to load hub website.'); }
                });
            } else { res.writeHead(incoming.statusCode, h); incoming.body.pipe(res); }
            incoming.body.on('error', () => res.destroy());
        } catch { if (!res.headersSent) res.writeHead(502); res.end('Hub website is unavailable. Check the connection and HAPI proxy setting.'); }
    });
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    server.on('upgrade', async (req, socket, head) => {
        const url = target(req);
        if (!url) { socket.destroy(); return; }
        const abort = new AbortController(); socket.on('close', () => abort.abort());
        try {
            const { headers: responseHeaders, socket: remote } = await network.upgrade(url, { headers: headers(req), protocol: req.headers.upgrade || 'websocket', signal: abort.signal });
            sockets.add(remote); remote.on('close', () => sockets.delete(remote));
            socket.write('HTTP/1.1 101 Switching Protocols\r\n' + Object.entries(responseHeaders).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
            if (head.length) remote.write(head);
            socket.pipe(remote).pipe(socket);
            socket.on('error', () => remote.destroy()); remote.on('error', () => socket.destroy());
            socket.on('close', () => remote.destroy()); remote.on('close', () => socket.destroy());
        } catch { socket.destroy(); }
    });
    const listen = port => new Promise((resolve, reject) => {
        const failed = error => { server.removeListener('listening', ready); reject(error); };
        const ready = () => { server.removeListener('error', failed); resolve(); };
        server.once('error', failed); server.once('listening', ready); server.listen(port, '127.0.0.1');
    });
    try { await listen(preferredPort); } catch (error) { if (preferredPort && ['EADDRINUSE', 'EACCES'].includes(error.code)) await listen(0); else throw error; }
    origin = `http://127.0.0.1:${server.address().port}`;
    return {
        base: origin + upstream.pathname,
        port: server.address().port,
        loginUrl(remoteUrl) { const url = new URL(remoteUrl); if (url.origin !== upstream.origin || !url.pathname.startsWith(upstream.pathname)) throw Error('Outside configured hub.'); url.host = new URL(origin).host; url.protocol = 'http:'; url.searchParams.set('token', capability); return url.href; },
        dispose() { for (const socket of sockets) socket.destroy(); server.close(); if (!client.network) network.dispose(); }
    };
}
module.exports = { websiteProxy };
