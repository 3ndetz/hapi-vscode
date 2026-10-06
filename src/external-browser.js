'use strict';
const { randomUUID } = require('node:crypto');
const { websiteProxy } = require('./proxy');
const { webUrl } = require('./web');

async function openExternalBrowser(manager, entry) {
    const connection = manager.connections.find(entry?.connectionId || manager.connections.selected()?.id);
    if (!connection) throw Error('Choose a saved HAPI connection first.');
    const remote = new URL(webUrl(connection.url, entry?.sessionId));
    if (entry?.directory) remote.searchParams.set('directory', entry.directory);
    let proxy, key, promise;
    try {
        const client = manager.connections.client(connection.id);
        await client.authenticate();
        key = JSON.stringify([connection.id, 'browser-' + randomUUID()]);
        promise = websiteProxy(client); manager.websiteAdapters.set(key, promise);
        proxy = await promise;
    } catch {
        if (key) manager.websiteAdapters.delete(key);
        if (manager.connections.find(connection.id)?.url !== connection.url) throw Error('This HAPI connection changed. Open it again.');
        if (!(await manager.vscode.env.openExternal(manager.vscode.Uri.parse(remote.href)))) throw Error('Unable to open the browser.');
        return { autoLogin: false };
    }
    // This adapter belongs to the extension host, independently of the chat
    // view. Profile edits/removal and extension shutdown dispose it normally.
    if (manager.connections.find(connection.id)?.url !== connection.url || manager.websiteAdapters.get(key) !== promise) {
        proxy.dispose(); manager.websiteAdapters.delete(key); throw Error('This HAPI connection changed. Open it again.');
    }
    try {
        if (!(await manager.vscode.env.openExternal(manager.vscode.Uri.parse(proxy.loginUrl(remote.href))))) throw Error('Unable to open the browser.');
    } catch (error) { proxy.dispose(); manager.websiteAdapters.delete(key); throw error; }
    return { autoLogin: true };
}
module.exports = { openExternalBrowser };
