'use strict';
// Explicit, potentially disk-intensive opt-in validation. All generated files
// are scoped to .runtime/large-validation and removed after each case.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { main, sha256 } = require('../src/cli');
const root = path.resolve(__dirname, '..');
const workspace = path.join(root, '.runtime', 'large-validation');
const config = process.env.WDB_CONFIG || path.join(root, '.runtime', 'client');
const cases = process.argv.includes('--small') ? [16 * 1024 ** 2 + 17] : [1024 ** 3, 4 * 1024 ** 3 + 17];
const reportPath = path.join(root, 'docs', 'LOCALHOST-PERFORMANCE.md');
async function cli(args) {
  let stdout = '', stderr = '';
  const code = await main([...args, '--config', config, '--json'], { stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } } });
  const result = JSON.parse(stdout);
  if (code) throw Object.assign(new Error(JSON.stringify(result)), { result });
  return result;
}
function seconds(ms) { return (ms / 1000).toFixed(3); }
function throughput(bytes, ms) { return (bytes / 1000000 / (ms / 1000)).toFixed(2); }
function localTime(value) { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)); }
function windowsHardware() {
  if (process.platform !== 'win32') return null;
  try {
    const script = '[ordered]@{disks=@(Get-PhysicalDisk | Select-Object FriendlyName,MediaType,BusType,Size); network=@(Get-NetAdapter | Select-Object Name,InterfaceDescription,Status,LinkSpeed)} | ConvertTo-Json -Depth 5 -Compress';
    return JSON.parse(execFileSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true }));
  } catch (error) { return { unavailable: error.message }; }
}
async function generate(file, size) {
  const started = Date.now(), hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024), handle = await fs.open(file, 'wx');
  let offset = 0;
  try {
    while (offset < size) {
      const chunk = buffer.subarray(0, Math.min(buffer.length, size - offset));
      crypto.randomFillSync(chunk); hash.update(chunk);
      let written = 0;
      while (written < chunk.length) written += (await handle.write(chunk, written, chunk.length - written)).bytesWritten;
      offset += chunk.length;
    }
    await handle.sync();
  } finally { await handle.close(); }
  return { bytes: size, sha256: hash.digest('hex'), durationMs: Date.now() - started };
}
async function run() {
  const startedAt = new Date().toISOString();
  await fs.mkdir(workspace, { recursive: true });
  const disk = await fs.statfs(workspace);
  const available = disk.bavail * disk.bsize;
  if (available < 16 * 1024 ** 3) throw new Error('At least 16 GiB free disk space is required.');
  const info = (await cli(['info'])).data;
  const results = [];
  for (const size of cases) {
    const caseDir = await fs.mkdtemp(path.join(workspace, 'case-'));
    const source = path.join(caseDir, '源文件 中文.bin'), remote = path.join(caseDir, '远端文件 中文.bin'), pulled = path.join(caseDir, '下载文件 中文.bin');
    try {
      console.log(`Generating ${size} cryptographically random bytes`);
      const generation = await generate(source, size);
      console.log(`Push ${size} bytes`); const push = (await cli(['push', source, remote])).data;
      console.log(`Pull ${size} bytes`); const pull = (await cli(['pull', remote, pulled])).data;
      const checkStart = Date.now(), diskHash = await sha256(pulled), diskVerificationMs = Date.now() - checkStart;
      const correct = generation.sha256 === push.sha256 && generation.sha256 === pull.sha256 && generation.sha256 === diskHash;
      if (!correct || push.bytes !== size || pull.bytes !== size) throw new Error('Byte count or independent SHA-256 verification failed');
      results.push({ size, generation, push, pull, diskVerificationMs, verified: true });
      console.log(JSON.stringify({ bytes: size, pushMBps: throughput(size, push.transferMs), pullMBps: throughput(size, pull.transferMs), verified: true }));
    } finally {
      const absolute = path.resolve(caseDir);
      if (!absolute.startsWith(workspace + path.sep)) throw new Error('Cleanup containment check failed');
      await fs.rm(absolute, { recursive: true, force: true });
    }
  }
  const report = { startedAt, finishedAt: new Date().toISOString(), environment: { hostname: os.hostname(), os: os.version(), release: os.release(), architecture: os.arch(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), freeDiskBytesBefore: available, node: process.version, hardware: windowsHardware() }, server: { deviceId: info.deviceId, version: info.version }, load: 'Localhost client and server share the same machine and SSD; concurrent 1080p recording may be active. This is not an isolated LAN throughput acceptance test.', results };
  await fs.writeFile(path.join(workspace, 'results.json'), JSON.stringify(report, null, 2));
  if (!process.argv.includes('--small')) {
    const rows = results.map(r => `| ${r.size.toLocaleString('en-US')} | ${seconds(r.generation.durationMs)} | ${seconds(r.push.checksumMs)} | ${seconds(r.push.transferMs)} | ${throughput(r.size, r.push.transferMs)} | ${seconds(r.push.durationMs)} | ${seconds(r.pull.responseWaitMs)} | ${seconds(r.pull.transferMs)} | ${throughput(r.size, r.pull.transferMs)} | ${seconds(r.pull.durationMs)} | ${seconds(r.diskVerificationMs)} | 通过 |`).join('\n');
    await fs.writeFile(reportPath, `# Windows localhost 文件传输实测\n\n运行时间：${localTime(startedAt)} 至 ${localTime(report.finishedAt)}（北京时间，UTC+08:00）。测试代码：\`node scripts/validate-transfer.js\`。\n\n环境：${report.environment.os} ${report.environment.release} ${report.environment.architecture}；${report.environment.cpu}，${report.environment.logicalCpus}逻辑处理器；内存 ${(report.environment.memoryBytes / 1024 ** 3).toFixed(1)} GiB；Node ${process.version}；服务端 ${info.version}。生成前数据盘可用 ${(available / 1024 ** 3).toFixed(1)} GiB。硬件枚举：${JSON.stringify(report.environment.hardware)}。\n\n客户端和服务端位于同一台设备，文件位于同一数据盘，测试期间可能与 1080p 录像并行。结果只用于验证 localhost 流式传输、64 位文件大小和完整性，不作为千兆局域网 ≥80 MB/s 单项验收。\n\n每个文件均逐块生成密码学随机数据。生成时计算 SHA-256；push 前单独完整读取校验，服务端接收时流式校验；pull 等待服务端预先计算校验值，接收时流式校验；下载后再次独立读取整个文件计算 SHA-256，四个哈希一致。完成后清理生成、上传、下载三个大文件，保留此报告和忽略目录中的机器可读记录。\n\n| 字节数 | 生成秒 | push预校验秒 | push传输秒 | push MB/s | push总秒 | pull响应等待秒 | pull传输秒 | pull MB/s | pull总秒 | 独立磁盘校验秒 | 正确性 |\n|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|\n${rows}\n\npush 传输时间包含 TLS 请求及服务端确认，服务端 SHA-256 在接收过程中计算。pull 响应等待包含 TLS 和服务端预校验；pull 传输计时从收到响应头至文件流结束，SHA-256 同步计算。总耗时包含各阶段和正式文件发布。MB/s 使用十进制 1 MB = 1,000,000 bytes。随机数据生成和独立复核不计入传输总耗时。\n\n较小文件为 1 GiB（满足至少 1 GB 的数据规模），较大文件为 4 GiB + 17 bytes（超过 32 位无符号文件大小边界）。中文及空格路径均参与本次上传和下载。目录递归、默认不覆盖、错误校验清理和断线生命周期另见 CLI 集成测试。\n`);
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
