'use strict';
const http = require('node:http'), https = require('node:https');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { normalizeUrl } = require('./client');
const equal = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function websiteProxy(client, preferredPort = 0) {
    const upstream = new URL(normalizeUrl(client.url));
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
        delete h.referer; delete h.cookie;
        return h;
    }
    const transport = upstream.protocol === 'https:' ? https : http;
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
        const outgoing = transport.request(url, { method: req.method, headers: headers(req) }, incoming => {
            const h = { ...incoming.headers };
            if (h.location) { const location = new URL(h.location, url); if (location.origin === upstream.origin && location.pathname.startsWith(upstream.pathname)) h.location = origin + location.pathname + location.search + location.hash; }
            // Browser storage is local to this connection's random loopback port.
            delete h['set-cookie'];
            if (String(h['content-type']).includes('text/html')) {
                const chunks = [];
                incoming.on('data', chunk => chunks.push(chunk));
                incoming.on('end', () => {
                    try {
                        let bytes = Buffer.concat(chunks);
                        const zlib = require('node:zlib');
                        if (h['content-encoding'] === 'gzip') bytes = zlib.gunzipSync(bytes);
                        if (h['content-encoding'] === 'br') bytes = zlib.brotliDecompressSync(bytes);
                        if (h['content-encoding'] === 'deflate') bytes = zlib.inflateSync(bytes);
                        const body = bytes.toString('utf8').split(upstream.origin).join(origin);
                        delete h['content-length']; delete h['content-encoding']; delete h.etag;
                        h['cache-control'] = 'no-store';
                        res.writeHead(incoming.statusCode, h).end(body);
                    } catch { res.writeHead(502).end('Unable to load hub website.'); }
                });
            } else { res.writeHead(incoming.statusCode, h); incoming.pipe(res); }
        });
        outgoing.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Hub website is unavailable.'); });
        res.on('close', () => outgoing.destroy()); req.pipe(outgoing);
    });
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    server.on('upgrade', (req, socket, head) => {
        const url = target(req);
        if (!url) { socket.destroy(); return; }
        const outgoing = transport.request(url, { method: 'GET', headers: headers(req) });
        outgoing.on('upgrade', (response, remote, remoteHead) => {
            sockets.add(remote); remote.on('close', () => sockets.delete(remote));
            socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n` + Object.entries(response.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
            if (head.length) remote.write(head); if (remoteHead.length) socket.write(remoteHead);
            socket.pipe(remote).pipe(socket);
            socket.on('error', () => remote.destroy()); remote.on('error', () => socket.destroy());
            socket.on('close', () => remote.destroy()); remote.on('close', () => socket.destroy());
        });
        outgoing.on('response', response => { response.resume(); socket.destroy(); });
        outgoing.on('error', () => socket.destroy()); outgoing.end();
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
        dispose() { for (const socket of sockets) socket.destroy(); server.close(); }
    };
}
module.exports = { websiteProxy };
