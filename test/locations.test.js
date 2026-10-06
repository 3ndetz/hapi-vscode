'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { openAt } = require('../src/locations');
test('chat destinations separate new groups from tabs and close a moved source only after successful adoption', async () => {
    const entry = { id: 'view', connectionId: 'hub', sessionId: 'same', directory: '/project', adapterId: 'adapter' };
    const calls = [], source = { entries: [entry], activeId: entry.id, closeEntry: (e, release) => { assert.equal(release, false); calls.push('close'); source.entries = []; }, panel: { dispose: () => calls.push('dispose') } };
    const sidebar = { adopt: async e => { assert.equal(e, entry); calls.push('adopt'); }, open: async (...args) => calls.push(args), reveal: async () => calls.push('reveal') };
    const group = { viewColumn: 2 }, manager = { sidebar, connections: { find: id => ({ id }), selected: () => ({ id: 'hub' }) },
        vscode: { ViewColumn: { Active: -1 }, window: { tabGroups: { activeTabGroup: group } }, commands: { executeCommand: async name => { assert.equal(name, 'workbench.action.newGroupRight'); group.viewColumn++; calls.push('group'); } } },
        openWindow: async (item, column, transferred) => { calls.push({ item, column, transferred }); return {}; } };
    await openAt(manager, entry, 'tab', 'copy', source);
    assert.equal(calls[0].column, 2); assert.equal(calls[0].transferred, undefined); assert.equal(source.entries.length, 1);
    calls.length = 0;
    await openAt(manager, entry, 'window', 'new', source);
    assert.equal(calls[0], 'group'); assert.equal(calls[1].column, 3); assert.equal(calls[1].item.sessionId, 'new'); assert.equal(calls[1].item.directory, '/project');
    calls.length = 0;
    manager.openWindow = async () => { throw Error('Failed to open'); };
    await assert.rejects(openAt(manager, entry, 'tab', 'move', source), /Failed to open/);
    assert.equal(source.entries.length, 1); assert.equal(calls.length, 0);
    await openAt(manager, entry, 'left', 'move', source);
    assert.deepEqual(calls, ['adopt', 'close', 'dispose']);
    assert.equal(source.entries.length, 0);
    await assert.rejects(openAt(manager, entry, 'outside'), /Unknown chat destination/);
});
