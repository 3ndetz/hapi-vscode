'use strict';
async function openAt(manager, item, target, operation = 'open', source) {
    if (!['left', 'window', 'tab'].includes(target) || !['open', 'copy', 'move', 'new'].includes(operation)) throw Error('Unknown chat destination.');
    const entry = source?.entries.find(e => e.id === source.activeId);
    if (operation === 'move' && !entry) return;
    const request = operation === 'new' ? { connectionId: item?.connectionId, directory: item?.directory, sessionId: 'new', title: 'New chat' } : item;
    if (operation === 'move' && target === 'left' && source === manager.sidebar) { await source.reveal(); return source; }
    let destination;
    if (target === 'left') {
        destination = manager.sidebar;
        if (operation === 'move') await destination.adopt(entry);
        else {
            const connection = request?.connectionId ? manager.connections.find(request.connectionId) : manager.connections.selected() || await manager.pickConnection();
            if (!connection) return;
            await destination.open(connection.id, request?.sessionId, request?.title || request?.label, request?.directory);
        }
    } else {
        const vscode = manager.vscode;
        if (target === 'window') await vscode.commands.executeCommand('workbench.action.newGroupRight');
        const column = vscode.window.tabGroups.activeTabGroup.viewColumn || vscode.ViewColumn.Active;
        destination = await manager.openWindow(request, column, operation === 'move' ? entry : undefined);
    }
    if (operation === 'move' && destination && destination !== source) {
        // The destination now owns the same adapter/origin and browser storage.
        source.closeEntry(entry, false);
        if (source.panel) source.panel.dispose();
    }
    return destination;
}
module.exports = { openAt };
