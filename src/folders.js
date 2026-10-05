'use strict';
function groupSessions(sessions) {
    const groups = new Map();
    for (const session of sessions) {
        const directory = session.metadata?.path?.trim() || '';
        const windows = /^[a-z]:[\\/]|^\\\\/i.test(directory);
        const normalized = directory.replace(/\\/g, '/').replace(/\/+$/, '') || (directory ? '/' : '');
        // The same directory on different runner machines is a separate project.
        const key = JSON.stringify([session.metadata?.machineId || session.metadata?.host || '', windows ? normalized.toLowerCase() : normalized]);
        if (!groups.has(key)) groups.set(key, { key, directory, machine: session.metadata?.host || session.metadata?.machineId || '', name: normalized.split('/').filter(Boolean).at(-1) || (directory || 'No working directory'), sessions: [] });
        groups.get(key).sessions.push(session);
    }
    for (const group of groups.values()) group.sessions.sort((a, b) => Number(b.active) - Number(a.active) || (b.updatedAt || 0) - (a.updatedAt || 0));
    return [...groups.values()].sort((a, b) => a.directory.localeCompare(b.directory));
}
module.exports = { groupSessions };
