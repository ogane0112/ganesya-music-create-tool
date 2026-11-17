// 作り手(AIなど)がコード進行とメロディを書き、伴奏はルールが付ける、という作り方の窓口。
// コード進行とメロディは、かんたん記法の文字でも、曲データの形でも渡せる。
import { isMood, isSectionKind, TEMPO_MAX, TEMPO_MIN } from './catalog.js';
import { appendSection, composeSection, createSkeleton, resolveMood, tracksByRole } from './composer/index.js';
import { STYLE_NAMES } from './style-names.js';
import { NotationError, parseChords, parseMelody } from './notation.js';
import { fail } from './operations.js';
import { createRng, randomSeed } from './random.js';
import { isValidTonic, ticksPerBar } from './theory.js';
import { validateSong } from './validate.js';

/** @typedef {import('./types.js').Song} Song */
/** @typedef {import('./types.js').Chord} Chord */
/** @typedef {import('./types.js').Key} Key */
/** @typedef {Omit<import('./types.js').Note, 'id'>} NoteData */

export { STYLE_NAMES };

/**
 * @typedef {object} SectionSpec
 * @property {string} name
 * @property {import('./types.js').SectionKind} kind
 * @property {number} bars
 * @property {Key} [key] この部品だけのキー(転調)。メロディとコードは、このキーで書く。省略は曲のキー
 * @property {string | Chord[]} [chords] 省略するとルールが作る
 * @property {string | NoteData[]} [melody] 省略するとルールが作る
 * @property {Partial<Record<'chordStyle' | 'bassStyle' | 'drumStyle' | 'leadStyle', string>>} [styles]
 */

/** @param {string | Chord[] | undefined} x */
export const resolveChords = (x) => (typeof x === 'string' ? parseChords(x) : x);
/** @param {string | NoteData[] | undefined} x */
export const resolveNotes = (x) => (typeof x === 'string' ? parseMelody(x) : x?.map(({ start, length, pitch, velocity }) => ({ start, length, pitch, velocity: velocity ?? 94 })));

/**
 * 部品1つ分の中身を作る(書かれたコード進行・メロディを使い、残りはルールで作る)
 * 書き方が読めない時は NotationError、中身がおかしい時は Error を投げる
 * @param {Song} song パートとキー・雰囲気を見る
 * @param {{ kind: import('./types.js').SectionKind, bars: number, key?: Key, chords?: string | Chord[], melody?: string | NoteData[], styles?: SectionSpec['styles'], name?: string }} spec
 * @param {{ seed?: number, only?: import('./composer/index.js').Part[] }} [opts]
 */
export function authorSection(song, spec, opts = {}) {
  const label = spec.name ? `「${spec.name}」` : '部品';
  if (!isSectionKind(spec.kind)) throw new Error(`${label}の種類(kind)が違います: ${String(spec.kind)}。intro / verse / prechorus / chorus / bridge / outro / other から選びます`);
  if (!Number.isInteger(spec.bars) || spec.bars < 1 || spec.bars > 64) throw new Error(`${label}の小節数(bars)は1〜64の整数にします`);
  const total = spec.bars * ticksPerBar(song.timeSignature);
  const chords = resolveChords(spec.chords);
  const melody = resolveNotes(spec.melody);
  const chordEnd = Math.max(0, ...(chords ?? []).map((c) => c.start + c.length));
  if (chordEnd > total) throw new Error(`${label}のコード進行が長すぎます(${chordEnd / 480}拍分あるが、${spec.bars}小節 = ${total / 480}拍)`);
  const melodyEnd = Math.max(0, ...(melody ?? []).map((n) => n.start + n.length));
  if (melodyEnd > total) throw new Error(`${label}のメロディが長すぎます(約${Math.ceil(melodyEnd / 480)}拍分あるが、${spec.bars}小節 = ${total / 480}拍)`);
  for (const [k, v] of Object.entries(spec.styles ?? {})) {
    const names = STYLE_NAMES[/** @type {keyof typeof STYLE_NAMES} */ (k)];
    if (!names) throw new Error(`知らない弾き方の項目です: ${k}`);
    if (!names.includes(/** @type {string} */ (v))) throw new Error(`${k} は ${names.join(' / ')} から選びます(渡された値: ${v})`);
  }
  const key = spec.key ?? song.key;
  return composeSection(
    { key, mood: resolveMood(song.mood, key.mode), kind: spec.kind, bars: spec.bars, timeSignature: song.timeSignature, roles: tracksByRole(song.tracks) },
    createRng(opts.seed ?? randomSeed()),
    { chords, melody, styles: spec.styles, only: opts.only },
  );
}

/**
 * コード進行とメロディを書いた部品から、曲を丸ごと作る
 * @param {{ title?: string, mood: import('./types.js').Mood, tempo: number, key: Key, sections: SectionSpec[], seed?: number, now?: string }} input
 * @returns {import('./types.js').Result<Song>}
 */
export function createAuthoredSong(input) {
  if (!isMood(input.mood)) return fail(`知らない雰囲気です: ${String(input.mood)}`, 'setsunai / shissou / dark / akarui / wafu-edm から選んでください', 'invalid_song');
  if (!(input.tempo >= TEMPO_MIN && input.tempo <= TEMPO_MAX)) return fail(`テンポは${TEMPO_MIN}〜${TEMPO_MAX}にしてください`, '速さを範囲の中で選んでください', 'invalid_song');
  if (!input.key || !isValidTonic(input.key.tonic) || (input.key.mode !== 'major' && input.key.mode !== 'minor')) {
    return fail('キーの書き方が正しくありません', '{ "tonic": "A", "mode": "minor" } の形で指定してください', 'invalid_song');
  }
  if (!Array.isArray(input.sections) || input.sections.length === 0) return fail('部品(sections)がありません', '少なくとも1つの部品を書いてください', 'invalid_song');
  const rng = createRng(input.seed ?? randomSeed());
  const song = createSkeleton({ mood: input.mood, tempo: input.tempo, key: input.key, title: input.title?.trim() || '無題の曲', now: input.now });
  song.tempo = input.tempo; // 書き手が決めた速さをそのまま使う
  try {
    for (const spec of input.sections) {
      const content = authorSection(song, spec, { seed: rng.int(1, 0x7ffffff) });
      appendSection(song, { name: String(spec.name ?? '部品'), kind: spec.kind, bars: spec.bars, key: spec.key }, content);
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), e instanceof NotationError ? 'かんたん記法の書き方を確かめてください' : '部品の内容を直してください', 'invalid_song');
  }
  return validateSong(song);
}
