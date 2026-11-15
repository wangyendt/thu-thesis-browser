'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
if (process.platform !== 'win32') throw new Error('This regression targets Windows portable paths; run after npm run dist:win on Windows.');
const source = path.join(root, 'release', 'win-unpacked');
const packaged = JSON.parse(asar.extractFile(path.join(source, 'resources', 'app.asar'), 'package.json'));
const current = require('../package.json');
if (packaged.version !== current.version) throw new Error('Packaged version is stale; run npm run dist:win first.');
// Deliberately retain a literal ~ in the actual executable and app.asar path.
const target = path.join(root, 'test-output', 'ADMINI~1', `packaged-${packaged.version}-${Date.now()}`);
fs.cpSync(source, target, { recursive: true });
const env = { ...process.env, THESIS_BROWSER_EXECUTABLE: path.join(target, 'Thesis Browser.exe') };
delete env.ELECTRON_RUN_AS_NODE;
for (const args of [['scripts/pdf-save-smoke.cjs', '--real-viewer', '--popup'], ['scripts/desktop-smoke.cjs']]) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('PASS: packaged EXE in a literal ~ path; isolated test profile, no user login state used.');
