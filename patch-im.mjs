// 给 @xmanrui/dsh-im 重新打「图片投递」补丁（2026-10-27 第一次打的补丁被插件重装冲掉了）。
// 幂等：已打过就跳过；锚点找不到就报错退出，不静默写坏。
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = 'C:\\Users\\Administrator\\.dsh\\profiles\\desktop\\node_modules\\@xmanrui\\dsh-im';

function patchFile(relPath, patches) {
  return (async () => {
    const path = join(root, relPath);
    let text = await readFile(path, 'utf8');
    for (const { name, find, replace } of patches) {
      if (text.includes(replace.slice(0, 200)) && !text.includes(find)) {
        // 已经替换过
        continue;
      }
      if (!text.includes(find)) {
        if (text.includes(replace)) { continue; }
        throw new Error(`${relPath}: anchor for "${name}" not found`);
      }
      text = text.replace(find, replace);
      console.log(`patched ${relPath}: ${name}`);
    }
    await writeFile(path, text, 'utf8');
  })();
}

// 1) delivery-service.mjs —— 导入 + sendImage 方法
await patchFile('plugin-src/host/delivery-service.mjs', [
  {
    name: 'imports',
    find: "import { createHash } from 'node:crypto';",
    replace: [
      "import { createHash } from 'node:crypto';",
      "import { readFile, stat } from 'node:fs/promises';",
      "import { basename } from 'node:path';",
    ].join('\n'),
  },
  {
    name: 'sendImage method',
    find: '  async #checkedRegistrationFor(botId) {',
    replace: [
      '  async sendImage(botId, targetIdOrDraft, imagePath, { signal, text = null, format = \'plain\' } = {}) {',
      '    const id = botIdOf(botId);',
      '    const targetKey = typeof targetIdOrDraft === \'string\' ? targetIdOf(targetIdOrDraft) : null;',
      '    const draft = targetKey === null ? draftTargetObject(targetIdOrDraft) : null;',
      '    if (typeof imagePath !== \'string\' || !imagePath.trim()) {',
      '      throw deliveryError(\'bad-request\', \'Image path is required\');',
      '    }',
      '    if (!/\\.(?:jpe?g|png|gif|webp)$/i.test(imagePath)) {',
      '      throw deliveryError(\'bad-request\', \'Image must be jpg, png, gif or webp\');',
      '    }',
      '    if (format !== \'plain\' && format !== \'markdown\') {',
      '      throw deliveryError(\'bad-request\', \'Message format must be plain or markdown\');',
      '    }',
      '    let bytes;',
      '    let fileName;',
      '    try {',
      '      const info = await stat(imagePath);',
      '      if (!info.isFile()) throw deliveryError(\'bad-request\', \'Image path is not a file\');',
      '      if (info.size > 20 * 1024 * 1024) throw deliveryError(\'bad-request\', \'Image exceeds 20MB\');',
      '      bytes = await readFile(imagePath);',
      '      fileName = basename(imagePath);',
      '    } catch (error) {',
      '      if (error?.code === \'not-found\' || error?.code === \'ENOENT\') {',
      '        throw deliveryError(\'unknown-image\', \'Image not found\', { cause: error });',
      '      }',
      '      throw publicOperationError(error);',
      '    }',
      '    cancellation(signal);',
      '    const adapter = await this.#adapterFor(id);',
      '    try {',
      '      let target;',
      '      if (draft) {',
      '        target = { targetId: DRAFT_TARGET_ID, ...draft };',
      '      } else {',
      '        const targets = await adapter.listTargets(id);',
      '        if (!Array.isArray(targets)) throw new TypeError(\'Adapter returned invalid targets\');',
      '        target = targets.find((candidate) => candidate?.targetId === targetKey);',
      '        if (!target) throw deliveryError(\'unknown-target\', \'Unknown target\');',
      '      }',
      '      cancellation(signal);',
      '      if (typeof text === \'string\' && text.trim()) {',
      '        await adapter.sendText(id, target, text, {',
      '          signal,',
      '          ...(format === \'markdown\' ? { format } : {}),',
      '        });',
      '      }',
      '      if (typeof adapter.sendImage !== \'function\') throw deliveryError(\'capability-unavailable\');',
      '      await adapter.sendImage(id, target, { fileName, bytes }, { signal });',
      '      return { sent: true };',
      '    } catch (error) {',
      '      if (signal?.aborted || error?.name === \'AbortError\' || error?.code === \'ABORT_ERR\') {',
      '        throw deliveryError(\'cancelled\', \'Request cancelled\', { cause: error });',
      '      }',
      '      throw publicOperationError(error);',
      '    }',
      '  }',
      '',
      '  async #checkedRegistrationFor(botId) {',
    ].join('\n'),
  },
]);

