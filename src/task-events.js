'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { envelope, fail } = require('./common');
const ACTIVE = new Set(['accepted', 'running']);
const MAX_EVENT_BYTES = 32 * 1024 * 1024;

// Task state is always sent as a fresh snapshot. Output resumes by persisted byte
// offset, so reconnecting needs neither an unbounded event history nor task replay.
class TaskEvents {
 constructor() { this.subscribers = new Map(); }
 subscribe(req, res, task, bridge, params) {
  const offsets = {};
  for (const stream of ['stdout', 'stderr']) {
   const value = params.get(stream + 'Offset');
   if (value === null) continue;
   if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw fail('INVALID_OFFSET', 'Output offsets must be nonnegative safe integers');
   offsets[stream] = Number(value);
  }
  let count = 0;
  for (const listeners of this.subscribers.values()) for (const listener of listeners) if (listener.clientId === task.clientId) count++;
  if (count >= 16) throw fail('TOO_MANY_STREAMS', 'At most 16 task event subscriptions per client', 429);
  for (const stream of Object.keys(offsets)) {
   const file = path.join(bridge.dir, 'tasks', task.id, stream + '.live');
   const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
   if (offsets[stream] > size) throw fail('INVALID_OFFSET', 'Output offset exceeds retained task output');
  }
  let closed = false, blocked = false, pendingTask = task, timer, watcher;
  let listeners = this.subscribers.get(task.id);
  if (!listeners) { listeners = new Set(); this.subscribers.set(task.id, listeners); }
  const cleanup = () => {
   if (closed) return;
   closed = true; clearInterval(timer); watcher?.close(); listeners.delete(listener);
   if (!listeners.size) this.subscribers.delete(task.id);
  };
  const write = (event, data) => {
   if (closed || res.destroyed || res.writableEnded) return false;
   const frame = event ? `event: ${event}\ndata: ${JSON.stringify(data)}\n\n` : ': heartbeat\n\n';
   if (Buffer.byteLength(frame) > MAX_EVENT_BYTES) { cleanup(); res.destroy(); return false; }
   blocked = !res.write(frame); return !blocked;
  };
  const pump = () => {
   if (closed || blocked) return;
   try {
    // Read bounded chunks from the existing output artifact. Slow subscribers
    // pause on drain instead of accumulating another in-memory output queue.
    for (const stream of Object.keys(offsets)) {
     const file = path.join(bridge.dir, 'tasks', task.id, stream + '.live');
     if (!fs.existsSync(file)) continue;
     const fd = fs.openSync(file, 'r');
     try {
      const size = fs.fstatSync(fd).size, chunk = Buffer.allocUnsafe(48 * 1024);
      while (offsets[stream] < size) {
       const offset = offsets[stream], length = fs.readSync(fd, chunk, 0, Math.min(chunk.length, size - offset), offset);
       if (!length) throw new Error('Task output ended before the retained offset');
       offsets[stream] += length;
       if (!write('output', { deviceId: bridge.config.deviceId, taskId: task.id, stream, offset, base64: chunk.subarray(0, length).toString('base64') })) return;
      }
     } finally { fs.closeSync(fd); }
    }
    if (pendingTask) {
     const current = pendingTask; pendingTask = null;
     write('task', envelope(bridge.config.deviceId, current));
     if (!ACTIVE.has(current.status)) { cleanup(); res.end(); }
    }
   } catch { cleanup(); res.destroy(); }
  };
  const listener = {
   clientId: task.clientId,
   state: current => { pendingTask = current; pump(); },
   output: pump,
   close: () => { cleanup(); res.destroy(); }
  };
  listeners.add(listener);
  res.on('close', cleanup); res.on('error', cleanup);
  res.on('drain', () => { blocked = false; pump(); });
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  res.setTimeout(15000, () => listener.close()); res.flushHeaders();
  if (Object.keys(offsets).length) {
   // The desktop helper writes the same artifacts from another process.
   try {
    watcher = fs.watch(path.join(bridge.dir, 'tasks', task.id), { persistent: false }, (event, name) => {
     if (!name || name.toString().endsWith('.live')) pump();
    });
    watcher.on('error', listener.close);
   } catch { listener.close(); return; }
  }
  timer = setInterval(() => {
   // Sending server heartbeats must not renew temporary consent or input leases.
   try {
    const client = bridge.identify(req);
    if (!bridge.isApproved(client)) throw fail('PAIRING_REQUIRED', 'Temporary authorization ended', 401);
    if (!blocked) write();
   } catch (error) {
    write('error', envelope(bridge.config.deviceId, null, 'failed', { code: error.code, message: error.message }));
    cleanup(); res.end();
   }
  }, 1000);
  timer.unref();
  pump();
 }
 publish(task) { for (const listener of this.subscribers.get(task.id) || []) listener.state(task); }
 output(task, stream, bytes) { for (const listener of this.subscribers.get(task.id) || []) listener.output(stream, bytes); }
 disconnect(clientId) { for (const listeners of this.subscribers.values()) for (const listener of listeners) if (listener.clientId === clientId) listener.close(); }
 close() { for (const listeners of this.subscribers.values()) for (const listener of listeners) listener.close(); }
}
module.exports = { TaskEvents };
