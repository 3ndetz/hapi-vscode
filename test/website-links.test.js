'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { websiteBridge } = require('../src/website-bridge');
const { openExternalLink } = require('../src/external-browser');
function page() {
    const events = new Map(), messages = [], popups = [];
    const context = { URL, location: { href: 'http://127.0.0.1:12345/workflow/1/sessions/first', pathname: '/workflow/1/sessions/first' },
        parent: { postMessage: data => messages.push(data) }, localStorage: { setItem: () => {} }, setInterval: () => {},
        document: { addEventListener: (name, listener) => events.set(name, listener) }, window: { addEventListener: () => {}, open: (...args) => { popups.push(args); return 'popup'; } } };
    vm.runInNewContext(`(${websiteBridge.toString()})('https://hub.example/workflow/1/')`, context);
    return { messages, popups, open: (...args) => context.window.open(...args), click: (href, options = {}) => {
        const anchor = { tagName: 'A', href }, event = { button: 0, defaultPrevented: false, composedPath: () => [anchor], preventDefault() { this.defaultPrevented = true; }, ...options };
        events.get(options.type || 'click')(event); return { anchor, event };
    } };
}
test('external navigation opens outside while same-hub sessions, attachments and handled media keep native behavior', () => {
    const p = page();
    for (const href of ['https://example.com/article', 'https://hub.example/workflow/2/sessions/other', 'http://127.0.0.1:12345/workflow/2/', 'mailto:dev@example.com']) {
        const { event } = p.click(href); assert.equal(event.defaultPrevented, true);
        assert.equal(p.messages.at(-1).type, 'hapi-open-external'); assert.ok(!p.messages.at(-1).url.includes('127.0.0.1'));
    }
    const count = p.messages.length;
    for (const href of ['http://127.0.0.1:12345/workflow/1/sessions/second', 'https://hub.example/workflow/1/sessions/second', 'https://hub.example/workflow/1/api/attachments/image.png', 'blob:http://127.0.0.1:12345/video']) {
        assert.equal(p.click(href).event.defaultPrevented, false);
    }
    assert.equal(p.messages.length, count);
    assert.equal(p.click('https://hub.example/workflow/1/sessions/second').anchor.href, 'http://127.0.0.1:12345/workflow/1/sessions/second');
    p.click('https://images.example/photo.png', { defaultPrevented: true }); assert.equal(p.messages.length, count, 'Media viewers own already-handled clicks.');
    p.click('https://example.com/middle', { type: 'auxclick', button: 1 }); assert.equal(p.messages.length, count + 1);
    assert.equal(p.open('https://example.com/popup'), null); assert.equal(p.popups.length, 0);
    assert.equal(p.open('https://hub.example/workflow/1/sessions/popup'), 'popup'); assert.equal(p.popups.at(-1)[0], 'http://127.0.0.1:12345/workflow/1/sessions/popup');
    assert.equal(p.open('blob:http://127.0.0.1:12345/video'), 'popup'); assert.equal(p.open('', '_blank'), 'popup');
});
test('extension host binds external navigation to the originating hub and rejects privileged or credential URLs', async () => {
    const opened = [], manager = { connections: { find: id => id === 'hub' ? { url: 'https://hub.example/workflow/1/' } : undefined },
        vscode: { Uri: { parse: url => url }, env: { openExternal: async url => { opened.push(url); return true; } } } };
    const entry = { connectionId: 'hub', url: 'http://127.0.0.1:12345/workflow/1/' };
    await openExternalLink(manager, entry, 'https://example.com/article'); assert.deepEqual(opened, ['https://example.com/article']);
    for (const url of ['https://hub.example/workflow/1/sessions/other', 'http://127.0.0.1:12345/workflow/1/']) await openExternalLink(manager, entry, url);
    assert.equal(opened.length, 1);
    await openExternalLink(manager, entry, 'https://hub.example/workflow/2/'); assert.equal(opened.length, 2);
    for (const url of ['file:///secret', 'vscode://command', 'javascript:alert(1)', 'https://name:secret@example.com/']) await assert.rejects(openExternalLink(manager, entry, url), /Unsupported external link/);
    await openExternalLink(manager, { ...entry, connectionId: 'removed' }, 'https://example.com'); assert.equal(opened.length, 2);
});
