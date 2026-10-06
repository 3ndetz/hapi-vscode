'use strict';
const { Agent, ProxyAgent, fetch: undiciFetch } = require('undici');
const tls = require('node:tls');

function bypass(url, entries) {
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '::1' || /^127\./.test(host)) return true;
    return entries.some(entry => {
        const value = entry.trim().toLowerCase();
        if (value === '*') return true;
        const [name, port] = value.split(':');
        if (port && port !== (url.port || (url.protocol === 'https:' ? '443' : '80'))) return false;
        const domain = name.replace(/^\*?\./, '');
        return host === domain || host.endsWith('.' + domain);
    });
}

// Own dispatchers avoid VS Code's global fetch/http patches overriding direct mode.
// No global environment, dispatcher or TLS settings are changed.
class Network {
    constructor(settings = () => ({}), env = process.env) { this.settings = settings; this.env = env; this.agents = new Map(); }
    forConnection(mode) {
        // Share owned agents, but resolve this profile's policy on every request.
        return Object.fromEntries(['fetch', 'request', 'upgrade'].map(method => [method, (input, options) => this[method](input, options, mode())]));
    }
    dispatcher(input, mode) {
        const url = new URL(input), s = this.settings(), env = this.env;
        const exclusions = [...(Array.isArray(s.noProxy) ? s.noProxy : []), ...(env.no_proxy || env.NO_PROXY || '').split(',')];
        let proxy;
        const useProxy = mode === 'direct' ? false : mode === 'proxy' ? true : s.useProxy !== false;
        if (useProxy && s.proxySupport !== 'off' && !bypass(url, exclusions)) {
            proxy = s.proxy || (url.protocol === 'https:' ? env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY : env.http_proxy || env.HTTP_PROXY || env.https_proxy || env.HTTPS_PROXY);
        }
        const rejectUnauthorized = s.strictSSL !== false;
        const key = JSON.stringify([proxy || '', s.proxyAuthorization || '', rejectUnauthorized, s.systemCertificates !== false]);
        if (!this.agents.has(key)) {
            const connect = { rejectUnauthorized };
            if (s.systemCertificates !== false && tls.getCACertificates) connect.ca = [...tls.rootCertificates, ...tls.getCACertificates('system')];
            let agent;
            if (proxy) {
                let uri;
                try { uri = new URL(proxy); if (!['http:', 'https:'].includes(uri.protocol)) throw Error(); }
                catch { throw Error('HAPI needs an HTTP(S) proxy URL in VS Code http.proxy, or disable HAPI Chat: Use VS Code Proxy for a direct connection.'); }
                const token = s.proxyAuthorization || (uri.username ? 'Basic ' + Buffer.from(decodeURIComponent(uri.username) + ':' + decodeURIComponent(uri.password)).toString('base64') : undefined);
                uri.username = uri.password = '';
                agent = new ProxyAgent({ uri: uri.href, ...(token ? { token } : {}), requestTls: connect, proxyTls: connect });
            } else agent = new Agent({ connect });
            this.agents.set(key, agent);
        }
        return this.agents.get(key);
    }
    fetch(input, options, mode) { return undiciFetch(input, { ...options, dispatcher: this.dispatcher(input, mode) }); }
    request(input, options, mode) { const url = new URL(input); return this.dispatcher(url, mode).request({ ...options, origin: url.origin, path: url.pathname + url.search, headersTimeout: 60_000, bodyTimeout: 0 }); }
    upgrade(input, options, mode) { const url = new URL(input); return this.dispatcher(url, mode).upgrade({ ...options, origin: url.origin, path: url.pathname + url.search }); }
    dispose() { for (const agent of this.agents.values()) void agent.destroy().catch(() => {}); this.agents.clear(); }
}
function editorNetwork(vscode) {
    return new Network(() => {
        const http = vscode.workspace.getConfiguration('http');
        return { useProxy: vscode.workspace.getConfiguration('hapiChat').get('useVSCodeProxy', true), proxy: http.get('proxy', ''), proxySupport: http.get('proxySupport', 'override'),
            noProxy: http.get('noProxy', []), proxyAuthorization: http.get('proxyAuthorization'), strictSSL: http.get('proxyStrictSSL', true), systemCertificates: http.get('systemCertificates', true) };
    });
}
module.exports = { Network, editorNetwork, bypass };
