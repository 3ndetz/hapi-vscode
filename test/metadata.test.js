'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { Metadata } = require('../src/metadata');
test('atomic metadata preserves every profile and tab through late native snapshots and reloads', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-metadata-'));
    const legacyValues = { connections: [{ id: 'old', name: 'Old hub', url: 'https://hub.example/' }], selected: 'old' };
    const legacy = { get: key => legacyValues[key], update: async () => { throw Error('Desktop storage must not use Memento writes.'); } };
    try {
        const state = new Metadata(legacy, { fsPath: directory });
        assert.equal(state.get('connections')[0].id, 'old', 'Existing profiles migrate, keeping their SecretStorage identifiers.');
        await Promise.all([
            state.update('connections', [...state.get('connections'), { id: 'new', name: 'New hub', url: 'https://other.example/' }]),
            state.update('selected', 'new'),
            state.update('sidebarTabs', { entries: [{ connectionId: 'new', sessionId: 'chat' }] }),
            state.update('sidebarProxyPorts', { new: 12345 })
        ]);
        legacyValues.connections = []; legacyValues.selected = 'old';
        const restored = new Metadata(legacy, { fsPath: directory });
        assert.equal(restored.get('connections').length, 2); assert.equal(restored.get('selected'), 'new');
        assert.equal(restored.get('sidebarTabs').entries[0].sessionId, 'chat'); assert.equal(restored.get('sidebarProxyPorts').new, 12345);
        await assert.rejects(state.update('token', 'private-key'), /Unsupported/);
        assert.ok(!fs.readFileSync(path.join(directory, 'metadata.json'), 'utf8').includes('private-key'));
    } finally { fs.unlinkSync(path.join(directory, 'metadata.json')); fs.rmdirSync(directory); }
});
