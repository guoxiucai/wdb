#!/usr/bin/env node
'use strict';
// Runs entirely offline, using the runtime shipped in the package.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

async function verify(root) {
  root = fs.realpathSync(root);
  const required = ['BUILD-INFO.json', 'runtime/node', 'runtime/NODE-LICENSE.txt', 'bin/wdb',
    'src/cli.js', 'src/client-transport.js', 'src/device-id.js', 'scripts/verify-package.js',
    'scripts/validate-lan.js', 'skills/wdb/SKILL.md', 'README.md', 'docs/MACOS-CLIENT.md'];
  const actual = new Set();
  function walk(dir) {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const relative = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) walk(relative);
      else if (entry.isFile()) actual.add(relative);
      else throw Error('Package contains a symlink or special file: ' + relative);
    }
  }
  walk('');
  for (const file of required) if (!actual.has(file)) throw Error('Required component missing: ' + file);
  const verified = new Set();
  const manifest = fs.readFileSync(path.join(root, 'SHA256SUMS.txt'), 'utf8');
  for (const line of manifest.trim().split('\n')) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) throw Error('Invalid checksum manifest');
    const [, expected, relative] = match;
    if (relative.includes('\\') || relative.startsWith('/') || relative.split('/').some(part => !part || part === '.' || part === '..') || relative === 'SHA256SUMS.txt' || verified.has(relative)) throw Error('Unsafe or duplicate manifest path');
    if (!actual.has(relative)) throw Error('Manifest file missing: ' + relative);
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(path.join(root, relative))) hash.update(chunk);
    if (hash.digest('hex') !== expected) throw Error('Checksum mismatch: ' + relative);
    verified.add(relative);
  }
  for (const file of actual) if (file !== 'SHA256SUMS.txt' && !verified.has(file)) throw Error('Unlisted file: ' + file);
  const info = JSON.parse(fs.readFileSync(path.join(root, 'BUILD-INFO.json')));
  if (info.platform !== 'darwin' || info.architecture !== 'arm64' || info.protocolVersion !== 1 || info.nodeVersion !== 'v24.15.0') throw Error('Unexpected build platform, protocol, or runtime');
  for (const file of ['runtime/node', 'bin/wdb']) {
    if ((fs.statSync(path.join(root, file)).mode & 0o777) !== 0o755) throw Error('Expected mode 0755: ' + file);
  }
  if (fs.readFileSync(path.join(root, 'bin/wdb'), 'utf8').includes('\r')) throw Error('Launcher must use LF');
  const run = (file, args) => execFileSync(path.join(root, file), args, { encoding: 'utf8', cwd: '/', env: { ...process.env, PATH: '/usr/bin:/bin' }, timeout: 10000 });
  const runtime = JSON.parse(run('runtime/node', ['-p', 'JSON.stringify({path:process.execPath,version:process.version,platform:process.platform,arch:process.arch})']));
  if (runtime.path !== path.join(root, 'runtime/node') || runtime.version !== info.nodeVersion || runtime.platform !== info.platform || runtime.arch !== info.architecture) throw Error('Packaged runtime differs from build metadata');
  const version = JSON.parse(run('bin/wdb', ['--version', '--json']));
  if (version.status !== 'succeeded' || version.data.version !== info.version) throw Error('CLI version differs from build metadata');
  return { status: 'verified', packageDirectory: root, verifiedFiles: verified.size, cliVersion: version.data.version, runtime };
}
if (require.main === module) verify(process.argv[2] || path.join(__dirname, '..')).then(result => console.log(JSON.stringify(result)), error => { console.error(error.message); process.exitCode = 1; });
module.exports = { verify };
