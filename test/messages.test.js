'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decodeMessage, mergeMessages } = require('../src/messages');
const { MessageWindow } = require('../src/window');
const msg = (id, content, props = {}) => ({ id, seq: Number(id) || 1, createdAt: 10, content, ...props });
test('native Codex, Claude, user and unfamiliar envelopes are safe plain text', () => {
    assert.equal(decodeMessage(msg('1', { role: 'user', content: { type: 'text', text: '<script>unsafe</script>' } }))[0].text, '<script>unsafe</script>');
    assert.equal(decodeMessage(msg('2', { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'Hello' } } }))[0].text, 'Hello');
    assert.equal(decodeMessage(msg('3', { role: 'agent', content: { type: 'codex', data: { type: 'token_count' } } })).length, 0);
    const claude = decodeMessage(msg('4', { role: 'agent', content: { type: 'output', data: { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }, { type: 'tool_use', name: 'Read', input: { path: '/x' } }] } } } }));
    assert.equal(claude[0].text, 'Hello'); assert.equal(claude[1].kind, 'tool: Read');
    assert.equal(decodeMessage(msg('5', { future: 'payload' }))[0].text, '{\n  "future": "payload"\n}');
});
test('optimistic echoes reconcile by localId and invokedAt controls display order', () => {
    const pending = msg('local', {}, { localId: 'local', seq: null });
    const real = msg('server', {}, { localId: 'local', seq: 1, invokedAt: 30 });
    const other = msg('2', {}, { createdAt: 20 });
    const result = mergeMessages([pending, other], [real]);
    assert.deepEqual(result.map(m => m.id), ['2', 'server']);
});
function page(rows, props = {}) {
    return { messages: rows, page: { direction: 'latest', epoch: 0, reset: false, hasMore: false, nextBeforeSeq: rows[0]?.seq ?? null, nextBeforeAt: rows[0]?.createdAt ?? null,
        nextAfterSeq: rows.at(-1)?.seq ?? null, nextAfterAt: rows.at(-1)?.createdAt ?? null, snapshotHeadSeq: rows.at(-1)?.seq ?? null, snapshotHeadAt: rows.at(-1)?.createdAt ?? null, ...props } };
}
test('catch-up includes missed messages when live SSE overtakes REST; compound cursors bound the snapshot', async () => {
    const w = new MessageWindow(); w.apply(page([msg('1', {})])); w.ingest([msg('5', {}, { createdAt: 50 })]);
    const calls = [];
    const client = { messages: async (id, cursor) => {
        calls.push(cursor);
        if (calls.length === 1) return page([msg('2', {}, { createdAt: 20 })], { direction: 'after', hasMore: true, snapshotHeadSeq: 4, snapshotHeadAt: 40 });
        return page([msg('3', {}, { createdAt: 30 }), msg('4', {}, { createdAt: 40 })], { direction: 'after' });
    } };
    await w.sync(client, 'session');
    assert.equal(calls[0].afterSeq, '1'); assert.equal(calls[1].untilSeq, '4');
    assert.deepEqual(w.messages.map(m => m.id), ['1', '2', '3', '4', '5']);
});
test('epoch reset removes stale history and old pagination cursors', async () => {
    const w = new MessageWindow(); w.apply(page([msg('1', {})], { hasMore: true }));
    await w.sync({ messages: async () => page([msg('8', {})], { epoch: 1, reset: true }) }, 'session');
    assert.deepEqual(w.messages.map(m => m.id), ['8']); assert.equal(w.epoch, 1);
    assert.equal(w.before.seq, 8);
});
test('a broken cursor fails rather than spinning; queued consumption and cancellation update rows', async () => {
    const w = new MessageWindow(); w.apply(page([msg('1', {}, { localId: 'local', invokedAt: null })]));
    await assert.rejects(() => w.sync({ messages: async () => page([], { direction: 'after', hasMore: true, nextAfterSeq: 1, nextAfterAt: 10 }) }, 'session'), /non-advancing/);
    w.consumed(['local'], 99); assert.equal(w.messages[0].invokedAt, 99);
    w.cancelled('1'); assert.equal(w.messages.length, 0);
});
