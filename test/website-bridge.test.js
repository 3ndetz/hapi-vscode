'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { websiteBridge } = require('../src/website-bridge');

function page({ supported = true, topLevel = false, storageBlocked = false } = {}) {
    const messages = [], events = [], values = new Map(), properties = new Map(supported ? [['--app-font-scale', '1']] : []), listeners = new Map();
    const window = { addEventListener: (name, listener) => listeners.set(name, listener), dispatchEvent: event => events.push(event) };
    const parent = topLevel ? window : { postMessage: message => messages.push(message) };
    let report;
    const context = { URL, window, parent, document: { addEventListener: () => {}, documentElement: { style: { getPropertyValue: key => properties.get(key) || '', setProperty: (key, value) => properties.set(key, value) } } },
        location: { pathname: '/sessions/first', href: 'http://127.0.0.1:12345/sessions/first' }, localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { if (storageBlocked) throw Error('Storage unavailable'); values.set(key, value); }, removeItem: key => values.delete(key) },
        StorageEvent: class { constructor(type, data) { Object.assign(this, { type }, data); } }, setInterval: callback => { report = callback; } };
    vm.runInNewContext(`(${websiteBridge.toString()})()`, context);
    return { values, properties, events, messages, report: () => report?.(),
        send: (scale, source = parent) => listeners.get('message')?.({ source, data: { type: 'hapi-set-font-scale', scale } }) };
}

test('font bridge uses native HAPI preferences per website, without changing other windows or top-level browsers', () => {
    const a = page(), b = page(), external = page({ topLevel: true });
    a.report(); assert.equal(a.values.get('hapi-font-scale'), '0.8', 'Fresh embedded websites default to native 80%.');
    a.send(0.8);
    assert.equal(a.values.get('hapi-font-scale'), '0.8'); assert.equal(a.properties.get('--app-font-scale'), '0.8');
    assert.equal(a.events[0].key, 'hapi-font-scale'); assert.equal(a.events[0].newValue, '0.8');
    assert.equal(b.properties.get('--app-font-scale'), '1'); assert.equal(b.values.has('hapi-font-scale'), false);
    external.send(0.8); assert.equal(external.properties.get('--app-font-scale'), '1');
    a.report(); assert.ok(a.messages.some(m => m.type === 'hapi-display' && m.fontScale === 0.8));
    const count = a.messages.length; a.report(); assert.equal(a.messages.length, count, 'Unchanged display state does not spam parent messages.');
    a.send(1); assert.equal(a.values.has('hapi-font-scale'), false); assert.equal(a.events.at(-1).newValue, null);
    a.report(); assert.equal(a.properties.get('--app-font-scale'), '1', 'Explicit 100% is not overwritten by the default.');
    for (const value of [0.7, 1.3, NaN, '0.8']) a.send(value);
    a.send(0.8, {}); assert.equal(a.properties.get('--app-font-scale'), '1', 'Only the parent can set supported native values.');
    const unsupported = page({ supported: false }); unsupported.send(0.8);
    assert.equal(unsupported.values.has('hapi-font-scale'), false); assert.equal(unsupported.properties.size, 0);
    const existing = page(); existing.values.set('hapi-font-scale', '0.9'); existing.properties.set('--app-font-scale', '0.9'); existing.report();
    assert.equal(existing.values.get('hapi-font-scale'), '0.9', 'Existing native font choices remain intact.');
});

test('embedded composer tips are acknowledged before startup, independently of font support', () => {
    for (const embedded of [page(), page({ supported: false })]) {
        assert.equal(embedded.values.get('hapi.fue.v1.scratchlist-toggle'), '1');
        assert.equal(embedded.values.get('hapi.fue.v1.rich-composer-mentions'), '1');
        assert.equal(embedded.values.has('hapi-font-scale'), false, 'Onboarding does not change font preferences.');
    }
    assert.equal(page({ topLevel: true }).values.size, 0, 'External browser onboarding remains untouched.');
    const blocked = page({ storageBlocked: true });
    blocked.report();
    assert.ok(blocked.messages.some(message => message.type === 'hapi-navigation'), 'Storage restrictions do not break navigation.');
});
