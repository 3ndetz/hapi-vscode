'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Connections } = require('../src/connections');
function context() {
    const state = new Map(), secrets = new Map();
    return { state, secretValues: secrets, globalState: { get: (k, fallback) => state.get(k) ?? fallback, update: async (k, v) => state.set(k, v) },
        secrets: { store: async (k, v) => secrets.set(k, v), get: async k => secrets.get(k), delete: async k => secrets.delete(k) } };
}
test('only SecretStorage contains tokens; default changes leave existing client endpoints pinned', async () => {
    const ctx = context(); const c = new Connections(ctx);
    const a = await c.save({ name: 'A', url: 'https://a.example/prefix' }, 'secret-a');
    const b = await c.save({ name: 'B', url: 'https://b.example/' }, 'secret-b');
    const ca = c.client(a.id), cb = c.client(b.id);
    await c.select(b.id);
    assert.equal(c.selected().id, b.id); assert.equal(ca.url, 'https://a.example/prefix/'); assert.equal(cb.url, 'https://b.example/');
    assert.ok(!JSON.stringify([...ctx.state]).includes('secret-'));
    assert.equal(await ca.getSecret(), 'secret-a'); assert.equal(await cb.getSecret(), 'secret-b');
    await c.remove(a.id); assert.equal(ctx.secretValues.has(c.secretKey(a.id)), false); assert.equal(ca.controller.signal.aborted, true);
    assert.throws(() => c.client(a.id)); assert.equal(cb.controller.signal.aborted, false); c.dispose();
});
test('editing a connection invalidates its authenticated client', async () => {
    const ctx = context(); const c = new Connections(ctx);
    const a = await c.save({ name: 'A', url: 'https://a.example/' }, 'secret'); const previous = c.client(a.id);
    await assert.rejects(() => c.save({ ...a, url: 'https://new.example/' }), /token for the new endpoint/);
    await c.save({ ...a, url: 'https://new.example/' }, 'new-secret');
    assert.equal(previous.controller.signal.aborted, true); assert.equal(await c.client(a.id).getSecret(), 'new-secret');
    c.dispose();
});
test('delayed storage snapshots and concurrent profile edits cannot drop acknowledged connections', async () => {
    const ctx = context();
    ctx.globalState.get = (_, fallback) => fallback; // A late native storage notification still exposes the old empty snapshot.
    const c = new Connections(ctx);
    const [a, b] = await Promise.all([c.save({ name: 'A', url: 'https://a.example/' }, 'secret-a'), c.save({ name: 'B', url: 'https://b.example/' }, 'secret-b')]);
    assert.equal(c.list().length, 2); assert.equal(ctx.state.get('connections').length, 2);
    await c.select(b.id); assert.equal(c.selected().id, b.id);
    await assert.rejects(c.save({ ...a, url: 'https://changed.example/' }), /token for the new endpoint/);
    await c.remove(a.id);
    assert.deepEqual(c.list().map(p => p.id), [b.id]); assert.deepEqual(ctx.state.get('connections').map(p => p.id), [b.id]);
    c.dispose();
});
