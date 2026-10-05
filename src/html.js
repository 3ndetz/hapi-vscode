'use strict';
const { randomBytes } = require('node:crypto');
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function chatHtml(vscode, webview, extensionUri) {
    const nonce = randomBytes(24).toString('base64');
    const asset = name => escape(webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', name)).toString());
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${escape(webview.cspSource)}; script-src 'nonce-${nonce}'; img-src ${escape(webview.cspSource)};">
<link rel="stylesheet" href="${asset('chat.css')}"><title>HAPI Chat</title></head><body>
<header><div><strong id="title">HAPI Chat</strong><div id="connection" class="muted"></div></div><span id="status" role="status">Connecting…</span></header>
<nav aria-label="Chat actions"><button data-action="newChat">New chat</button><button data-action="openChat">Open chat</button><button data-action="switchConnection">Switch hub</button><button data-action="refresh">Refresh</button><button data-action="openBrowser">Open in browser</button><button id="resume" data-action="resume" hidden>Resume</button><button id="takeover" data-action="takeover" hidden>Take remote control</button><button id="stop" data-action="stop" hidden>Stop turn</button></nav>
<div id="error" role="alert" hidden></div><div id="notice" class="muted"></div>
<main id="messages" aria-label="Conversation"><button id="older" hidden>Load older messages</button><div id="rows"></div></main>
<section id="permissions" aria-label="Agent requests"></section>
<form id="composer"><label class="sr-only" for="draft">Message</label><textarea id="draft" rows="3" placeholder="Message the agent. Ctrl+Enter or Cmd+Enter to send."></textarea><div class="composer-footer"><span id="send-status" class="muted"></span><button type="submit" id="send">Send</button></div></form>
<script nonce="${nonce}" src="${asset('chat.js')}"></script></body></html>`;
}
module.exports = { chatHtml };
