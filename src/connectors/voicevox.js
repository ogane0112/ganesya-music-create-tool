// 接続口:歌声エンジン VOICEVOX。音符と歌詞を渡して、歌声の音声を受け取る。
// VOICEVOX は利用者のPCで動かす(http://localhost:50021)。アプリからはブラウザが直接呼ぶ。
// 確かめた版: VOICEVOX ENGINE 0.26.2(sing_frame_audio_query → frame_synthesis)。
//   - 楽譜は { notes: [{ key, frame_length, lyric }] }。先頭は休み(key: null)。1秒 = 93.75 フレーム
//   - lyric は かな1音。「ー」は受け付けないので、前の音の母音にして送る(core/lyrics.js の sungNotes)
//   - 返る音声は 24000Hz・モノラルの WAV
import { sungNotes } from '../core/lyrics.js';
import { ticksPerBar, ticksToSeconds } from '../core/theory.js';

/** @typedef {import('../core/types.js').Song} Song */

export const VOICEVOX_DEFAULT_URL = 'http://localhost:50021';
/** 楽譜から歌い方(音の高さの揺れ・長さ)を作る役。VOICEVOX が決めている番号 */
const SING_TEACHER = 6000;
/** 初期の歌い手(ずんだもん・あまあま)。曲の extensions.voicevox.singer で変えられる */
export const DEFAULT_SINGER = 3001;
const FPS = 93.75;
const LEAD_SECONDS = 0.5; // 最初の子音が切れないよう、頭に置く休み

/**
 * @typedef {object} ScoreNote
 * @property {number | null} key
 * @property {number} frame_length
 * @property {string} lyric
 */

/**
 * 並び順の1か所を、VOICEVOX の楽譜にする。頭に LEAD_SECONDS の休みが付く
 * @param {Song} song
 * @param {string} itemId
 * @returns {{ notes: ScoreNote[], leadSeconds: number, seconds: number } | null} 歌う音符がなければ null
 */
export function buildScore(song, itemId) {
  const item = song.arrangement.find((a) => a.id === itemId);
  const section = item && song.sections.find((s) => s.id === item.sectionId);
  if (!item || !section) return null;
  const sung = sungNotes(song, itemId);
  if (!sung.length) return null;
  const total = section.bars * ticksPerBar(song.timeSignature);
  // 位置をフレームに直す。1音ずつ丸めると少しずつずれるので、頭からの位置で丸める
  /** @param {number} tick */
  const frameAt = (tick) => Math.round((LEAD_SECONDS + ticksToSeconds(tick, song.tempo)) * FPS);
  /** @type {ScoreNote[]} */
  const notes = [];
  let cursor = 0;
  /** @param {number} to */
  const rest = (to) => {
    if (to <= cursor) return;
    const last = notes[notes.length - 1];
    if (last && last.key === null) last.frame_length += to - cursor;
    else notes.push({ key: null, frame_length: to - cursor, lyric: '' });
    cursor = to;
  };
  rest(frameAt(0));
  sung.forEach(({ note, kana }, i) => {
    const start = Math.max(cursor, frameAt(note.start));
    const nextStart = sung[i + 1] ? frameAt(sung[i + 1].note.start) : Infinity;
    // 楽譜では少し短く書いてある音を、次の音までつなげる(16分音符より短い隙間は埋める)
    let end = frameAt(note.start + note.length);
    if (nextStart - end <= Math.round(ticksToSeconds(120, song.tempo) * FPS)) end = nextStart;
    end = Math.min(end, nextStart, frameAt(total));
    if (end - start < 2) return; // 短すぎて歌えない音は飛ばす
    rest(start);
    notes.push({ key: note.pitch, frame_length: end - start, lyric: kana });
    cursor = end;
  });
  rest(frameAt(total));
  // 最後の音の余韻
  rest(cursor + Math.round(0.3 * FPS));
  return { notes, leadSeconds: LEAD_SECONDS, seconds: cursor / FPS };
}

