'use strict';
const { normalizeUrl } = require('./client');
const BROWSER_COMMAND = 'workbench.action.browser.open';

function chatMode(vscode) {
    return vscode.workspace.getConfiguration('hapiChat').get('chatMode', 'web') === 'custom' ? 'custom' : 'web';
}
function webUrl(base, sessionId) {
    const url = normalizeUrl(base);
    return sessionId ? new URL(`sessions/${encodeURIComponent(sessionId)}`, url).href : url;
}
async function openWeb(vscode, base, sessionId) {
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes(BROWSER_COMMAND)) {
        throw new Error('Web mode needs VS Code’s integrated browser. Update desktop VS Code or choose Custom with HAPI: Change Chat Mode.');
    }
    // A real top-level browser page preserves HAPI's own UI, sockets, uploads,
    // storage and browser permissions. Never put an access token into its URL.
    await vscode.commands.executeCommand(BROWSER_COMMAND, webUrl(base, sessionId));
}
module.exports = { chatMode, webUrl, openWeb, BROWSER_COMMAND };
