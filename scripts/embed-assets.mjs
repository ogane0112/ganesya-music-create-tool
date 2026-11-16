// dist の中身を Worker に埋め込むためのファイル(worker/generated-assets.js)を作る。
// この開発環境では Workers の静的ファイルのアップロードが通らないため、画面のファイルをスクリプトに同梱して配る。
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const TEXT = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg']);

const root = new URL('../dist/', import.meta.url).pathname;
/** @type {Record<string, { type: string, body: string, base64: boolean }>} */
const files = {};
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else {
      const ext = extname(p);
      const text = TEXT.has(ext);
      files['/' + relative(root, p)] = {
        type: TYPES[ext] ?? 'application/octet-stream',
        body: text ? readFileSync(p, 'utf8') : readFileSync(p).toString('base64'),
        base64: !text,
      };
    }
  }
})(root);
writeFileSync(new URL('../worker/generated-assets.js', import.meta.url), `// 自動生成(scripts/embed-assets.mjs)。手で直さない\nexport const ASSETS = ${JSON.stringify(files)};\n`);
console.log(`embedded ${Object.keys(files).length} files`);
