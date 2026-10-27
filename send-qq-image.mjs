#!/usr/bin/env node
// 把本地图片通过 dsh-im 主动投递接口发到 QQ（QQ 原生图片消息）。
// 用法: node send-qq-image.mjs --image D:\path\x.jpg [--text "..."] [--port 6132]
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
function arg(name, fallback = '') {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}

const imageArg = arg('image');
if (!imageArg) {
  console.error('missing --image');
  process.exit(2);
}
const imagePath = resolve(imageArg);
if (!existsSync(imagePath)) {
  console.error(`image not found: ${imagePath}`);
  process.exit(2);
}

const text = arg('text');
const botId = arg('bot', 'qq_10bf8109e6912d401d7c19cb');
const targetId = arg('target', 'owner-desktop');

function candidatePorts() {
  const explicit = arg('port');
  const ports = [];
  if (explicit) ports.push(Number(explicit));
  try {
    const out = execSync('netstat -ano -p TCP', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const seen = new Set(ports);
    for (const line of out.split(/\r?\n/)) {
      const m = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/.exec(line);
      if (!m) continue;
      const addr = m[1];
      if (!['127.0.0.1', '0.0.0.0', '[::]', '[::1]'].includes(addr)) continue;
      const port = Number(m[2]);
      if (!seen.has(port)) { seen.add(port); ports.push(port); }
    }
  } catch { /* ignore */ }
  return ports;
}

const body = { botId, targetId, image: imagePath, ...(text ? { text } : {}) };
let lastError = 'no candidate ports';
for (const port of candidatePorts()) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dsh-im/delivery/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const payload = await response.text();
    if (response.ok) {
      const parsed = JSON.parse(payload);
      if (parsed?.sent) {
        console.log(`sent via port ${port}`);
        process.exit(0);
      }
    }
    lastError = `port ${port}: ${response.status} ${payload.slice(0, 200)}`;
  } catch (error) {
    lastError = `port ${port}: ${error.message}`;
  }
}
console.error(`failed: ${lastError}`);
process.exit(1);
