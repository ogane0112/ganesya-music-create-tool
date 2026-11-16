// 別案を作るルール(B7)。部品1つについて、互いに違う別案を3つ返す。保存はしない。
// 返す別案は replaceSection にそのまま渡せる形。
import { composeSection, resolveMood, tracksByRole } from './composer/index.js';
import { generateProgression } from './composer/progressions.js';
import { MOOD_STYLES, styleKindOf } from './composer/styles.js';
import { createRng, randomSeed } from './random.js';
import { chordPitchClasses, mod12 } from './theory.js';
import { fail } from './operations.js';

/** @typedef {import('./types.js').Song} Song */
/** @typedef {import('./types.js').Chord} Chord */
/** @typedef {Omit<import('./types.js').Note, 'id'>} NoteData */

/** @typedef {'melody' | 'chords' | 'accompaniment' | 'all'} AlternativeTarget */

/** 画面に出す対象の名前 */
export const ALTERNATIVE_TARGETS = /** @type {{ id: AlternativeTarget, label: string, help: string }[]} */ ([
  { id: 'melody', label: 'メロディ', help: '歌の節回しだけを変える' },
  { id: 'chords', label: 'コード進行', help: '曲の雰囲気を決める和音の流れを変える(メロディはそのまま)' },
  { id: 'accompaniment', label: '伴奏', help: '楽器の弾き方とリズムを変える(メロディと和音の流れはそのまま)' },
  { id: 'all', label: '全部', help: 'この部品を丸ごと作り直す' },
]);

/**
 * @typedef {object} Alternative
 * @property {string} label
 * @property {{ chords?: Chord[], parts: Record<string, NoteData[]> }} replacement
 */

/** @param {import('./types.js').Note[]} notes @returns {NoteData[]} */
const stripIds = (notes) => notes.map(({ id: _id, ...rest }) => rest);

/**
 * メロディの強い拍の音がコードの音にどれだけ合うか(高いほど合う)
 * @param {NoteData[]} melody
 * @param {Chord[]} chords
 */
export function melodyFitScore(melody, chords) {
  let score = 0;
  for (const n of melody) {
    const strong = n.start % 480 === 0 || n.length >= 480;
    if (!strong) continue;
    const c = chords.find((x) => n.start >= x.start && n.start < x.start + x.length);
    if (!c) continue;
    score += chordPitchClasses(c.symbol).includes(mod12(n.pitch)) ? 1 : -1;
  }
  return score;
}

/**
 * @param {Song} song
 * @param {string} sectionId
 * @param {AlternativeTarget} target
 * @param {{ count?: number, seed?: number }} [opts]
 * @returns {import('./types.js').Result<Alternative[]>}
 */
export function generateAlternatives(song, sectionId, target, opts = {}) {
  const count = opts.count ?? 3;
  const section = song.sections.find((s) => s.id === sectionId);
  if (!section) return fail(`部品が見つかりません: ${sectionId}`, '曲を読み込み直してください', 'not_found');
  if (!ALTERNATIVE_TARGETS.some((t) => t.id === target)) {
    return fail(`知らない対象です: ${target}`, 'メロディ・コード進行・伴奏・全部 から選んでください');
  }
  const rng = createRng(opts.seed ?? randomSeed());
  const key = section.key ?? song.key;
  const mood = resolveMood(song.mood, key.mode);
  const roles = tracksByRole(song.tracks);
  const ctx = { key, mood, kind: section.kind, bars: section.bars, timeSignature: song.timeSignature, roles };
  const melody = roles.melody ? stripIds(section.parts[roles.melody] ?? []) : [];

  /** @param {Alternative['replacement']} r */
  const signature = (r) => JSON.stringify([r.chords?.map((c) => [c.start, c.length, c.symbol]), Object.entries(r.parts).map(([k, ns]) => [k, ns.map((n) => [n.start, n.length, n.pitch])])]);
  /** 今の中身と同じ形のもの(比較用) */
  /** @param {Alternative['replacement']} r */
  const currentOf = (r) => ({
    chords: r.chords ? section.chords : undefined,
    parts: Object.fromEntries(Object.keys(r.parts).map((k) => [k, stripIds(section.parts[k] ?? [])])),
  });

  /** @type {Alternative[]} */
  const out = [];
  const seen = new Set();
  for (let attempt = 0; out.length < count && attempt < count * 15; attempt++) {
    const r = rng.fork();
    const replacement = makeOne(target, r);
    if (!replacement || Object.keys(replacement.parts).length === 0 && !replacement.chords) continue;
    const sig = signature(replacement);
    if (seen.has(sig) || sig === signature(currentOf(replacement))) continue;
    seen.add(sig);
    out.push({ label: `案${out.length + 1}`, replacement });
  }
  if (out.length < count) {
    return fail('別案を作れませんでした', 'この部品は別の対象(「全部」など)で試してください', 'generation_failed');
  }
  return { ok: true, value: out, warnings: [] };

  /**
   * @param {AlternativeTarget} t
   * @param {import('./random.js').Rng} r
   * @returns {Alternative['replacement'] | null}
   */
  function makeOne(t, r) {
    if (t === 'melody') {
      if (!roles.melody) return null;
      const c = composeSection(ctx, r, { chords: section?.chords, only: ['melody', 'color'] });
      return { parts: c.parts };
    }
    if (t === 'accompaniment') {
      const c = composeSection(ctx, r, { chords: section?.chords, melody, only: ['chords', 'bass', 'drums', 'pad', 'lead', 'color'] });
      return { parts: c.parts };
    }
    if (t === 'chords') {
      // 何通りか作って、今のメロディに一番合うものを選ぶ
      const style = MOOD_STYLES[mood];
      const kind = styleKindOf(ctx.kind);
      let best = /** @type {Chord[] | null} */ (null);
      let bestScore = -Infinity;
      const current = JSON.stringify(section?.chords.map((c) => c.symbol));
      for (let i = 0; i < 6; i++) {
        const chords = generateProgression({ key, style, kind, bars: ctx.bars, timeSignature: ctx.timeSignature, rng: r.fork() });
        if (JSON.stringify(chords.map((c) => c.symbol)) === current) continue;
        const score = melodyFitScore(melody, chords) + r.next();
        if (score > bestScore) {
          best = chords;
          bestScore = score;
        }
      }
      if (!best) return null;
      const c = composeSection(ctx, r, { chords: best, melody, only: ['chords', 'bass', 'pad', 'lead', 'color'] });
      return { chords: best, parts: c.parts };
    }
    const c = composeSection(ctx, r);
    return { chords: c.chords, parts: c.parts };
  }
}
