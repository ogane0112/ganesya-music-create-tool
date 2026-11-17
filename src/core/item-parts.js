// 並びの1か所の中身を決める。部品(メロディ・コード・伴奏)を土台に、その場所だけの設定を反映する。
//   styles      : 伴奏の弾き方を変える(指定したパートだけ作り直す。メロディとコードは部品のまま)
//   fx          : つなぎの演出(頭のシンバル、最後のフィル、上がっていく効果音、無音のブレイク)
//   mix・instruments は鳴らす時に使う(ここでは消音のパートを外すだけ)
// 同じ並びの項目なら、いつも同じ結果になる(項目のIDから乱数を決める)。
import { composeSection, resolveMood, tracksByRole } from './composer/index.js';
import { DRUM, drumFill } from './composer/drums.js';
import { createRng } from './random.js';
import { ticksPerBar } from './theory.js';

/** @typedef {import('./types.js').Song} Song */
/** @typedef {import('./types.js').Section} Section */
/** @typedef {import('./types.js').ArrangementItem} ArrangementItem */
/** @typedef {Omit<import('./types.js').Note, 'id'> & { id?: string }} PartNote */

/** @param {string} text */
function seedOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 0x7fffffff;
}

/** 弾き方の項目 → 作り直すパート */
const STYLE_PARTS = /** @type {const} */ ({ chordStyle: 'chords', bassStyle: 'bass', drumStyle: 'drums', leadStyle: 'lead' });

/**
 * @param {Song} song
 * @param {ArrangementItem} item
 * @param {Section} section
 * @returns {Record<string, PartNote[]>} トラックIDごとの音符(元の部品は書き換えない)
 */
export function resolveItemParts(song, item, section) {
  /** @type {Record<string, PartNote[]>} */
  let parts = { ...section.parts };
  const roles = tracksByRole(song.tracks);
  const barTicks = ticksPerBar(song.timeSignature);
  const total = section.bars * barTicks;

  // --- 弾き方の上書き
  const asked = Object.keys(item.styles ?? {}).filter((k) => item.styles?.[/** @type {keyof typeof STYLE_PARTS} */ (k)]);
  if (item.styles && asked.length) {
    const key = section.key ?? song.key;
    const melody = roles.melody ? (section.parts[roles.melody] ?? []).map(({ id: _id, ...n }) => n) : [];
    const content = composeSection(
      { key, mood: resolveMood(song.mood, key.mode), kind: section.kind, bars: section.bars, timeSignature: song.timeSignature, roles },
      createRng(seedOf(item.id)),
      {
        chords: section.chords, melody, styles: item.styles,
        only: asked.map((k) => STYLE_PARTS[/** @type {keyof typeof STYLE_PARTS} */ (k)]),
      },
    );
    parts = { ...parts, ...content.parts };
  }

  // --- つなぎの演出
  const fx = item.fx;
  const rng = createRng(seedOf(`${item.id}:fx`));
  if (fx && (fx.crash || fx.fill || fx.riser) && roles.drums) {
    const drums = [...(parts[roles.drums] ?? [])];
    if (fx.fill) {
      const from = total - barTicks;
      for (let i = drums.length - 1; i >= 0; i--) if (drums[i].start >= from) drums.splice(i, 1);
      drums.push(...drumFill(from, rng));
    }
    if (fx.crash) drums.push({ start: 0, length: 1440, pitch: DRUM.crash, velocity: 112 });
    if (fx.riser) drums.push({ start: Math.max(0, total - 2 * barTicks), length: Math.min(total, 2 * barTicks), pitch: DRUM.riser, velocity: 100 });
    parts[roles.drums] = drums;
  }
  const breakBeats = fx?.break ?? 0;
  if (breakBeats > 0) {
    // 終わりの数拍は、歌以外を止める(上がっていく効果音とフィルは残す)
    const from = total - Math.min(total, breakBeats * 480);
    for (const [tid, notes] of Object.entries(parts)) {
      if (tid === roles.melody) continue;
      const isDrums = tid === roles.drums;
      parts[tid] = notes
        .filter((n) => n.start < from || (isDrums && n.pitch === DRUM.riser))
        .map((n) => (!isDrums && n.start + n.length > from ? { ...n, length: Math.max(60, from - n.start) } : n));
    }
  }

  // --- 消音(この場所だけ)
  for (const [tid, m] of Object.entries(item.mix ?? {})) if (m.muted) parts[tid] = [];
  return parts;
}
