'use strict';
const http = require('node:http');
const { randomUUID } = require('node:crypto');

async function mockHub(prefix = '/', token = 'test-key', host = '127.0.0.1') {
    const sessions = new Map(); const messages = new Map(); const streams = new Set(); const requests = [];
    let authCount = 0; let jwt = `test-jwt-${randomUUID()}`;
    function event(data) {
        for (const stream of streams) if (stream.sessionId === data.sessionId || !data.sessionId) stream.res.write(`id: test:${Date.now()}:namespace\ndata: ${JSON.stringify(data)}\n\n`);
    }
    function addSession(id = randomUUID()) {
        const session = { id, active: true, thinking: false, metadata: { name: `Chat ${id}`, path: '/workspace', host: 'mock-machine', machineId: 'machine', flavor: 'codex', capabilities: { concurrentClients: true } }, agentState: { requests: {} } };
        sessions.set(id, session); messages.set(id, []); return session;
    }
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (!url.pathname.startsWith(prefix)) { res.writeHead(404).end('{}'); return; }
        const route = url.pathname.slice(prefix.length);
        let body = ''; for await (const chunk of req) body += chunk;
        const data = body ? JSON.parse(body) : {};
        requests.push({ method: req.method, route, auth: req.headers.authorization, data, query: Object.fromEntries(url.searchParams) });
        const json = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value)); };
        if (req.method === 'GET' && (route === '' || /^sessions\/[a-zA-Z0-9-]+$/.test(route))) {
            res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Mock hub website</title><p>Isolated browser navigation fixture</p><script>(async()=>{const accessToken=new URLSearchParams(location.search).get('token');if(accessToken){const r=await fetch(${JSON.stringify(prefix + 'api/auth')},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accessToken})});document.body.dataset.authenticated=String(r.ok);if(r.ok){const{token}=await r.json();const view=crypto.randomUUID();const media=matchMedia('(prefers-color-scheme: dark)');let pipes='starting';const report=()=>fetch(${JSON.stringify(prefix + 'api/sessions')}+'?scheme='+(media.matches?'dark':'light')+'&view='+view+'&page='+encodeURIComponent(location.pathname)+'&pipes='+pipes,{headers:{Authorization:'Bearer '+token}});media.addEventListener('change',report);await report();const openPipe=async sessionId=>{const r=await fetch(${JSON.stringify(prefix+'api/events')}+'?sessionId='+encodeURIComponent(sessionId),{headers:{Authorization:'Bearer '+token,Accept:'text/event-stream'}});const reader=r.body.getReader();await reader.read();void(async()=>{try{while(!(await reader.read()).done){}}catch{}})();};await Promise.all([openPipe('all'),openPipe(${JSON.stringify(route.startsWith('sessions/')?route.slice(9):'all')})]);if(${JSON.stringify(sessions.has(route.slice(9)))}){await fetch(${JSON.stringify(prefix+'api/'+route+'/messages')},{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({text:'Native browser transport check',localId:crypto.randomUUID()})});}pipes='ready';await report();}}})().catch(()=>{});</script>`); return;
        }
        if (route === 'api/auth') {
            authCount++;
            if (data.accessToken !== token) return json({ error: 'Denied' }, 401);
            return json({ token: jwt });
        }
        if (req.headers.authorization !== `Bearer ${jwt}`) return json({ error: 'Denied' }, 401);
        if (route === 'api/sessions') return json({ sessions: [...sessions.values()] });
        if (route === 'api/machines') return json({ machines: [{ id: 'machine', active: true, metadata: { host: 'mock-machine', homeDir: '/workspace', workspaceRoots: ['/workspace'] } }] });
        if (route === 'api/machines/machine/agent-availability') return json({ agents: [{ agent: 'codex', available: true }] });
        if (route === 'api/machines/machine/spawn') { const s = addSession(); return json({ type: 'success', sessionId: s.id }); }
        if (route === 'api/events') {
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            res.write(`data: ${JSON.stringify({ type: 'connection-changed', data: { status: 'connected', resume: 'gap' } })}\n\n`);
            const stream = { sessionId: url.searchParams.get('sessionId'), res }; streams.add(stream);
            res.on('close', () => streams.delete(stream)); return;
        }
        const match = /^api\/sessions\/([^/]+)(?:\/(.*))?$/.exec(route);
        const id = match && decodeURIComponent(match[1]); const action = match?.[2];
        if (!id || !sessions.has(id)) return json({ error: 'Not found' }, 404);
        const session = sessions.get(id);
        if (!action) return json({ session });
        if (action === 'messages' && req.method === 'GET') {
            const all = messages.get(id);
            let rows = all;
            const after = Number(url.searchParams.get('afterSeq')); const before = Number(url.searchParams.get('beforeSeq'));
            const direction = url.searchParams.has('afterSeq') ? 'after' : url.searchParams.has('beforeSeq') ? 'before' : 'latest';
            if (direction === 'after') rows = rows.filter(m => m.seq > after);
            if (direction === 'before') rows = rows.filter(m => m.seq < before);
            const limit = Number(url.searchParams.get('limit') || 200);
            const hasMore = rows.length > limit;
            rows = direction === 'after' ? rows.slice(0, limit) : rows.slice(-limit);
            return json({ messages: rows, page: { direction, limit, epoch: 0, reset: false, hasMore,
                nextBeforeSeq: rows[0]?.seq ?? null, nextBeforeAt: rows[0]?.createdAt ?? null,
                nextAfterSeq: rows.at(-1)?.seq ?? after, nextAfterAt: rows.at(-1)?.createdAt ?? Number(url.searchParams.get('afterAt')),
                snapshotHeadSeq: all.at(-1)?.seq ?? null, snapshotHeadAt: all.at(-1)?.createdAt ?? null } });
        }
        if (action === 'messages' && req.method === 'POST') {
            const all = messages.get(id);
            if (!all.some(m => m.localId === data.localId)) {
                const message = { id: randomUUID(), localId: data.localId, seq: all.length + 1, createdAt: Date.now(), invokedAt: Date.now(), content: { role: 'user', content: { type: 'text', text: data.text } } };
                all.push(message); event({ type: 'message-received', sessionId: id, message });
                const response = { id: randomUUID(), seq: all.length + 1, createdAt: Date.now(), content: { role: 'agent', content: { type: 'codex', data: { type: 'message', message: `Reply: ${data.text}` } } } };
                all.push(response); event({ type: 'message-received', sessionId: id, message: response });
            }
            return json({ ok: true });
        }
        if (['resume', 'reopen'].includes(action)) { session.active = true; return json({ type: 'success', sessionId: id, ok: true }); }
        if (action === 'archive') { session.active = false; return json({ ok: true }); }
        if (action === 'abort') { session.thinking = false; return json({ ok: true }); }
        if (action.startsWith('permissions/')) { delete session.agentState.requests[decodeURIComponent(action.split('/')[1])]; return json({ ok: true }); }
        return json({}, 404);
    });
    await new Promise(resolve => server.listen(0, host, resolve));
    return { url: `http://${host}:${server.address().port}${prefix}`, token, sessions, messages, requests, event, addSession,
        get authCount() { return authCount; }, rotateJwt: () => { jwt = randomUUID(); },
        close: () => new Promise(resolve => { for (const s of streams) s.res.end(); server.close(resolve); server.closeAllConnections(); }) };
}
module.exports = { mockHub };
