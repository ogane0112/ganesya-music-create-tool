// 叩き台と部品の中身を作るルール(B6)。
import { createEmptySong } from '../song.js';
import { createIdFactory } from '../ids.js';
import { createRng, randomSeed } from '../random.js';
import { ticksPerBar } from '../theory.js';
import { generateBass, generateChordPart, generatePad } from './accompaniment.js';
import { generateDrums } from './drums.js';
import { generateMelody } from './melody.js';
import { generateProgression } from './progressions.js';
import { MOOD_STYLES, resolveMood, styleKindOf } from './styles.js';

/** @typedef {import('../types.js').Song} Song */
/** @typedef {import('../types.js').Section} Section */
/** @typedef {import('../types.js').Chord} Chord */
/** @typedef {import('../types.js').Key} Key */
/** @typedef {import('../types.js').Mood} Mood */
/** @typedef {import('../types.js').Track} Track */
/** @typedef {import('../random.js').Rng} Rng */
/** @typedef {Omit<import('../types.js').Note, 'id'>} NoteData */

/** 叩き台の1コーラス:Aメロ・Bメロ・サビ */
const CHORUS_LAYOUT = /** @type {const} */ ([
  { name: 'Aメロ', kind: 'verse', bars: 8 },
  { name: 'Bメロ', kind: 'prechorus', bars: 8 },
  { name: 'サビ', kind: 'chorus', bars: 8 },
]);

/**
 * パートの役割ごとに、どのトラックが担当するか
 * @param {Track[]} tracks
 */
export function tracksByRole(tracks) {
  /** @param {import('../types.js').TrackRole} role */
  const find = (role) => tracks.find((t) => t.role === role)?.id;
  return {
    melody: find('vocal') ?? find('lead'),
    chords: find('chords'),
    bass: find('bass'),
    drums: find('drums'),
    pad: find('pad'),
  };
}

/**
 * @typedef {object} SectionContext
 * @property {Key} key
 * @property {Mood} mood
 * @property {import('../types.js').SectionKind} kind
 * @property {number} bars
 * @property {[number, number]} timeSignature
 * @property {ReturnType<typeof tracksByRole>} roles
 */

/**
 * @typedef {object} SectionContent
 * @property {Chord[]} chords
 * @property {Record<string, NoteData[]>} parts
 * @property {{ chordStyle: string, bassStyle: string, drumStyle: string }} styles どの弾き方を選んだか
 */

/**
 * 部品1つ分の中身を作る。keep に渡したもの(コード進行やメロディ)はそのまま使う
 * @param {SectionContext} ctx
 * @param {Rng} rng
 * @param {{ chords?: Chord[], melody?: NoteData[], styles?: Partial<SectionContent['styles']>, only?: ('melody' | 'chords' | 'bass' | 'drums' | 'pad')[] }} [opts]
 * @returns {SectionContent}
 */
