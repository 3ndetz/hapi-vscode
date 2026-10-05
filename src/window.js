'use strict';
const { mergeMessages } = require('./messages');

const position = message => ({ seq: message.seq, at: message.invokedAt ?? message.createdAt });
const later = (a, b) => !b || (a.at > b.at || (a.at === b.at && a.seq > b.seq));
class MessageWindow {
    constructor() { this.clear(); }
    clear() { this.messages = []; this.epoch = undefined; this.head = undefined; this.syncedHead = undefined; this.before = undefined; this.hasMore = false; }
    ingest(messages) {
        this.messages = mergeMessages(this.messages, messages);
        for (const message of messages) {
            const p = position(message);
            if (p.seq !== null && p.seq !== undefined && later(p, this.head)) this.head = p;
        }
    }
    apply(result, older = false) {
        const p = result.page;
        if (p && this.epoch !== undefined && p.epoch !== this.epoch && older) { this.clear(); return false; }
        if (p?.reset || (this.epoch !== undefined && p && p.epoch !== this.epoch)) this.clear();
        const wasCold = this.epoch === undefined;
        this.ingest(result.messages || []);
        if (!p) { this.hasMore = false; return true; }
        this.epoch = p.epoch;
        if (!older) {
            const seq = p.direction === 'latest' ? p.snapshotHeadSeq : p.nextAfterSeq;
            const at = p.direction === 'latest' ? p.snapshotHeadAt : p.nextAfterAt;
            if (seq !== null && seq !== undefined) this.syncedHead = { seq, at };
        }
        if (older || wasCold || p.direction === 'latest') {
            this.before = p.nextBeforeSeq !== null && p.nextBeforeSeq !== undefined ? { seq: p.nextBeforeSeq, at: p.nextBeforeAt } : undefined;
            this.hasMore = p.hasMore;
        }
        return true;
    }
    async sync(client, id) {
        if (!this.syncedHead || this.epoch === undefined) { this.apply(await client.messages(id)); return; }
        // Live events can overtake the REST catch-up. Only a completed REST page
        // advances this cursor, so an arriving live row cannot hide a missed gap.
        let after = this.syncedHead;
        let until;
        // Bound a catch-up to a fixed server snapshot, rather than chasing live appends.
        for (let n = 0; n < 100; n++) {
            const result = await client.messages(id, { afterSeq: String(after.seq), afterAt: String(after.at), epoch: String(this.epoch),
                ...(until ? { untilSeq: String(until.seq), untilAt: String(until.at) } : {}) });
            this.apply(result);
            const p = result.page;
            if (!p || p.reset || p.direction === 'latest' || !p.hasMore) return;
            until ??= { seq: p.snapshotHeadSeq, at: p.snapshotHeadAt };
            const next = { seq: p.nextAfterSeq, at: p.nextAfterAt };
            if (!later(next, after)) throw new Error('HAPI returned a non-advancing message cursor. Refresh this chat.');
            after = next;
        }
        throw new Error('Large catch-up paused. Refresh to continue loading.');
    }
    async older(client, id) {
        if (!this.before) return;
        const result = await client.messages(id, { beforeSeq: String(this.before.seq), beforeAt: String(this.before.at) });
        if (!this.apply(result, true)) await this.sync(client, id);
    }
    consumed(localIds, invokedAt) {
        const ids = new Set(localIds);
        this.ingest(this.messages.filter(m => ids.has(m.localId)).map(m => ({ ...m, invokedAt, deliveryState: undefined })));
    }
    cancelled(id, localId) { this.messages = this.messages.filter(m => m.id !== id && (!localId || m.localId !== localId)); }
}
module.exports = { MessageWindow };
