// 演奏の表情。楽譜どおりの位置・そろった強さで鳴らすと機械的に聞こえるので、人が弾いたような揺れを付ける。
// 曲データ(音符)は書き換えず、鳴らす直前に「何秒ずらすか」「どの強さで弾くか」を決める(MIDIの書き出しは楽譜どおりのまま)。
// 同じ曲なら毎回同じ揺れになる(音符のIDから決める)。再生とWAVで同じ演奏になる。
//
// - タイミング:楽器ごとに数ミリ秒の揺れ。スネアは少し後ろ(どっしり)、ハイハットは細かく揺れる
// - 和音のばらし:ギターは弦を順に弾く(下ろす・上げるを交互に)。ピアノは指がわずかにずれる
// - 強弱:拍の頭は強く、裏は弱く。Aメロは抑えめ、サビは強く。Bメロは終わりに向かって盛り上がる
// - フレーズ:メロディは山なりの抑揚(フレーズの中ほどが一番強い)

/** @typedef {import('./types.js').Song} Song */
/** @typedef {import('./timeline.js').Timeline} Timeline */
/** @typedef {import('./timeline.js').TimelineEvent} TimelineEvent */
import { ticksToSeconds } from './theory.js';
import { buildTimeline } from './timeline.js';

/**
 * @typedef {object} Performed
 * @property {number} offset 楽譜の位置からのずれ(秒。正なら遅れる)
 * @property {number} velocity 弾く強さ(1〜127)
 */

