'use strict';

const stringify = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';
const record = value => value && typeof value === 'object' && !Array.isArray(value);
function envelope(content) {
    return [content, content?.message, content?.data?.message, content?.payload?.message]
        .find(value => record(value) && typeof value.role === 'string' && 'content' in value);
}
function decodeMessage(message) {
    const wrapped = envelope(message.content);
    const base = { id: message.id, localId: message.localId, seq: message.seq, createdAt: message.createdAt,
        invokedAt: message.invokedAt, deliveryState: message.deliveryState };
    const row = (role, text, kind = 'text', streamId) => ({ ...base, role, text: stringify(text), kind, ...(streamId ? { streamId } : {}) });
    if (!wrapped) return [row('agent', message.content)];
    const p = wrapped.content;
    if (wrapped.role === 'user') return [row('user', p?.type === 'text' ? p.text : p)];
    if (wrapped.role !== 'agent') return [row('agent', p)];
    if (p?.type === 'codex') {
        const d = p.data || {};
        if (['message', 'reasoning', 'error'].includes(d.type)) return [row('agent', d.message || '', d.type === 'message' ? 'text' : d.type, d.streamSnapshot ? d.id : undefined)];
        if (d.type === 'tool-call') return [row('agent', d.input ?? d.description ?? '', `tool: ${d.name || 'call'}`)];
        if (d.type === 'tool-call-result') return [row('agent', d.output, d.is_error ? 'tool error' : 'tool result')];
        if (d.type === 'plan' || d.type === 'plan_update') return [row('agent', d.entries ?? d.plan ?? d.items ?? d.steps, 'plan')];
        if (d.type === 'compact-summary') return [row('agent', d.summary, 'summary')];
        if (d.type === 'generated-image') return [row('agent', d.fileName ?? d.file_name ?? 'Generated image: open the hub to view.', 'image')];
        return [];
    }
    if (p?.type === 'output') {
        const d = p.data || {};
        if (d.isMeta || d.isCompactSummary || ['rate_limit_event', 'tool_progress'].includes(d.type)) return [];
        if (d.type === 'assistant' || d.type === 'user') {
            const blocks = d.message?.content;
            if (typeof blocks === 'string') return [row(d.type === 'user' ? 'user' : 'agent', blocks)];
            if (!Array.isArray(blocks)) return [];
            return blocks.flatMap((b, index) => {
                let result;
                if (b.type === 'text') result = row(d.type === 'user' ? 'user' : 'agent', b.text);
                if (b.type === 'thinking') result = row('agent', b.thinking, 'reasoning');
                if (b.type === 'tool_use') result = row('agent', b.input, `tool: ${b.name}`);
                if (b.type === 'tool_result') result = row('agent', d.toolUseResult ?? b.content, b.is_error ? 'tool error' : 'tool result');
                return result ? [{ ...result, id: `${message.id}:${index}` }] : [];
            });
        }
        if (d.type === 'summary') return [row('agent', d.summary, 'summary')];
        if (d.type === 'agy_message') return d.content ? [row('agent', d.content)] : [];
        if (d.type === 'system') {
            if (!['api_error', 'away_summary', 'compact_boundary'].includes(d.subtype)) return [];
            return [row('agent', d.content ?? d.error ?? 'Context compacted', d.subtype)];
        }
        return [row('agent', d, 'event')];
    }
    if (p?.type === 'event') {
        const d = p.data || {};
        if (['message', 'error', 'recap', 'compact-summary'].includes(d.type)) return [row('agent', d.message ?? d.text ?? d.summary, d.type === 'message' ? 'text' : d.type)];
        if (['ready', 'title-changed', 'switch', 'token_count'].includes(d.type)) return [];
        return [row('agent', d, 'event')];
    }
    return [row('agent', p)];
}
function title(session) {
    return session?.metadata?.name || session?.metadata?.summary?.text || session?.metadata?.path || session?.id || 'Chat';
}
function mergeMessages(existing, incoming) {
    const map = new Map(existing.map(message => [message.id, message]));
    for (const message of incoming) {
        if (message.localId) {
            for (const [id, previous] of map) {
                if (previous.localId === message.localId && id !== message.id) map.delete(id);
            }
        }
        map.set(message.id, message);
    }
    return [...map.values()].sort((a, b) => ((a.invokedAt ?? a.createdAt) - (b.invokedAt ?? b.createdAt)) || ((a.seq ?? Infinity) - (b.seq ?? Infinity)));
}
module.exports = { decodeMessage, title, mergeMessages };
