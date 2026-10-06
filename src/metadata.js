'use strict';
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto');
const keys = ['connections', 'selected', 'sidebarTabs', 'sidebarProxyPorts'];
class Metadata {
    constructor(legacy, storageUri) {
        this.legacy = legacy; this.pending = Promise.resolve();
        this.values = Object.fromEntries(keys.map(key => [key, legacy.get(key)]));
        if (storageUri?.fsPath) {
            this.file = path.join(storageUri.fsPath, 'metadata.json');
            try {
                const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
                if (saved.version !== 1 || !saved.values || typeof saved.values !== 'object') throw Error('Unsupported HAPI metadata format.');
                this.values = Object.fromEntries(keys.map(key => [key, saved.values[key]]));
            } catch (error) { if (error.code !== 'ENOENT') throw Error('Unable to read saved HAPI profiles. Check extension storage permissions and metadata.json.'); }
        }
    }
    get(key, fallback) { return this.values[key] === undefined ? fallback : this.values[key]; }
    update(key, value) {
        if (!keys.includes(key)) return Promise.reject(Error('Unsupported HAPI metadata key.'));
        this.values[key] = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
        const snapshot = JSON.stringify({ version: 1, values: this.values });
        const job = this.pending.then(async () => {
            if (!this.file) return this.legacy.update(key, value);
            // One complete snapshot, serialized and atomically replaced. Native
            // Memento notifications cannot roll back other profiles or tabs.
            const temporary = this.file + '.' + randomUUID() + '.tmp';
            try {
                await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
                await fs.promises.writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 });
                await fs.promises.rename(temporary, this.file);
            } catch {
                await fs.promises.unlink(temporary).catch(() => {});
                throw Error('Unable to save HAPI profiles. Check extension storage permissions.');
            }
        });
        this.pending = job.catch(() => {});
        return job;
    }
}
module.exports = { Metadata };