/** 文字列から 0〜1 の決まった数を作る(乱数の代わり。同じ音符なら同じ値) @param {string} text */
function hash01(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
/** -1〜1 @param {string} text */
const jitter = (text) => hash01(text) * 2 - 1;

const GUITARS = new Set(['acoustic-guitar', 'electric-guitar-clean', 'electric-guitar-distortion', 'koto']);
const SECTION_LEVEL = /** @type {Record<string, number>} */ ({ intro: 0.97, verse: 0.9, prechorus: 0.96, chorus: 1.06, bridge: 0.94, outro: 0.92, other: 1 });

/**
 * 曲の音符1つずつに、演奏の表情を付ける
 * @param {Song} song
 * @param {Timeline} timeline
 * @returns {Map<TimelineEvent, Performed>}
 */
export function perform(song, timeline) {
  const tracks = new Map(song.tracks.map((t) => [t.id, t]));
  const kinds = new Map(song.arrangement.map((a) => [a.id, song.sections.find((s) => s.id === a.sectionId)?.kind ?? 'other']));
  const items = new Map(timeline.items.map((i) => [i.itemId, i]));
  /** @type {Map<TimelineEvent, Performed>} */
  const out = new Map();

  // 同じパートで同時に鳴る音(和音)をまとめる
  /** @type {Map<string, TimelineEvent[]>} */
  const groups = new Map();
  for (const ev of timeline.events) {
    const key = `${ev.trackId}:${ev.itemId}:${ev.tick}`;
    const g = groups.get(key);
    if (g) g.push(ev);
    else groups.set(key, [ev]);
  }

  for (const [key, group] of groups) {
    const first = group[0];
    const track = tracks.get(first.trackId);
    if (!track) continue;
    const item = items.get(first.itemId);
    const kind = kinds.get(first.itemId) ?? 'other';
    const inItem = item ? (first.tick - item.startTick) / Math.max(1, item.endTick - item.startTick) : 0;
    const beatPos = first.tick % 480; // 拍の中の位置
    const onBeat = beatPos === 0;
    const onEighth = beatPos === 240;

    // 部品ごとの強さ。Bメロは後半に向けて盛り上げる
    let level = SECTION_LEVEL[kind] ?? 1;
    if (kind === 'prechorus') level += 0.1 * Math.max(0, inItem - 0.5) * 2;

    // そのパートの持ち味の揺れ(秒)
    let spread = 0.006;
    if (track.role === 'drums') spread = 0.003;
    else if (track.role === 'bass') spread = 0.005;
    else if (track.role === 'vocal') spread = 0.009;
    else if (track.role === 'pad') spread = 0;
    const groupOffset = jitter(`${key}:t`) * spread;

    // 和音のばらし方
    const sorted = [...group].sort((a, b) => a.pitch - b.pitch);
    const isGuitar = GUITARS.has(track.instrument);
    const upStroke = isGuitar && !onBeat; // 裏拍は下から上ではなく上から下へ
    const perNote = track.role === 'drums' || sorted.length < 2 ? 0 : isGuitar ? 0.011 : track.instrument === 'piano' || track.instrument === 'electric-piano' ? 0.004 : 0.002;

    sorted.forEach((ev, i) => {
      let offset = groupOffset;
      let velocity = ev.velocity * level;
      const id = `${ev.noteId}:${ev.itemId}`;
      if (track.role === 'drums') {
        // 打楽器ごとの癖
        if (ev.pitch === 38 || ev.pitch === 40) offset = 0.004 + jitter(`${id}:t`) * 0.004; // スネアは少し後ろ
        else if (ev.pitch === 42 || ev.pitch === 44 || ev.pitch === 46) {
          offset = jitter(`${id}:t`) * 0.006;
          // ハイハットは拍の頭を強く、裏を弱く
          velocity *= onBeat ? 1.08 : onEighth ? 0.92 : 0.78;
        } else if (ev.pitch === 35 || ev.pitch === 36) offset = jitter(`${id}:t`) * 0.002; // バスドラムは正確に
        else offset = jitter(`${id}:t`) * 0.004;
        velocity += jitter(`${id}:v`) * 7;
      } else {
        if (perNote) {
          const order = upStroke ? sorted.length - 1 - i : i;
          offset += order * perNote * (0.8 + hash01(`${key}:s`) * 0.4);
          // ばらした和音は、後から鳴る音ほど少し弱い
          velocity *= 1 - order * 0.02;
        }
        if (track.role === 'vocal' || track.role === 'lead' || track.role === 'other') {
          // フレーズの抑揚:拍の頭はしっかり、細かい音は軽く
          velocity *= onBeat ? 1.04 : onEighth ? 0.98 : 0.93;
        } else if (track.role === 'chords' || track.role === 'bass') {
          velocity *= onBeat ? 1.05 : 0.95;
        }
        velocity += jitter(`${id}:v`) * 5;
      }
      out.set(ev, { offset, velocity: Math.max(1, Math.min(127, Math.round(velocity))) });
    });
  }
  return out;
}

/**
 * 鳴らす音1つ(表情を付けた後)
 * @typedef {object} PerformedNote
 * @property {string} trackId
 * @property {string} itemId
 * @property {number} time 再生範囲の頭からの秒
 * @property {number} duration 秒
 * @property {number} pitch
 * @property {number} velocity
 * @property {number} [gain] この場所だけの音量の倍率
 * @property {string} [instrument] この場所だけの楽器
 */

/**
 * 曲を並び順どおりに並べ、演奏の表情を付けて、鳴らす順に返す。再生・WAV・音の作り置きで共通に使う
 * @param {Song} song
 * @param {{ itemIds?: string[] }} [opts]
 * @returns {{ timeline: Timeline, notes: PerformedNote[], totalSeconds: number }}
 */
export function performSong(song, opts = {}) {
  const timeline = buildTimeline(song, opts);
  const expression = perform(song, timeline);
  const h = song.humanize ?? 1; // 揺らぎの強さ(0 = 楽譜どおり)
  /** @type {PerformedNote[]} */
  const notes = timeline.events.map((ev) => {
    const p = expression.get(ev);
    return {
      trackId: ev.trackId,
      itemId: ev.itemId,
      time: Math.max(0, ticksToSeconds(ev.tick, song.tempo) + (p?.offset ?? 0) * h),
      duration: ticksToSeconds(ev.length, song.tempo),
      pitch: ev.pitch,
      velocity: p ? Math.max(1, Math.min(127, Math.round(ev.velocity + (p.velocity - ev.velocity) * h))) : ev.velocity,
      ...(ev.gain !== undefined ? { gain: ev.gain } : {}),
      ...(ev.instrument ? { instrument: ev.instrument } : {}),
    };
  });
  notes.sort((a, b) => a.time - b.time);
  return { timeline, notes, totalSeconds: ticksToSeconds(timeline.totalTicks, song.tempo) };
}
