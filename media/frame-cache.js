'use strict';
// The website must acknowledge a clean composer before a hidden page is evicted.
class HapiFrameCache {
    constructor(frames, limit = 4) { this.frames = frames; this.limit = limit; this.pending = new Map(); this.sequence = 0; }
    touch(id) { const frame = this.frames.get(id); if (frame) { this.frames.delete(id); this.frames.set(id, frame); } }
    trim(activeId) {
        for (const [id, request] of this.pending) if (!this.frames.has(id) || Date.now() - request.sentAt > 10000) this.pending.delete(id);
        if (this.frames.size <= this.limit) return;
        for (const [id, frame] of this.frames) if (id !== activeId && !this.pending.has(id)) {
            const requestId = String(++this.sequence); this.pending.set(id, { requestId, sentAt: Date.now() });
            frame.contentWindow.postMessage({ type: 'hapi-suspend-request', requestId }, new URL(frame.src).origin);
        }
    }
    acknowledge(id, data, activeId) {
        if (!this.pending.has(id) || this.pending.get(id).requestId !== data.requestId) return;
        this.pending.delete(id);
        const frame = this.frames.get(id);
        if (data.safe === true && frame && id !== activeId && this.frames.size > this.limit) { frame.remove(); this.frames.delete(id); }
    }
}
if (typeof module !== 'undefined') module.exports = { HapiFrameCache };
