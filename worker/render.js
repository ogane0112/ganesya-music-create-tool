// 音声の書き出し(MCP の export_audio)。
// 音は、アプリの画面と同じ仕組み(ブラウザの Web Audio)で作る。Workers には Web Audio がないので、
// Cloudflare の Browser Rendering(サーバー側のヘッドレス Chrome)にアプリの書き出しページ(/render)を開かせ、
// そのページが作った WAV を分割して受け取り、一時的に保存して、ダウンロードできるURLを返す。
//   1. 曲データは、ページが開く前に渡す(evaluateOnNewDocument)。保存先を読み戻さないので、反映の遅れに左右されない
//   2. ページは PUT /render/part/<token>/<番号> で WAV を8MBずつ送る(token は署名つきで、この書き出しだけに使える)
//   3. 書き出したファイルは1時間だけ置き、GET /download/<token>/<名前>.wav で受け取る
// 歌声(VOICEVOX)は利用者のPCで作るので、サーバーの書き出しには入らない(楽器の演奏だけ)。
import puppeteer from '@cloudflare/puppeteer';
import { base64url, fromBase64url, randomToken } from './b64.js';

export const PART_BYTES = 8 * 1024 * 1024;
const TTL_SECONDS = 3600;
/** MCP の呼び出しを待たせすぎないよう、ここまでで終わらなければ「処理中」として返す */
const WAIT_MS = 25_000;
/** Worker が離れたあとも、ブラウザを動かし続ける時間 */
const KEEP_ALIVE_MS = 180_000;

/** @param {string} secret */
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/**
 * 書き出し1回ぶんの署名つきの合言葉(token)を作る。形は <id>.<署名>
 * @param {string} secret
 */
export async function newToken(secret) {
  const id = randomToken();
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(id));
  return `${id}.${base64url(sig)}`;
}

/**
 * token が正しければ id を返す(違えば null)
 * @param {string} secret
 * @param {string} token
 */
export async function verifyToken(secret, token) {
  const [id, sig] = token.split('.');
  if (!id || !sig || id.length > 64 || sig.length > 64) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromBase64url(sig), new TextEncoder().encode(id));
  } catch {
    return null;
  }
  return ok ? id : null;
}

/**
 * ページから送られてきた WAV の一部を保存する
 * @param {{ SOUNDS: any, RENDER_SECRET?: string }} env
 * @param {string} token
 * @param {number} index
 * @param {ArrayBuffer} bytes
 */
export async function savePart(env, token, index, bytes) {
  const id = env.RENDER_SECRET ? await verifyToken(env.RENDER_SECRET, token) : null;
  if (!id || !Number.isInteger(index) || index < 0 || index > 40 || bytes.byteLength === 0 || bytes.byteLength > PART_BYTES) return false;
  await env.SOUNDS.put(`render/part/${id}/${index}`, bytes, { expirationTtl: TTL_SECONDS });
  return true;
}

/** ファイル名に使えない文字を除く @param {unknown} name */
function safeFileName(name) {
  const base = String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 80);
  return base || 'song.wav';
}

/**
 * ページが書いた結果を保存する(成功なら meta、失敗なら error)
 * @param {{ SOUNDS: any, RENDER_SECRET?: string }} env
 * @param {string} token
 * @param {any} body
 */
export async function saveDone(env, token, body) {
  const id = env.RENDER_SECRET ? await verifyToken(env.RENDER_SECRET, token) : null;
  if (!id || typeof body !== 'object' || body === null) return false;
  if (typeof body.error === 'string') {
    await env.SOUNDS.put(`render/error/${id}`, body.error.slice(0, 300), { expirationTtl: TTL_SECONDS });
    return true;
  }
  const { parts, bytes, seconds } = body;
  if (!Number.isInteger(parts) || parts < 1 || parts > 41 || !Number.isInteger(bytes) || bytes < 44 || typeof seconds !== 'number') return false;
  await env.SOUNDS.put(`render/meta/${id}`, JSON.stringify({ parts, bytes, seconds, fileName: safeFileName(body.fileName) }), { expirationTtl: TTL_SECONDS });
  return true;
}

/**
 * 書き出しの状態を調べる
 * @param {{ SOUNDS: any, RENDER_SECRET?: string }} env
 * @param {string} origin
 * @param {string} token
 * @returns {Promise<{ status: 'done', url: string, fileName: string, bytes: number, seconds: number, expiresMinutes: number } | { status: 'running' } | { status: 'failed', message: string } | null>} token が違えば null
 */
export async function exportStatus(env, origin, token) {
  const id = env.RENDER_SECRET ? await verifyToken(env.RENDER_SECRET, token) : null;
  if (!id) return null;
  /** @type {{ parts: number, bytes: number, seconds: number, fileName: string } | null} */
  const meta = await env.SOUNDS.get(`render/meta/${id}`, 'json');
  if (meta) {
    return { status: 'done', url: `${origin}/download/${token}/${encodeURIComponent(meta.fileName)}`, fileName: meta.fileName, bytes: meta.bytes, seconds: meta.seconds, expiresMinutes: TTL_SECONDS / 60 };
  }
  const error = await env.SOUNDS.get(`render/error/${id}`);
  if (error) return { status: 'failed', message: `音声を作れませんでした(${error})` };
  const started = Number(await env.SOUNDS.get(`render/started/${id}`));
  if (started && Date.now() - started > 5 * 60 * 1000) return { status: 'failed', message: '音声の書き出しが5分たっても終わりませんでした。もう一度試してください' };
  return { status: 'running' };
}

