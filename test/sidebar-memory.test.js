'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
test('restoring 32 chat descriptors loads one website and bounds clean pages while switching', () => {
    const elements = new Map(), requests = [];
    const element = () => ({ dataset: {}, style: {}, classList: { toggle() {} }, options: [{ value: '' }, { value: '1' }],
        children: [], addEventListener() {}, setAttribute() {}, contains() { return false; }, focus() {},
        replaceChildren(...nodes) { this.children = nodes; }, append(node) { this.children.push(node); }, remove() { this.removed = true; },
        contentWindow: { postMessage(data, origin) { requests.push({ source: this, data, origin }); } } });
    const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
        createElement: element, addEventListener() {}, body: element(), documentElement: element() };
    let receive;
    const window = { origin: 'vscode-webview://test', addEventListener(name, fn) { if (name === 'message') receive = fn; } };
    const context = vm.createContext({ document, window, URL, setInterval() {}, acquireVsCodeApi: () => ({ postMessage() {}, setState() {} }) });
    for (const file of ['frame-cache.js', 'sidebar.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../media', file), 'utf8'), context);
    const entries = Array.from({ length: 32 }, (_, n) => ({ id: String(n), connectionId: 'profile', title: 'chat', url: `http://127.0.0.1:${10000 + n}/` }));
    const show = id => receive({ origin: window.origin, data: { type: 'state', entries, activeId: id, profiles: [{ id: 'profile', name: 'test' }], selected: 'profile' } });
    show('20'); assert.equal(vm.runInContext('frames.size', context), 1);
    assert.equal(elements.get('frames').children[0].src, entries[20].url);
    for (let n = 0; n < 8; n++) {
        show(String(n));
        for (const request of requests.splice(0)) receive({ origin: request.origin, source: request.source,
            data: { type: 'hapi-can-suspend', requestId: request.data.requestId, safe: true } });
        assert.ok(vm.runInContext('frames.size', context) <= 4);
        assert.equal(vm.runInContext(`frames.has('${n}')`, context), true);
    }
    assert.equal(entries.length, 32, 'Eviction keeps every saved chat descriptor.');
});
