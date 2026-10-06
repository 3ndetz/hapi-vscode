'use strict';
const { randomUUID } = require('node:crypto');
const { HapiClient, normalizeUrl } = require('./client');

class Connections {
    constructor(context, network) {
        this.context = context; this.network = network; this.clients = new Map();
        // Memento storage-change notifications may lag completed writes. Keep
        // this host's acknowledged records rather than overwriting newer edits
        // with a delayed storage snapshot during the next read/modify/write.
        this.records = context.globalState.get('connections', []);
        this.selectedId = context.globalState.get('selected');
        this.mutations = Promise.resolve();
    }
    list() { return this.records; }
    selected() { return this.list().find(c => c.id === this.selectedId) || this.list()[0]; }
    find(id) { return this.list().find(c => c.id === id); }
    async select(id) { await this.context.globalState.update('selected', id); this.selectedId = id; }
    mutate(operation) {
        const result = this.mutations.then(operation);
        this.mutations = result.catch(() => {});
        return result;
    }
    secretKey(id) { return `hapi.connection.${id}.token`; }
    save({ id = randomUUID(), name, url }, token) { return this.mutate(async () => {
        const connection = { id, name: name.trim(), url: normalizeUrl(url) };
        if (!connection.name) throw new Error('A connection name is required.');
        const previous = this.find(id);
        if (previous && previous.url !== connection.url && !token?.trim()) throw new Error('Enter a token for the new endpoint.');
        if (token !== undefined) await this.context.secrets.store(this.secretKey(id), token.trim());
        const list = this.list().filter(c => c.id !== id);
        const records = [...list, connection];
        await this.context.globalState.update('connections', records);
        this.records = records;
        this.clients.get(id)?.dispose(); this.clients.delete(id);
        return connection;
    }); }
    remove(id) { return this.mutate(async () => {
        await this.context.secrets.delete(this.secretKey(id));
        const records = this.list().filter(c => c.id !== id);
        await this.context.globalState.update('connections', records);
        this.records = records;
        this.clients.get(id)?.dispose(); this.clients.delete(id);
    }); }
    client(id) {
        const connection = this.find(id);
        if (!connection) throw new Error('This connection was removed. Add it again to open the chat.');
        if (!this.clients.has(id)) {
            const client = new HapiClient(connection.url, () => this.context.secrets.get(this.secretKey(id)), this.network ? this.network.fetch.bind(this.network) : undefined);
            client.network = this.network;
            this.clients.set(id, client);
        }
        return this.clients.get(id);
    }
    dispose() { for (const client of this.clients.values()) client.dispose(); this.clients.clear(); }
}
module.exports = { Connections };
