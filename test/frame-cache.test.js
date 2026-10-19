'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { HapiFrameCache } = require('../media/frame-cache');
test('evicts only acknowledged clean hidden websites, keeping the active page and busy drafts', () => {
    const requests = [], removed = [], frames = new Map();
    for (let n = 0; n < 8; n++) frames.set(String(n), { src: `http://127.0.0.1:${10000 + n}/`,
        contentWindow: { postMessage: (data, origin) => requests.push({ id: String(n), data, origin }) }, remove: () => removed.push(String(n)) });
    const cache = new HapiFrameCache(frames, 4); cache.trim('7');
    assert.equal(requests.length, 7); assert.equal(frames.size, 8, 'No website closes before acknowledgement.');
    const answer = (request, safe, active = '7') => cache.acknowledge(request.id, { requestId: request.data.requestId, safe }, active);
    answer(requests[0], false); // an unsent draft, recording or terminal
    for (const request of requests.slice(1)) answer(request, true);
    assert.equal(frames.size, 4); assert.ok(frames.has('0')); assert.ok(frames.has('7'));
    assert.equal(removed.includes('7'), false);
    cache.acknowledge('0', { requestId: 'unsolicited', safe: true }, '7'); assert.ok(frames.has('0'));
});
test('a page selected while its suspension acknowledgement is in flight stays loaded', () => {
    let request;
    const frames = new Map([['a', { src: 'http://127.0.0.1:1234/', contentWindow: { postMessage: data => { request = data; } }, remove: () => assert.fail('Active website removed') }], ['b', {}]]);
    const cache = new HapiFrameCache(frames, 1); cache.trim('b');
    cache.acknowledge('a', { requestId: request.requestId, safe: true }, 'a');
    assert.equal(frames.size, 2);
});
