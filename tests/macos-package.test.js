'use strict';
// Opt-in against an actual build: WDB_TEST_PACKAGE=... runtime/node --test this-file.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { verify } = require('../scripts/verify-package');
const enabled = process.platform === 'darwin' && !!process.env.WDB_TEST_PACKAGE;
let temporary, root;
before(async () => {
  if (!enabled) return;
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'wdb-package-'));
  root = path.join(temporary, '离线 包');
  await fs.cp(path.resolve(process.env.WDB_TEST_PACKAGE), root, { recursive: true });
});
after(async () => { if (temporary) await fs.rm(temporary, { recursive: true, force: true }); });
const packageTest = (name, fn) => test(name, { skip: !enabled }, fn);

packageTest('relocated package verifies and starts with networking denied and no global Node on PATH', async () => {
  assert.equal((await verify(root)).status, 'verified');
  const result = execFileSync('/usr/bin/sandbox-exec', ['-p', '(version 1) (allow default) (deny network*)', path.join(root, 'bin/wdb'), '--version', '--json'], {
    cwd: '/', env: { PATH: '/usr/bin:/bin', HOME: temporary }, encoding: 'utf8', timeout: 10000
  });
  assert.equal(JSON.parse(result).data.version, '0.1.0');
});

packageTest('changed or missing files fail integrity checks', async () => {
  const file = path.join(root, 'src/cli.js'), original = await fs.readFile(file);
  try {
    await fs.appendFile(file, '\n// changed\n');
    await assert.rejects(verify(root), /Checksum mismatch/);
    await fs.rm(file);
    await assert.rejects(verify(root), /Required component missing/);
  } finally { await fs.writeFile(file, original); }
});

packageTest('extra files and symlinks cannot hide outside the manifest', async () => {
  const file = path.join(root, 'unlisted.txt');
  try {
    await fs.writeFile(file, 'extra');
    await assert.rejects(verify(root), /Unlisted file/);
    await fs.rm(file); await fs.symlink('README.md', file);
    await assert.rejects(verify(root), /symlink or special file/);
  } finally { await fs.rm(file, { force: true }); }
});

packageTest('manifest traversal and duplicate entries are rejected', async () => {
  const file = path.join(root, 'SHA256SUMS.txt'), original = await fs.readFile(file, 'utf8');
  try {
    await fs.writeFile(file, '0'.repeat(64) + '  ../outside\n');
    await assert.rejects(verify(root), /Unsafe or duplicate/);
    await fs.writeFile(file, original + original.split('\n')[0] + '\n');
    await assert.rejects(verify(root), /Unsafe or duplicate/);
  } finally { await fs.writeFile(file, original); }
});

packageTest('lost launcher execute permissions are detected', async () => {
  const file = path.join(root, 'bin/wdb');
  try {
    await fs.chmod(file, 0o644);
    await assert.rejects(verify(root), /Expected mode 0755/);
  } finally { await fs.chmod(file, 0o755); }
});