// 2) delivery-adapter.mjs —— sendImage
await patchFile('plugin-src/host/delivery-adapter.mjs', [
  {
    name: 'adapter sendImage',
    find: [
      '      const result = await coreController.sendProactiveText(botId, normalized, text, options);',
      '      return options.receipt === true ? result : { sent: true };',
      '    },',
    ].join('\n'),
    replace: [
      '      const result = await coreController.sendProactiveText(botId, normalized, text, options);',
      '      return options.receipt === true ? result : { sent: true };',
      '    },',
      '    async sendImage(botId, target, file, options = {}) {',
      '      const normalized = normalizeDeliveryTarget(channel, targetWithoutSessionSync(target));',
      '      if (typeof coreController.sendProactiveImage !== \'function\') {',
      '        throw new TypeError(\'delivery controller cannot send proactive image\');',
      '      }',
      '      const result = await coreController.sendProactiveImage(botId, normalized, file, options);',
      '      return options.receipt === true ? result : { sent: true };',
      '    },',
    ].join('\n'),
  },
]);

// 3) delivery-rpc.mjs —— 允许 image 字段 + 分发 + 方法白名单
await patchFile('plugin-src/host/delivery-rpc.mjs', [
  {
    name: 'payload validation',
    find: [
      '  if (endpoint === DELIVERY_ENDPOINTS.send) {',
      '    return (exactKeys(payload, [\'botId\', \'targetId\', \'text\'])',
      '        || (exactKeys(payload, [\'botId\', \'targetId\', \'text\', \'format\'])',
      '          && [\'plain\', \'markdown\'].includes(payload.format)))',
      '      && validBotId(payload.botId) && validTargetId(payload.targetId)',
      '      && typeof payload.text === \'string\' && Boolean(payload.text.trim());',
      '  }',
    ].join('\n'),
    replace: [
      '  if (endpoint === DELIVERY_ENDPOINTS.send) {',
      '    if (!validBotId(payload.botId) || !validTargetId(payload.targetId)) return false;',
      '    if (payload.format !== undefined && ![\'plain\', \'markdown\'].includes(payload.format)) return false;',
      '    const text = typeof payload.text === \'string\' && Boolean(payload.text.trim());',
      '    const image = typeof payload.image === \'string\' && Boolean(payload.image.trim());',
      '    if (!text && !image) return false;',
      '    const expected = [\'botId\', \'targetId\', ...[\'text\', \'image\', \'format\'].filter((key) => Object.hasOwn(payload, key))]',
      '      .sort().join(\',\');',
      '    return Object.keys(payload).sort().join(\',\') === expected;',
      '  }',
    ].join('\n'),
  },
  {
    name: 'dispatch',
    find: [
      '      } else if (endpoint === DELIVERY_ENDPOINTS.send) {',
      '        value = await service.send(payload.botId, payload.targetId, payload.text, {',
      '          signal,',
      '          ...(payload.format === undefined ? {} : { format: payload.format }),',
      '        });',
    ].join('\n'),
    replace: [
      '      } else if (endpoint === DELIVERY_ENDPOINTS.send) {',
      '        if (payload.image === undefined) {',
      '          value = await service.send(payload.botId, payload.targetId, payload.text, {',
      '            signal,',
      '            ...(payload.format === undefined ? {} : { format: payload.format }),',
      '          });',
      '        } else {',
      '          value = await service.sendImage(payload.botId, payload.targetId, payload.image, {',
      '            signal,',
      '            ...(payload.text === undefined ? {} : { text: payload.text }),',
      '            ...(payload.format === undefined ? {} : { format: payload.format }),',
      '          });',
      '        }',
    ].join('\n'),
  },
  {
    name: 'service method whitelist',
    find: ["    'send',", "    'listTargets',"].join('\n'),
    replace: ["    'send',", "    'sendImage',", "    'listTargets',"].join('\n'),
  },
]);

