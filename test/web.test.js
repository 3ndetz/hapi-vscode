'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webUrl, chatMode, openWeb, BROWSER_COMMAND } = require('../src/web');

test('website mode is default, custom is explicit, and hub prefixes stay intact', () => {
    const vscode = value => ({ workspace: { getConfiguration: () => ({ get: (_, fallback) => value ?? fallback }) } });
    assert.equal(chatMode(vscode()), 'web'); assert.equal(chatMode(vscode('custom')), 'custom'); assert.equal(chatMode(vscode('unknown')), 'web');
    assert.equal(webUrl('https://hapi.example/workflow/1', 'a/b'), 'https://hapi.example/workflow/1/sessions/a%2Fb');
    assert.equal(webUrl('https://hapi.example/workflow/2/', 'new'), 'https://hapi.example/workflow/2/sessions/new');
    assert.equal(webUrl('https://hapi.example/'), 'https://hapi.example/');
    assert.throws(() => webUrl('https://hapi.example/?token=private', 'chat'));
});
test('each website opens in a native browser tab with no credentials or injected scripts', async () => {
    const calls = [];
    const vscode = { commands: { getCommands: async () => [BROWSER_COMMAND], executeCommand: async (...args) => calls.push(args) } };
    await openWeb(vscode, 'https://first.example/path/', 'chat-a');
    await openWeb(vscode, 'https://second.example/', 'chat-b');
    assert.deepEqual(calls, [[BROWSER_COMMAND, 'https://first.example/path/sessions/chat-a'], [BROWSER_COMMAND, 'https://second.example/sessions/chat-b']]);
});
test('missing integrated browser has a clear error and never silently changes the selected mode', async () => {
    const vscode = { commands: { getCommands: async () => [] } };
    await assert.rejects(() => openWeb(vscode, 'https://hapi.example/', 'chat'), /integrated browser/);
});
