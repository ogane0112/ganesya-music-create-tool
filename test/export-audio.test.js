import { describe, expect, it } from 'vitest';
import { downloadResponse, exportStatus, newToken, PART_BYTES, saveDone, savePart, verifyToken } from '../worker/render.js';
import { handleMcp } from '../worker/mcp.js';
import { TOOLS } from '../worker/tools.js';
import { notFound } from '../worker/db.js';
import { loadMinimalSong } from './helpers.js';

/** KV の代わり */
function memoryKv() {
  /** @type {Map<string, any>} */
  const m = new Map();
  return {
    m,
    /** @param {string} k @param {any} v */
    async put(k, v) { m.set(k, v); },
    /** @param {string} k @param {string} [type] */
    async get(k, type) {
      const v = m.get(k);
      if (v === undefined) return null;
      if (type === 'json') return JSON.parse(v);
      return v;
    },
  };
}

describe('音声の書き出し', () => {
  const secret = 'test-secret';
  it('署名つきの合言葉:正しいものだけ通る', async () => {
    const t = await newToken(secret);
    const id = await verifyToken(secret, t);
    expect(id).toBeTruthy();
    expect(t.startsWith(`${id}.`)).toBe(true);
    expect(await verifyToken('other-secret', t)).toBeNull();
    expect(await verifyToken(secret, `${t}x`)).toBeNull();
    expect(await verifyToken(secret, 'abc.def')).toBeNull();
    expect(await verifyToken(secret, 'nodot')).toBeNull();
    expect(await newToken(secret)).not.toBe(t);
  });

  it('送られてきた一部を保存し、つないで返す。でたらめなものは受けない', async () => {
    const SOUNDS = memoryKv();
    const env = { SOUNDS, RENDER_SECRET: secret };
    const t = await newToken(secret);
    const id = /** @type {string} */ (await verifyToken(secret, t));
    const a = new Uint8Array(PART_BYTES).fill(1);
    const b = new Uint8Array(1000).fill(2);
    expect(await savePart(env, t, 0, a.buffer)).toBe(true);
    expect(await savePart(env, t, 1, b.buffer)).toBe(true);
    expect(await savePart(env, 'x.y', 0, b.buffer)).toBe(false); // 署名が違う
    expect(await savePart(env, t, 99, b.buffer)).toBe(false); // 番号が大きすぎる
    expect(await savePart(env, t, 0, new ArrayBuffer(PART_BYTES + 1))).toBe(false); // 大きすぎる
    expect(await savePart({ SOUNDS }, t, 0, b.buffer)).toBe(false); // 秘密の値がない

    // まだ書き出しが終わっていない(meta がない)うちは渡さない
    expect(await downloadResponse(env, t)).toBeNull();
    await SOUNDS.put(`render/meta/${id}`, JSON.stringify({ parts: 2, bytes: a.length + b.length, fileName: '夜明け.wav' }));
    const res = await downloadResponse(env, t);
    expect(res?.headers.get('content-type')).toBe('audio/wav');
    expect(res?.headers.get('content-length')).toBe(String(a.length + b.length));
    expect(res?.headers.get('content-disposition')).toContain(encodeURIComponent('夜明け.wav'));
    const body = new Uint8Array(await /** @type {Response} */ (res).arrayBuffer());
    expect(body.length).toBe(a.length + b.length);
    expect(body[0]).toBe(1);
    expect(body[a.length - 1]).toBe(1);
    expect(body[a.length]).toBe(2);
    // 他の書き出しの合言葉では受け取れない
    expect(await downloadResponse(env, await newToken(secret))).toBeNull();
    expect(await downloadResponse(env, `${t}z`)).toBeNull();
  });

  it('ページが結果を書く:成功ならURLが取れ、失敗なら理由が取れ、まだなら処理中', async () => {
    const SOUNDS = memoryKv();
    const env = { SOUNDS, RENDER_SECRET: secret };
    const t = await newToken(secret);
    const id = /** @type {string} */ (await verifyToken(secret, t));
    const origin = 'https://app.example';
    expect(await exportStatus(env, origin, 'x.y')).toBeNull(); // 署名が違う
    await SOUNDS.put(`render/started/${id}`, String(Date.now()));
    expect(await exportStatus(env, origin, t)).toEqual({ status: 'running' });
    // 5分たっても終わらなければ失敗
    await SOUNDS.put(`render/started/${id}`, String(Date.now() - 6 * 60 * 1000));
    expect((await exportStatus(env, origin, t))?.status).toBe('failed');
    await SOUNDS.put(`render/started/${id}`, String(Date.now()));

    // 受け付けない結果
    expect(await saveDone(env, 'x.y', { parts: 1, bytes: 100, seconds: 1 })).toBe(false);
    expect(await saveDone(env, t, { parts: 0, bytes: 100, seconds: 1 })).toBe(false);
    expect(await saveDone(env, t, { parts: 1, bytes: 10, seconds: 1 })).toBe(false);
    expect(await saveDone(env, t, null)).toBe(false);
    expect(await saveDone({ SOUNDS }, t, { parts: 1, bytes: 100, seconds: 1 })).toBe(false);

    expect(await saveDone(env, t, { error: 'ブラウザの中で失敗' })).toBe(true);
    expect(await exportStatus(env, origin, t)).toEqual({ status: 'failed', message: '音声を作れませんでした(ブラウザの中で失敗)' });
    // 成功の結果は、失敗より優先される。ファイル名から、道や制御文字を除く
    expect(await saveDone(env, t, { parts: 3, bytes: 19501064, seconds: 110.6, fileName: '../夜明け/のシャウト.wav' })).toBe(true);
    const done = await exportStatus(env, origin, t);
    expect(done).toMatchObject({ status: 'done', bytes: 19501064, seconds: 110.6, fileName: '..夜明けのシャウト.wav', expiresMinutes: 60 });
    expect(done?.status === 'done' && done.url).toBe(`${origin}/download/${t}/${encodeURIComponent('..夜明けのシャウト.wav')}`);
  });

  it('MCP の道具 export_audio と get_export', async () => {
    expect(TOOLS.map((t) => t.name)).toEqual(expect.arrayContaining(['export_audio', 'get_export']));
    const song = loadMinimalSong();
    const store = { async get(/** @type {string} */ id) { if (id !== 's') throw notFound(); return song; } };
    /** @param {string} name @param {any} ctx @param {any} args */
    const call = async (name, ctx, args) => {
      const res = await handleMcp(new Request('https://x/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }), ctx);
      return /** @type {any} */ (await res.json()).result;
    };
    const none = await call('export_audio', { store }, { songId: 's' });
    expect(none.isError).toBe(true);
    expect(none.content[0].text).toMatch(/使えません.*画面/s);
    expect((await call('get_export', { store }, { jobId: 'a.b' })).isError).toBe(true);

    const done = { status: 'done', url: 'https://x/download/t/a.wav', fileName: 'a.wav', bytes: 10, seconds: 1, expiresMinutes: 60 };
    const ok = await call('export_audio', { store, exportAudio: async () => done }, { songId: 's' });
    expect(ok.isError).toBeUndefined();
    const data = JSON.parse(ok.content[0].text);
    expect(data).toMatchObject({ status: 'done', url: 'https://x/download/t/a.wav' });
    expect(data.note).toMatch('歌声は入っていません');

    const running = await call('export_audio', { store, exportAudio: async () => ({ status: 'running', jobId: 'j1.sig' }) }, { songId: 's' });
    const r = JSON.parse(running.content[0].text);
    expect(r).toMatchObject({ status: 'running', jobId: 'j1.sig' });
    expect(r.note).toMatch('get_export');

    /** @param {any} v */
    const status = (v) => ({ store, exportStatus: async () => v });
    expect(JSON.parse((await call('get_export', status(done), { jobId: 'j1.sig' })).content[0].text).url).toBe(done.url);
    expect(JSON.parse((await call('get_export', status({ status: 'running' }), { jobId: 'j1.sig' })).content[0].text).status).toBe('running');
    expect((await call('get_export', status({ status: 'failed', message: '音声を作れませんでした(x)' }), { jobId: 'j1.sig' })).content[0].text).toMatch(/音声を作れませんでした\(x\)[\s\S]*export_audio/);
    expect((await call('get_export', status(null), { jobId: 'zz' })).content[0].text).toMatch('見つかりません');

    const bad = await call('export_audio', { store, exportAudio: async () => ({}) }, { songId: 's', itemIds: ['nope'] });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch('itemId');
    const failing = await call('export_audio', { store, exportAudio: async () => { throw new Error('ブラウザが起動できません'); } }, { songId: 's' });
    expect(failing.content[0].text).toMatch(/ブラウザが起動できません[\s\S]*画面/);
  });
});
