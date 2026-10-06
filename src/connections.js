'use strict';
const { randomUUID } = require('node:crypto');
const { HapiClient, normalizeUrl } = require('./client');

class Connections {
    constructor(context, network) { this.context = context; this.network = network; this.clients = new Map(); }
    list() { return this.context.globalState.get('connections', []); }
    selected() { return this.list().find(c => c.id === this.context.globalState.get('selected')) || this.list()[0]; }
    find(id) { return this.list().find(c => c.id === id); }
    async select(id) { await this.context.globalState.update('selected', id); }
    secretKey(id) { return `hapi.connection.${id}.token`; }
    async save({ id = randomUUID(), name, url }, token) {
        const connection = { id, name: name.trim(), url: normalizeUrl(url) };
        if (!connection.name) throw new Error('A connection name is required.');
        const previous = this.find(id);
        if (previous && previous.url !== connection.url && !token?.trim()) throw new Error('Enter a token for the new endpoint.');
        if (token !== undefined) await this.context.secrets.store(this.secretKey(id), token.trim());
        const list = this.list().filter(c => c.id !== id);
        await this.context.globalState.update('connections', [...list, connection]);
        this.clients.get(id)?.dispose(); this.clients.delete(id);
        return connection;
    }
    async remove(id) {
        await this.context.secrets.delete(this.secretKey(id));
        await this.context.globalState.update('connections', this.list().filter(c => c.id !== id));
        this.clients.get(id)?.dispose(); this.clients.delete(id);
    }
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
