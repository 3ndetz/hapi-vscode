'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');

(async () => {
    const root = path.resolve(__dirname, '..');
    const executable = process.env.VSCODE_EXECUTABLE_PATH || await downloadAndUnzipVSCode('stable');
    const data = fs.mkdtempSync(path.join(fs.mkdirSync(path.join(root, '.local'), { recursive: true }) || path.join(root, '.local'), 'host-test-'));
    const args = ['--no-sandbox', '--disable-gpu', '--disable-gpu-sandbox', '--disable-updates', '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--new-window',
        `--user-data-dir=${path.join(data, 'user')}`, `--extensions-dir=${path.join(data, 'extensions')}`,
        `--extensionDevelopmentPath=${root}`, `--extensionTestsPath=${process.env.VSCODE_TESTS_PATH || path.join(root, 'test', 'host.js')}`];
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, args, { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
    child.on('error', error => { console.error(error.message); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code || (output.includes(process.env.VSCODE_TEST_SUCCESS_MARKER || 'HOST CHECK PASSED:') ? 0 : 1); });
})().catch(error => { console.error(error.message); process.exitCode = 1; });
