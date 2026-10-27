import esbuild from 'file:///D:/deepseek/dsh/_dist/.buildtools/node_modules/esbuild/lib/main.js';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { build } = esbuild;

const pkg = 'C:/Users/Administrator/.dsh/profiles/desktop/node_modules/@xmanrui/dsh-im';
const sourceDirectory = resolve(pkg, 'plugin-src/host');
const outputPath = resolve(pkg, 'lib/index.new.js');

const { larkSdkHandshakePatch } = await import(
  pathToFileURL(resolve(sourceDirectory, 'lark-sdk-handshake-patch.mjs')).href
);

const externalRuntimePackages = [
  '@tencent-connect/qqbot-connector',
  '@tencent-connect/qqbot-nodejs',
  '@wecom/aibot-node-sdk',
  'dingtalk-stream',
  'imapflow',
  'mailparser',
  'nodemailer',
  'qrcode',
  'sharp',
  'undici',
];
const external = externalRuntimePackages.flatMap((name) => [name, `${name}/*`]);

await mkdir(dirname(outputPath), { recursive: true });
await build({
  entryPoints: [resolve(sourceDirectory, 'index.mjs')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  mainFields: ['module', 'main'],
  external,
  nodePaths: ['D:/deepseek/dsh/_dist/.buildtools/node_modules'],
  plugins: [larkSdkHandshakePatch],
  outfile: outputPath,
  banner: {
    js: [
      "import { createRequire as __dshCreateRequire } from 'node:module';",
      "import { dirname as __dshDirname } from 'node:path';",
      "import { fileURLToPath as __dshFileURLToPath } from 'node:url';",
      'const require = __dshCreateRequire(import.meta.url);',
      'const __filename = __dshFileURLToPath(import.meta.url);',
      'const __dirname = __dshDirname(__filename);',
    ].join('\n'),
  },
  sourcemap: false,
  minify: true,
  legalComments: 'eof',
});

console.log(`Wrote ${outputPath}`);