/**
 * 曲の音声の書き出しを始める。WAIT_MS までに終われば、ダウンロードのURLを返す。
 * 終わらなければ、ブラウザはそのまま動かし続け、exportStatus で受け取れるよう jobId(= token)を返す
 * @param {{ SOUNDS: any, BROWSER?: any, RENDER_SECRET?: string }} env
 * @param {string} origin このアプリのアドレス
 * @param {import('../src/core/types.js').Song} song
 * @param {{ itemIds?: string[] }} [opts]
 * @returns {Promise<{ status: 'done', url: string, fileName: string, bytes: number, seconds: number, expiresMinutes: number, timing?: Record<string, number> } | { status: 'running', jobId: string, waitedSeconds: number }>}
 */
export async function renderAudio(env, origin, song, opts = {}) {
  if (!env.RENDER_SECRET || !env.BROWSER) throw new Error('サーバーでの音声の書き出しは、この環境では設定されていません');
  const token = await newToken(env.RENDER_SECRET);
  const id = token.split('.')[0];
  const fileName = safeFileName(`${song.meta.title || 'song'}.wav`);
  const started = Date.now();
  await env.SOUNDS.put(`render/started/${id}`, String(started), { expirationTtl: TTL_SECONDS });
  /** @type {Awaited<ReturnType<typeof puppeteer.launch>>} */
  let browser;
  try {
    // keep_alive:Worker が離れても、ブラウザをしばらく動かし続ける
    browser = await puppeteer.launch(env.BROWSER, { keep_alive: KEEP_ALIVE_MS });
  } catch (e) {
    // Browser Rendering には、1分あたりのブラウザの起動回数に上限がある(429)
    if (e instanceof Error && /429|rate limit/i.test(e.message)) throw new Error('音声の書き出しが立て込んでいます(サーバーのブラウザの起動回数の上限)。1分ほど待ってから、もう一度試してください');
    throw e;
  }
  const launchMs = Date.now() - started;
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument((job) => {
      /** @type {any} */ (window).__renderJob = job;
    }, { token, song, itemIds: opts.itemIds ?? null, fileName });
    await page.goto(`${origin}/render`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction('window.__renderDone === true', { timeout: WAIT_MS, polling: 200 });
    } catch (e) {
      if (e instanceof Error && e.name === 'TimeoutError') {
        // まだ終わっていない。ブラウザはそのままにして、離れる(get_export であとから受け取る)
        await browser.disconnect();
        return { status: 'running', jobId: token, waitedSeconds: Math.round((Date.now() - started) / 1000) };
      }
      throw e;
    }
    const error = await page.evaluate(() => /** @type {any} */ (window).__renderError ?? null);
    if (error) throw new Error(`音声を作れませんでした(${error})`);
    const result = await page.evaluate(() => /** @type {any} */ (window).__renderResult);
    await browser.close().catch(() => {});
    return {
      status: 'done',
      url: `${origin}/download/${token}/${encodeURIComponent(fileName)}`,
      fileName,
      bytes: result.bytes,
      seconds: result.seconds,
      expiresMinutes: TTL_SECONDS / 60,
      // 内訳(ミリ秒):ブラウザの起動、ページを開いてから音づくりを始めるまで、音づくり、送信
      timing: { launchMs, totalMs: Date.now() - started, loadMs: result.loadMs ?? 0, renderMs: result.renderMs ?? 0, uploadMs: result.uploadMs ?? 0 },
    };
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

/**
 * 書き出したファイルを返す(KVに分けて置いた8MBずつを、つないで流す)
 * @param {{ SOUNDS: any, RENDER_SECRET?: string }} env
 * @param {string} token
 * @returns {Promise<Response | null>}
 */
export async function downloadResponse(env, token) {
  const id = env.RENDER_SECRET ? await verifyToken(env.RENDER_SECRET, token) : null;
  if (!id) return null;
  /** @type {{ parts: number, bytes: number, fileName: string } | null} */
  const meta = await env.SOUNDS.get(`render/meta/${id}`, 'json');
  if (!meta) return null;
  let i = 0;
  const body = new ReadableStream({
    async pull(controller) {
      if (i >= meta.parts) return controller.close();
      const part = await env.SOUNDS.get(`render/part/${id}/${i++}`, 'arrayBuffer');
      if (!part) return controller.error(new Error('書き出したファイルの一部が見つかりません'));
      controller.enqueue(new Uint8Array(part));
    },
  });
  return new Response(body, {
    headers: {
      'content-type': 'audio/wav',
      'content-length': String(meta.bytes),
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(meta.fileName)}`,
      'cache-control': 'private, no-store',
    },
  });
}
