'use strict';

const { randomUUID } = require('node:crypto');

function normalizeUrl(input) {
    let url;
    try { url = new URL(input.trim()); } catch { throw new Error('Enter a complete HAPI URL, including http:// or https://.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('Use an HTTP(S) hub URL without credentials, query parameters or fragments. Enter the token separately.');
    }
    url.pathname = url.pathname.replace(/\/+$/, '') + '/';
    return url.href;
}

class HapiError extends Error {
    constructor(status, code) {
        const known = {
            outside_workspace_roots: 'Choose a directory inside this runner’s configured workspace roots.',
            agent_unavailable: 'This agent is unavailable on the selected machine. Check its installation and login.',
            runner_upgrade_required: 'Update the HAPI runner on this machine to use this feature.',
            machine_offline: 'The selected machine’s runner is offline.',
            resume_failed: 'The native session could not be resumed. It may still have a writer in another client. Check it in the hub.'
        };
        const hint = Object.hasOwn(known, code) ? known[code] : status === 401 ? 'Access denied. Check this connection’s token.'
            : status === 403 ? 'This token cannot access the requested resource.'
            : status === 404 ? 'Resource not found. Check the hub URL and session.'
            : [502, 503, 504].includes(status) ? 'The hub or runner is unavailable. Try again when it is online.'
            : `HAPI request failed (HTTP ${status}).`;
        super(hint + (typeof code === 'string' && /^[a-z0-9_]{1,80}$/i.test(code) ? ` Code: ${code}.` : ''));
        this.status = status;
        this.code = code;
    }
}

// SSE framing is incremental: UTF-8 and CRLF may both cross network chunks.
class SseParser {
    constructor(onEvent) { this.onEvent = onEvent; this.buffer = ''; }
    feed(chunk) {
        this.buffer += chunk;
        if (this.buffer.length > 4 * 1024 * 1024) throw new Error('HAPI event exceeded the client size limit.');
        let match;
        while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
            const frame = this.buffer.slice(0, match.index);
            this.buffer = this.buffer.slice(match.index + match[0].length);
            const lines = frame.split(/\r?\n/);
            const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
            const id = lines.find(line => line.startsWith('id:'))?.slice(3).replace(/^ /, '');
            if (data) {
                try { this.onEvent(JSON.parse(data), id); } catch (error) {
                    if (!(error instanceof SyntaxError)) throw error;
                }
            }
        }
    }
}