export function composeSection(ctx, rng, opts = {}) {
  const style = MOOD_STYLES[ctx.mood];
  const kind = styleKindOf(ctx.kind);
  const common = { key: ctx.key, bars: ctx.bars, timeSignature: ctx.timeSignature };
  const chords = opts.chords && opts.chords.length
    ? opts.chords
    : generateProgression({ ...common, style, kind, rng: rng.fork() });
  const styles = {
    chordStyle: opts.styles?.chordStyle ?? rng.pick(style.chordStyles[kind]),
    bassStyle: opts.styles?.bassStyle ?? rng.pick(style.bassStyles[kind]),
    drumStyle: opts.styles?.drumStyle ?? rng.pick(style.drumStyles[kind]),
  };
  /** @param {'melody' | 'chords' | 'bass' | 'drums' | 'pad'} p */
  const want = (p) => !opts.only || opts.only.includes(p);
  /** @type {Record<string, NoteData[]>} */
  const parts = {};
  const { roles } = ctx;
  // それぞれ別の乱数の流れを使い、片方を作り直しても他が変わらないようにする
  const rMelody = rng.fork();
  const rChords = rng.fork();
  const rBass = rng.fork();
  const rDrums = rng.fork();
  const rPad = rng.fork();
  if (roles.melody && want('melody')) {
    parts[roles.melody] = opts.melody ?? generateMelody({ ...common, style, kind, chords, rng: rMelody });
  }
  if (roles.chords && want('chords')) parts[roles.chords] = generateChordPart({ ...common, chords, rng: rChords, style: styles.chordStyle });
  if (roles.bass && want('bass')) parts[roles.bass] = generateBass({ ...common, chords, rng: rBass, style: styles.bassStyle });
  if (roles.drums && want('drums')) parts[roles.drums] = generateDrums({ ...common, kind, rng: rDrums, style: styles.drumStyle });
  // 背景の持続音はAメロでは控えめに(半分の確率で鳴らさない)
  if (roles.pad && want('pad')) parts[roles.pad] = kind === 'verse' && rPad.chance(0.5) ? [] : generatePad({ ...common, chords, rng: rPad, style: '' });
  // 部品の終わりからはみ出す音を切る
  const end = ctx.bars * ticksPerBar(ctx.timeSignature);
  for (const [tid, notes] of Object.entries(parts)) {
    parts[tid] = notes
      .filter((n) => n.start < end)
      .map((n) => (n.start + n.length > end ? { ...n, length: end - n.start } : n));
  }
  return { chords, parts, styles };
}

/**
 * 雰囲気に合うキーを選ぶ
 * @param {Mood} mood
 * @param {Rng} rng
 * @returns {Key}
 */
export function pickKey(mood, rng) {
  const style = MOOD_STYLES[mood];
  return { tonic: /** @type {any} */ (rng.pick(style.tonics)), mode: rng.pick(style.modes) };
}

/**
 * 叩き台を作る(雰囲気とテンポから、Aメロ・Bメロ・サビの1コーラス)
 * 返す曲データは検査を通る形になっている(operations の createDraftSong で検査する)
 * @param {{ mood: Mood, tempo: number, title?: string, seed?: number, key?: Key, now?: string }} input
 * @returns {Song}
 */
export function generateDraft(input) {
  const seed = input.seed ?? randomSeed();
  const rng = createRng(seed);
  const mood = input.mood;
  const style = MOOD_STYLES[mood];
  const key = input.key ?? pickKey(mood, rng);
  const song = createEmptySong({ title: input.title, tempo: input.tempo, key, mood, now: input.now });
  song.tracks = [
    { id: 't1', role: 'vocal', instrument: style.instruments.melody, volume: 0.85, name: '歌メロ' },
    { id: 't2', role: 'chords', instrument: style.instruments.chords, volume: 0.6, name: '和音' },
    { id: 't3', role: 'bass', instrument: style.instruments.bass, volume: 0.75, name: 'ベース' },
    { id: 't4', role: 'drums', instrument: 'drums', volume: 0.7, name: 'ドラム' },
    { id: 't5', role: 'pad', instrument: style.instruments.pad, volume: 0.4, name: '背景' },
  ];
  const nextId = createIdFactory(song.tracks.map((t) => t.id));
  const roles = tracksByRole(song.tracks);
  for (const layout of CHORUS_LAYOUT) {
    const content = composeSection(
      { key, mood, kind: layout.kind, bars: layout.bars, timeSignature: song.timeSignature, roles },
      rng.fork(),
    );
    /** @type {Section} */
    const section = {
      id: nextId('s'),
      name: layout.name,
      kind: layout.kind,
      bars: layout.bars,
      chords: content.chords,
      parts: Object.fromEntries(
        Object.entries(content.parts).map(([tid, notes]) => [tid, notes.map((n) => ({ id: nextId('n'), ...n }))]),
      ),
    };
    song.sections.push(section);
    song.arrangement.push({ id: nextId('a'), sectionId: section.id, lyrics: [] });
  }
  song.extensions = { generator: { seed } };
  return song;
}

export { MOOD_STYLES, resolveMood, styleKindOf };
