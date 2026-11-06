'use strict';
// Opt-in integration against an installed/running local service. The ordinary
// suite uses the self-contained TLS fixture and does not require a service.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { main } = require('../src/cli');

// A server operator must allow and remember the newly paired test client.
test('installed localhost service: CLI pairing, user shell, transfer, logs, lifecycle', { skip: !process.env.WDB_TEST_DATA_DIR, timeout: 240000 }, async () => {
  const serverData = process.env.WDB_TEST_DATA_DIR;
  const target = process.env.WDB_TEST_URL || 'https://localhost:18766';
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'wdb-live-cli-'));
  const config = path.join(temporary, 'client');
  const cli = async args => {
    let output = '', stderr = '';
    const code = await main([...args, '--config', config, '--json'], { stdout: { write(s) { output += s; } }, stderr: { write(s) { stderr += s; } } });
    const events = output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    return { code, events, result: events.at(-1), stderr };
  };
  let clientId;
  try {
    const fingerprint = (await fs.readFile(path.join(serverData, 'fingerprint'), 'utf8')).trim();
    const pairingCode = (await fs.readFile(path.join(serverData, 'pairing-code'), 'utf8')).trim();
    const paired = await cli(['connect', target, '--fingerprint', fingerprint, '--pairing-code', pairingCode, '--name', 'wdb-cli-integration']);
    assert.equal(paired.code, 0, JSON.stringify(paired.result)); clientId = paired.result.data.clientId;
    assert.notEqual(paired.result.data.remembered,false,'For this opt-in integration test, the server operator must check Remember so its reconnect step does not require a second manual dialog.');
    const info = await cli(['info']); assert.equal(info.code, 0); assert.equal(info.result.data.protocolVersion, 1);
    const shell = await cli(['shell', '--script', "[Console]::WriteLine('中文 shell verified'); whoami"]);
    assert.equal(shell.code, 0, JSON.stringify(shell.result)); assert.match(shell.result.data.data.stdout, /中文 shell verified/);
    assert.ok(shell.result.data.data.identity); assert.equal(shell.result.data.data.requestedIdentity, 'logged-in-user');
    const source = path.join(temporary, '源目录'), remote = path.join(temporary, '服务端目录'), local = path.join(temporary, '下载目录');
    await fs.mkdir(path.join(source, '子目录'), { recursive: true });
    const bytes = crypto.randomBytes(4 * 1024 * 1024 + 17); await fs.writeFile(path.join(source, '子目录', '大文件.bin'), bytes);
    assert.equal((await cli(['push', source, remote])).code, 0);
    assert.equal((await cli(['pull', remote, local, '--recursive'])).code, 0);
    assert.deepEqual(await fs.readFile(path.join(local, '子目录', '大文件.bin')), bytes);
    const log = path.join(temporary, '应用.log'); await fs.writeFile(log, '开始\n');
    const subscription = cli(['logs', 'file', '--path', log, '--follow', '--duration', '1800', '--poll-ms', '150']);
    const timers = [setTimeout(() => fs.appendFile(log, '追加\n'), 600), setTimeout(() => fs.writeFile(log, '新\n'), 1200)];
    const followed = await subscription; timers.forEach(clearTimeout);
    assert.equal(followed.code, 0, JSON.stringify(followed.result));
    assert.ok(followed.events.some(event => event.data.kind === 'content' && event.data.text.includes('开始')));
    assert.ok(followed.events.some(event => event.data.kind === 'content' && event.data.text.includes('追加')));
    assert.ok(followed.events.some(event => event.data.kind === 'truncated'));
    const detached = await cli(['shell', '--script', "Start-Sleep -Seconds 2; 'continued'", '--detach']);
    assert.equal(detached.code, 0); const taskId = detached.result.data.id;
    assert.equal((await cli(['disconnect', target])).code, 0);
    assert.equal((await cli(['connect', target])).code, 0);
    const completed = await cli(['task', 'wait', taskId]); assert.equal(completed.code, 0); assert.match(completed.result.data.data.stdout, /continued/);
    const cancelled = await cli(['shell', '--script', 'Start-Sleep -Seconds 30', '--detach']);
    const cancelId = cancelled.result.data.id; assert.ok(cancelId);
    const cancelStarted = Date.now();
    assert.equal((await cli(['task', 'cancel', cancelId])).code, 0);
    const cancelResult = await cli(['task', 'wait', cancelId]); assert.equal(cancelResult.result.data.status, 'cancelled');
    assert.ok(Date.now() - cancelStarted < 8000, 'Cancellation must stop the active process promptly, not merely label it cancelled after natural completion');
    assert.equal((await cli(['task', 'delete', cancelId])).code, 0);
  } finally {
    if (clientId) await cli(['clients', 'revoke', clientId]);
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