/** @param {Song} song */
export function singerOf(song) {
  const ext = /** @type {any} */ (song.extensions?.voicevox);
  return Number.isInteger(ext?.singer) ? ext.singer : DEFAULT_SINGER;
}

/**
 * VOICEVOX が使えるか。使えない時は理由と対処を返す
 * @param {string} [baseUrl]
 * @returns {Promise<import('../core/types.js').Availability & { version?: string }>}
 */
export async function voicevoxAvailable(baseUrl = VOICEVOX_DEFAULT_URL) {
  // 確かめたこと(VOICEVOX 0.26.2、Chromium): 既定の設定では、このアプリ(https)からの呼び出しは断られる。
  // VOICEVOX の設定で「Allow Origin」にこのアプリのアドレスを足し、VOICEVOX を再起動すると通る
  const setup = `VOICEVOX の設定ページ(${baseUrl}/setting)を開き、「Allow Origin」に ${location.origin} を入れて保存し、VOICEVOX を再起動してください`;
  try {
    const res = await fetch(`${baseUrl}/version`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { ok: false, reason: `VOICEVOX が接続を断りました(${res.status})。${setup}` };
    return { ok: true, version: await res.json() };
  } catch {
    return {
      ok: false,
      reason: `VOICEVOX につながりません。(1) このPCで VOICEVOX を起動する (2) 初めての時は、${setup} (3) ブラウザが「ローカルネットワークへのアクセス」を聞いてきたら許可する。iPad・スマホでは歌声を作れません(VOICEVOX が動かないため)`,
    };
  }
}

/**
 * 歌い手の一覧
 * @param {string} [baseUrl]
 * @returns {Promise<{ id: number, label: string }[]>}
 */
export async function listSingers(baseUrl = VOICEVOX_DEFAULT_URL) {
  const res = await fetch(`${baseUrl}/singers`);
  /** @type {any[]} */
  const singers = await res.json();
  return singers.flatMap((s) => s.styles.filter((/** @type {any} */ st) => st.type === 'frame_decode').map((/** @type {any} */ st) => ({ id: st.id, label: `${s.name}(${st.name})` })));
}

/**
 * 並び順の1か所を歌わせて、WAV を受け取る
 * @param {Song} song
 * @param {string} itemId
 * @param {{ baseUrl?: string, singer?: number }} [opts]
 * @returns {Promise<{ wav: ArrayBuffer, leadSeconds: number } | null>} 歌う音符がなければ null
 */
export async function singItem(song, itemId, opts = {}) {
  const baseUrl = opts.baseUrl ?? VOICEVOX_DEFAULT_URL;
  const score = buildScore(song, itemId);
  if (!score) return null;
  /** @param {string} path @param {unknown} body */
  const post = async (path, body) => {
    const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.json()).detail ?? '';
      } catch {
        // 本文なし
      }
      throw new Error(`VOICEVOX が歌声を作れませんでした(${res.status} ${detail})`);
    }
    return res;
  };
  const query = await (await post(`/sing_frame_audio_query?speaker=${SING_TEACHER}`, { notes: score.notes })).json();
  const wav = await (await post(`/frame_synthesis?speaker=${opts.singer ?? singerOf(song)}`, query)).arrayBuffer();
  return { wav, leadSeconds: score.leadSeconds };
}

/** @type {import('../core/types.js').EngineConnector} */
export const voicevoxEngine = {
  id: 'voicevox',
  name: '歌声(VOICEVOX)',
  kind: 'engine',
  isAvailable: () => voicevoxAvailable(),
  async run(song, range) {
    try {
      /** @type {Record<string, { wav: ArrayBuffer, leadSeconds: number }>} */
      const out = {};
      for (const itemId of range.arrangementItemIds) {
        const r = await singItem(song, itemId);
        if (r) out[itemId] = r;
      }
      return { ok: true, value: out, warnings: [] };
    } catch (e) {
      return { ok: false, error: { code: 'voicevox_failed', message: e instanceof Error ? e.message : '歌声を作れませんでした', hint: 'VOICEVOX が起動しているか確かめて、もう一度試してください' } };
    }
  },
};