// 4) qq-controller.mjs —— sendProactiveImage
await patchFile('src/channels/qq/qq-controller.mjs', [
  {
    name: 'controller sendProactiveImage',
    find: [
      '      return runtime.sendProactiveText(target, text, options);',
      '    });',
      '  }',
    ].join('\n'),
    replace: [
      '      return runtime.sendProactiveText(target, text, options);',
      '    });',
      '  }',
      '',
      '  async sendProactiveImage(botId, target, file, options = {}) {',
      '    const config = this.#configStore.get(botId);',
      '    if (!config) throw new Error(\'Unknown QQ bot\');',
      '    return this.#withBotTransition(botId, async () => {',
      '      const runtime = this.#runtimes.get(botId);',
      '      if (!runtime?.status?.ready || typeof runtime.sendProactiveImage !== \'function\') {',
      '        const error = new Error(t(\'QQ机器人尚未连接\'));',
      '        error.code = \'bot-not-connected\';',
      '        throw error;',
      '      }',
      '      return runtime.sendProactiveImage(target, file, options);',
      '    });',
      '  }',
    ].join('\n'),
  },
]);

// 5) qq-runtime.mjs —— 导入 sendQqImage + sendProactiveImage
await patchFile('src/channels/qq/qq-runtime.mjs', [
  {
    name: 'import sendQqImage',
    find: "import { createQqBridgeStatus, QqHarnessBridge } from './qq-bridge.mjs';",
    replace: "import { createQqBridgeStatus, QqHarnessBridge, sendQqImage } from './qq-bridge.mjs';",
  },
  {
    name: 'runtime sendProactiveImage',
    find: ['    return this.#bot.sendText(replyTarget, text);', '  }', '', '  async start() {'].join('\n'),
    replace: [
      '    return this.#bot.sendText(replyTarget, text);',
      '  }',
      '',
      '  async sendProactiveImage(target, file, { signal } = {}) {',
      '    const nativeId = target?.kind === \'user\'',
      '      ? (typeof target?.route?.userOpenId === \'string\' ? target.route.userOpenId.trim() : \'\')',
      '      : target?.kind === \'group\'',
      '        ? (typeof target?.route?.groupOpenId === \'string\' ? target.route.groupOpenId.trim() : \'\')',
      '        : \'\';',
      '    if (!nativeId) {',
      '      const error = new TypeError(\'Invalid QQ proactive delivery target\');',
      '      error.code = \'invalid-target\';',
      '      throw error;',
      '    }',
      '    if (!this.#status.ready || !this.#bot) {',
      '      const error = new Error(\'QQ bot is not connected\');',
      '      error.code = \'bot-not-connected\';',
      '      throw error;',
      '    }',
      '    signal?.throwIfAborted();',
      '    const replyTarget = {',
      '      scope: target.kind === \'user\' ? \'c2c\' : \'group\',',
      '      targetId: nativeId,',
      '    };',
      '    await sendQqImage(this.#bot, replyTarget, file, { signal });',
      '    return { sent: true };',
      '  }',
      '',
      '  async start() {',
    ].join('\n'),
  },
]);

console.log('all patches applied');
