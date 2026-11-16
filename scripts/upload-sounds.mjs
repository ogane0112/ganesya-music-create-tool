// sounds-build/ の音源(.pack)を置き場(Cloudflare KV)に上げる。--local で手元、--remote で本番。
// 道の版(v3)は src/audio/instruments/sampled.js の SOUNDS_BASE と合わせる。中身を変えたら版を上げる(ブラウザが長く覚えるため)。
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const where = process.argv.includes('--remote') ? '--remote' : '--local';
const dir = new URL('../sounds-build/', import.meta.url).pathname;
for (const name of readdirSync(dir).filter((f) => f.endsWith('.pack'))) {
  execFileSync('npx', ['wrangler', 'kv', 'key', 'put', `v3/${name}`, '--path', dir + name, '--binding', 'SOUNDS', where], { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log(`${where} v1/${name}`);
}
