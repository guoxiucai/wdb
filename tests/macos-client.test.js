'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { resolveConfigDir, readConfig, saveConfig } = require('../src/cli');

async function homeDirectory(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'wdb-macos-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  return home;
}
const profile = token => ({ version: 1, devices: [{ deviceId: '0123456789abcdef', token }] });

test('config precedence and Windows/Linux defaults remain independent of Mac migration', async t => {
  const home = await homeDirectory(t), env = { WDB_CONFIG: 'env-profile', LOCALAPPDATA: 'local-app-data' };
  assert.equal(await resolveConfigDir({ config: 'explicit' }, { platform: 'darwin', home, env }), path.resolve('explicit'));
  assert.equal(await resolveConfigDir({}, { platform: 'darwin', home, env }), path.resolve('env-profile'));
  delete env.WDB_CONFIG;
  assert.equal(await resolveConfigDir({}, { platform: 'win32', home, env }), path.join('local-app-data', 'wdb', 'client'));
  assert.equal(await resolveConfigDir({}, { platform: 'linux', home, env: {} }), path.join(home, 'wdb', 'client'));
  assert.deepEqual(await fs.readdir(home), []);
});

test('Mac migration publishes complete credentials privately and retains the legacy profile', async t => {
  const home = await homeDirectory(t), legacy = path.join(home, 'wdb', 'client');
  await fs.mkdir(legacy, { recursive: true });
  const original = JSON.stringify(profile('legacy-token'));
  await fs.writeFile(path.join(legacy, 'devices.json'), original);
  const dir = await resolveConfigDir({}, { platform: 'darwin', home, env: {} });
  assert.equal(dir, path.join(home, 'Library', 'Application Support', 'wdb', 'client'));
  assert.equal(await fs.readFile(path.join(dir, 'devices.json'), 'utf8'), original);
  assert.equal(await fs.readFile(path.join(legacy, 'devices.json'), 'utf8'), original);
  assert.deepEqual(await fs.readdir(dir), ['devices.json']);
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(dir, 'devices.json'))).mode & 0o777, 0o600);
  }
  await saveConfig(dir, profile('new-token'));
  assert.equal(await resolveConfigDir({}, { platform: 'darwin', home, env: {} }), dir);
  assert.deepEqual(await readConfig(dir), profile('new-token'));
});

test('existing empty or populated Mac directory is never merged with legacy credentials', async t => {
  const home = await homeDirectory(t), legacy = path.join(home, 'wdb', 'client');
  await saveConfig(legacy, profile('legacy-token'));
  const dir = path.join(home, 'Library', 'Application Support', 'wdb', 'client');
  await fs.mkdir(dir, { recursive: true });
  await resolveConfigDir({}, { platform: 'darwin', home, env: {} });
  assert.deepEqual(await fs.readdir(dir), []);
  await saveConfig(dir, profile('separate-token'));
  await resolveConfigDir({}, { platform: 'darwin', home, env: {} });
  assert.deepEqual(await readConfig(dir), profile('separate-token'));
});

test('invalid legacy configuration fails without creating a new profile or leaking content', async t => {
  const home = await homeDirectory(t), legacy = path.join(home, 'wdb', 'client');
  await fs.mkdir(legacy, { recursive: true });
  await fs.writeFile(path.join(legacy, 'devices.json'), '{private-token');
  await assert.rejects(resolveConfigDir({}, { platform: 'darwin', home, env: {} }), error => error.code === 'CONFIG_INVALID' && !error.message.includes('private-token'));
  await assert.rejects(fs.stat(path.join(home, 'Library')), { code: 'ENOENT' });
});

test('Mac reads and writes repair existing permissions and reject credential symlinks', { skip: process.platform !== 'darwin' }, async t => {
  const home = await homeDirectory(t), dir = path.join(home, 'config');
  await saveConfig(dir, profile('private-token'));
  await fs.chmod(dir, 0o755); await fs.chmod(path.join(dir, 'devices.json'), 0o644);
  await readConfig(dir);
  assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(path.join(dir, 'devices.json'))).mode & 0o777, 0o600);
  await fs.rename(path.join(dir, 'devices.json'), path.join(home, 'outside.json'));
  await fs.symlink(path.join(home, 'outside.json'), path.join(dir, 'devices.json'));
  await assert.rejects(readConfig(dir), { code: 'CONFIG_INVALID' });
  await assert.rejects(saveConfig(dir, profile('replacement')), { code: 'CONFIG_INVALID' });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(home, 'outside.json'))), profile('private-token'));
});

test('launcher runs bundled Node from arbitrary cwd, Unicode paths, and relative/absolute symlink chains', { skip: process.platform !== 'darwin' }, async t => {
  const home = await homeDirectory(t), root = path.join(home, '安装 包'), links = path.join(home, '入口');
  for (const dir of ['bin', 'runtime', 'src']) await fs.mkdir(path.join(root, dir), { recursive: true });
  await fs.copyFile(path.join(__dirname, '../bin/wdb'), path.join(root, 'bin/wdb'));
  await fs.chmod(path.join(root, 'bin/wdb'), 0o755);
  await fs.copyFile(process.execPath, path.join(root, 'runtime/node'));
  await fs.copyFile(path.join(__dirname, '../package.json'), path.join(root, 'package.json'));
  for (const file of ['cli.js', 'client-transport.js', 'device-id.js']) await fs.copyFile(path.join(__dirname, '../src', file), path.join(root, 'src', file));
  await fs.mkdir(links);
  await fs.symlink('../安装 包/bin/wdb', path.join(links, 'relative'));
  await fs.symlink(path.join(links, 'relative'), path.join(links, 'absolute'));
  const env = { ...process.env, PATH: '/usr/bin:/bin' };
  for (const entry of [path.join(root, 'bin/wdb'), path.join(links, 'absolute')]) {
    const result = execFileSync(entry, ['--version', '--json'], { cwd: '/', env, encoding: 'utf8' });
    assert.equal(JSON.parse(result).data.version, '0.1.0');
  }
  const byPath = execFileSync('/bin/sh', ['-c', 'absolute --version --json'], { cwd: '/', env: { ...env, PATH: links + ':' + env.PATH }, encoding: 'utf8' });
  assert.equal(JSON.parse(byPath).status, 'succeeded');
  await fs.rm(path.join(root, 'runtime/node'));
  assert.throws(() => execFileSync(path.join(root, 'bin/wdb'), ['--version'], { env, stdio: 'pipe' }), error => error.status === 1 && error.stderr.toString().includes('bundled runtime/node is missing'));
});