class HapiClient {
    constructor(url, getSecret, fetcher = fetch) {
        this.url = normalizeUrl(url);
        this.getSecret = getSecret;
        this.fetch = fetcher;
        this.jwt = undefined;
        this.authPromise = undefined;
        this.controller = new AbortController();
    }
    endpoint(relative) { return new URL(relative.replace(/^\//, ''), this.url); }
    async authenticate() {
        if (this.authPromise) return this.authPromise;
        this.authPromise = (async () => {
            const accessToken = await this.getSecret();
            if (!accessToken) throw new Error('No token saved. Edit this HAPI connection.');
            const result = await this.raw('api/auth', 'POST', { accessToken });
            if (typeof result.token !== 'string' || !result.token) throw new Error('The hub returned an invalid login response. Check the HAPI URL.');
            this.jwt = result.token;
            return this.jwt;
        })().finally(() => { this.authPromise = undefined; });
        return this.authPromise;
    }
    async response(relative, options = {}) {
        try {
            return await this.fetch(this.endpoint(relative), {
                ...options,
                redirect: 'error', // Never forward credentials to a different host/path through redirects.
                signal: AbortSignal.any([this.controller.signal, options.signal || AbortSignal.timeout(60_000)])
            });
        } catch {
            throw new Error(this.controller.signal.aborted ? 'Connection closed.' : 'Could not reach HAPI. Check the address, network and HTTPS certificate.');
        }
    }
    async raw(relative, method = 'GET', body, jwt, signal) {
        const response = await this.response(relative, {
            method, signal,
            headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {})
        });
        let data;
        try { data = await response.json(); } catch {
            if (response.ok) throw new Error('The address returned a page instead of the HAPI API. Check the full hub URL.');
            throw new HapiError(response.status || 502);
        }
        if (!response.ok) throw new HapiError(response.status, data?.code);
        // Do not echo arbitrary server error text. It may contain secrets or transcripts.
        if (data?.type === 'error' || data?.success === false) throw new HapiError(502, data.code);
        return data;
    }
    async request(relative, method = 'GET', body) {
        if (!this.jwt) await this.authenticate();
        const used = this.jwt;
        try { return await this.raw(relative, method, body, used); } catch (error) {
            if (!(error instanceof HapiError) || error.status !== 401) throw error;
            // Retry ONLY a rejected authentication request; never replay ambiguous writes.
            if (this.jwt === used) await this.authenticate();
            return this.raw(relative, method, body, this.jwt);
        }
    }
    sessions() { return this.request('api/sessions?limit=500'); }
    machines() { return this.request('api/machines'); }
    session(id) { return this.request(`api/sessions/${encodeURIComponent(id)}`); }
    messages(id, cursor = {}) {
        const params = new URLSearchParams({ limit: '200', ...cursor });
        return this.request(`api/sessions/${encodeURIComponent(id)}/messages?${params}`);
    }
    send(id, text, localId = randomUUID()) { return this.request(`api/sessions/${encodeURIComponent(id)}/messages`, 'POST', { text, localId }); }
    action(id, action, body = {}) { return this.request(`api/sessions/${encodeURIComponent(id)}/${action}`, 'POST', body); }
    permission(id, requestId, approve, body = {}) {
        return this.action(id, `permissions/${encodeURIComponent(requestId)}/${approve ? 'approve' : 'deny'}`, body);
    }
    spawn(machineId, directory, agent) {
        return this.request(`api/machines/${encodeURIComponent(machineId)}/spawn`, 'POST', { directory, agent, startingMode: 'remote' });
    }
    subscribe(sessionId, onEvent, onStatus) {
        const controller = new AbortController();
        const signal = AbortSignal.any([this.controller.signal, controller.signal]);
        let cursor;
        const loop = async () => {
            let attempt = 0;
            while (!signal.aborted) {
                let watchdog;
                let connectionTimeout;
                let reader;
                const attemptController = new AbortController();
                try {
                    if (!this.jwt) await this.authenticate();
                    const used = this.jwt;
                    const params = new URLSearchParams({ sessionId, visibility: 'hidden' });
                    connectionTimeout = setTimeout(() => attemptController.abort(), 10_000);
                    const response = await this.response(`api/events?${params}`, {
                        headers: { Accept: 'text/event-stream', 'Accept-Encoding': 'identity', Authorization: `Bearer ${used}`, ...(cursor ? { 'Last-Event-ID': cursor } : {}) },
                        signal: AbortSignal.any([signal, attemptController.signal])
                    });
                    clearTimeout(connectionTimeout);
                    if (response.status === 401) { if (this.jwt === used) await this.authenticate(); throw new HapiError(401); }
                    if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new HapiError(response.status || 502);
                    attempt = 0;
                    onStatus(true);
                    const parser = new SseParser((event, id) => {
                        onEvent(event);
                        if (id !== undefined) cursor = id;
                    });
                    const decoder = new TextDecoder();
                    reader = response.body.getReader();
                    const touch = () => { clearTimeout(watchdog); watchdog = setTimeout(() => attemptController.abort(), 90_000); };
                    touch();
                    while (!signal.aborted) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        touch();
                        parser.feed(decoder.decode(value, { stream: true }));
                    }
                } catch { if (!signal.aborted) onStatus(false); }
                finally {
                    clearTimeout(connectionTimeout); clearTimeout(watchdog);
                    attemptController.abort();
                    if (reader) await reader.cancel().catch(() => {});
                }
                if (signal.aborted) break;
                onStatus(false);
                const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5));
                await new Promise(resolve => {
                    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
                    const timer = setTimeout(finish, delay);
                    signal.addEventListener('abort', finish, { once: true });
                });
            }
        };
        void loop();
        return { dispose: () => controller.abort() };
    }
    dispose() { this.controller.abort(); this.jwt = undefined; }
}

module.exports = { HapiClient, HapiError, normalizeUrl, SseParser };
