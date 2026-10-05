'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { groupSessions } = require('../src/folders');
test('project groups respect Windows case, POSIX case, and distinct runner machines', () => {
    const s = (id, path, machineId = 'a', active = false) => ({ id, metadata: { path, machineId }, active });
    const groups = groupSessions([s('one', 'C:\\work\\Repo\\'), s('two', 'c:/work/repo', 'a', true), s('other-machine', 'C:/work/Repo', 'b'), s('lower', '/work/repo'), s('upper', '/work/Repo'), s('missing')]);
    assert.equal(groups.length, 5); const windows = groups.find(g => g.sessions.some(s => s.id === 'one'));
    assert.deepEqual(windows.sessions.map(s => s.id), ['two', 'one']); assert.equal(windows.name, 'Repo');
    assert.equal(groups.find(g => g.sessions[0].id === 'missing').name, 'No working directory');
});
