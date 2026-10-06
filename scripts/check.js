'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
let failed = false;
for (const dir of ['src', 'media', 'test', 'scripts']) {
    for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.js'))) {
        const result = spawnSync(process.execPath, ['--check', path.join(dir, file)], { encoding: 'utf8', windowsHide: true });
        if (result.status) { failed = true; process.stderr.write(result.stderr); }
    }
}
if (failed) process.exit(1);
console.log('JavaScript syntax checks passed.');
