'use strict';
const http = require('node:http'), net = require('node:net');
async function mockProxy() {
    const requests = [], sockets = new Set();
    const server = http.createServer((_, res) => res.writeHead(502).end());
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    server.on('connect', (req, socket, head) => {
        requests.push({ target: req.url, auth: req.headers['proxy-authorization'] });
        const url = new URL('http://' + req.url);
        const remote = net.connect(Number(url.port), url.hostname);
        sockets.add(remote); remote.on('close', () => sockets.delete(remote));
        remote.on('connect', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) remote.write(head); socket.pipe(remote).pipe(socket); });
        remote.on('error', () => socket.destroy()); socket.on('error', () => remote.destroy());
        socket.on('close', () => remote.destroy()); remote.on('close', () => socket.destroy());
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${server.address().port}`, requests, close: async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}
module.exports = { mockProxy };
