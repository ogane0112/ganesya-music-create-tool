// 雰囲気ごとの作風の部品。コード進行の傾向・リズムの癖・楽器の組み合わせをここに集める。
// 既存曲のメロディそのものは持たず、J-POPでよく使われる型だけを持つ。
// 度数は「明るい側のキー(長調)」で数える。1=ド、6=ラ(暗い曲の主音)。

/** @typedef {import('../types.js').Mood} Mood */
/** @typedef {import('../types.js').SectionKind} SectionKind */
/** @typedef {import('../types.js').InstrumentId} InstrumentId */

/**
 * コード1つ分の指定
 * @typedef {object} ChordStep
 * @property {number} deg 度数 1〜7
 * @property {number} beats 長さ(拍)
 * @property {'7' | 'sus4' | 'add9' | ''} [color] 彩り。キーから外れる時は付けない
 * @property {number} [bassDeg] 分数コードの低音(度数)
 */

/** @param {string} spec 例 "4 5 3 6" や "4:2 5:2 1/3:4"(度数:拍、/は低音) @returns {ChordStep[]} */
function prog(spec, beatsDefault = 4) {
  return spec.split(/\s+/).map((tok) => {
    const m = /^(\d)([a-z0-9]*)(?:\/(\d))?(?::(\d+))?$/.exec(tok);
    if (!m) throw new Error(`進行の書き方が違います: ${tok}`);
    return {
      deg: Number(m[1]),
      color: /** @type {any} */ (m[2] || ''),
      bassDeg: m[3] ? Number(m[3]) : undefined,
      beats: m[4] ? Number(m[4]) : beatsDefault,
    };
  });
}

/**
 * 部品の種類ごとのコード進行の候補(4小節分。8小節の部品では2回使い、2回目の最後を整える)
 * @typedef {Record<'verse' | 'prechorus' | 'chorus', ChordStep[][]>} ProgressionSet
 */

/**
 * @typedef {object} MoodStyle
 * @property {import('../types.js').Mode[]} modes 選びやすいキーの明暗
 * @property {string[]} tonics 歌いやすい主音の候補
 * @property {ProgressionSet} progressions
 * @property {number} seventhChance 4和音(少し大人びた響き)にする確率
 * @property {Record<'melody' | 'chords' | 'bass' | 'pad', InstrumentId>} instruments
 * @property {Record<'verse' | 'prechorus' | 'chorus', string[]>} chordStyles 伴奏の弾き方
 * @property {Record<'verse' | 'prechorus' | 'chorus', string[]>} bassStyles
 * @property {Record<'verse' | 'prechorus' | 'chorus', string[]>} drumStyles
 * @property {Record<string, number>} rhythmWeights メロディのリズムの型の重み
 * @property {number} leapChance メロディが跳ぶ確率
 * @property {'scale' | 'pentatonic'} [melodyScale] メロディに使う音。pentatonic は5音だけ(和風・ロックの節回し)
 * @property {InstrumentId} [leadInstrument] 歌の裏で鳴るフレーズ(リフ)の楽器。あればパートが1つ増える
 * @property {Record<'intro' | 'verse' | 'prechorus' | 'chorus', string[]>} [leadStyles] リフの弾き方(riff・arp・none)
 * @property {boolean} [sidechain] 和音・背景・リフをバスドラムに合わせてうねらせる(EDM)
 * @property {{ name: string, kind: SectionKind, bars: number }[]} [layout] 叩き台の部品の並び(省略時は Aメロ・Bメロ・サビ)
 * @property {InstrumentId} colorInstrument 彩り(メロディの合間のフレーズ・サビの対旋律)の楽器
 * @property {[number, number]} [tempoRange] 雰囲気に合う速さ。選んだ速さがこれより遅ければ持ち上げる
 */

/** @type {Record<Mood, MoodStyle>} */
export const MOOD_STYLES = {
  // 切ない:王道進行(4-5-3-6)と小室進行(6-4-5-1)が中心。4和音多め、アルペジオ
  setsunai: {
    colorInstrument: 'bell',
    modes: ['minor', 'minor', 'major'],
    tonics: ['A', 'B', 'C#', 'D', 'E', 'F#', 'G', 'C', 'Eb'],
    progressions: {
      verse: [prog('6 4 5 1'), prog('6 5 4 5'), prog('1 5/7 6 3'), prog('6 3 4 1'), prog('4 5 3 6')],
      prechorus: [prog('4 5 3 6'), prog('2 3 4 5'), prog('4 3 2 5sus4'), prog('4 5 6 5/7')],
      chorus: [prog('4 5 3 6'), prog('4 5 6 1'), prog('6 4 5 3'), prog('4 5 3 6:2 1:2')],
    },
    seventhChance: 0.5,
    instruments: { melody: 'piano', chords: 'acoustic-guitar', bass: 'bass', pad: 'strings' },
    chordStyles: { verse: ['arpeggio', 'sustain'], prechorus: ['arpeggio', 'quarter'], chorus: ['strum', 'arpeggio'] },
    bassStyles: { verse: ['whole', 'half'], prechorus: ['half', 'eighth'], chorus: ['eighth', 'octave'] },
    drumStyles: { verse: ['light', 'half-time'], prechorus: ['eight-beat', 'half-time'], chorus: ['eight-beat'] },
    rhythmWeights: { eighths: 3, syncopate: 3, dotted: 2, restStart: 3, run16: 1, quarters: 1 },
    leapChance: 0.15,
  },
  // 疾走感:速い8分のベースと16分のハイハット、裏で鳴るシンバル。歪んだギター
  shissou: {
    colorInstrument: 'electric-guitar-clean',
    modes: ['minor', 'major'],
    tonics: ['A', 'B', 'C#', 'D', 'E', 'F#', 'G', 'C', 'Eb'],
    progressions: {
      verse: [prog('6 4 5 1'), prog('6 4 1 5'), prog('6 5 4 5'), prog('1 5 6 4')],
      prechorus: [prog('4 5 3 6'), prog('2 3 4 5'), prog('4 5 6 5')],
      chorus: [prog('4 5 3 6'), prog('6 4 5 1'), prog('4 5 6 6'), prog('4:2 5:2 3:2 6:2 4:2 5:2 6:4')],
    },
    seventhChance: 0.2,
    instruments: { melody: 'piano', chords: 'electric-guitar-distortion', bass: 'bass', pad: 'strings' },
    chordStyles: { verse: ['palm', 'syncopated'], prechorus: ['strum', 'palm'], chorus: ['strum', 'power'] },
    bassStyles: { verse: ['eighth', 'syncopated'], prechorus: ['eighth'], chorus: ['eighth', 'octave'] },
    drumStyles: { verse: ['sixteen', 'eight-beat'], prechorus: ['eight-beat', 'sixteen'], chorus: ['four-floor', 'eight-beat'] },
    rhythmWeights: { eighths: 3, syncopate: 3, dotted: 1, restStart: 2, run16: 3, quarters: 1 },
    leapChance: 0.2,
  },
  // ダーク・不穏:暗いキーで6-4-5-6や6-2-3-6。低めの音域、重い拍、長い音
  dark: {
    colorInstrument: 'bell',
    modes: ['minor'],
    tonics: ['A', 'B', 'C', 'C#', 'D', 'E', 'F#', 'G'],
    progressions: {
      verse: [prog('6 6 4 5'), prog('6 2 6 3'), prog('6 4 6 5'), prog('6 5 4 5')],
      prechorus: [prog('4 4 5 5'), prog('2 2 3 3'), prog('4 2 3 3')],
      chorus: [prog('6 4 5 6'), prog('6 4 5 3'), prog('6 4 2 3'), prog('4 5 6 6')],
    },
    seventhChance: 0.35,
    instruments: { melody: 'electric-piano', chords: 'electric-guitar-clean', bass: 'bass', pad: 'strings' },
    chordStyles: { verse: ['sustain', 'arpeggio'], prechorus: ['quarter', 'sustain'], chorus: ['power', 'strum'] },
    bassStyles: { verse: ['whole', 'syncopated'], prechorus: ['half', 'eighth'], chorus: ['eighth', 'syncopated'] },
    drumStyles: { verse: ['half-time', 'light'], prechorus: ['half-time', 'eight-beat'], chorus: ['eight-beat', 'half-time'] },
    rhythmWeights: { eighths: 2, syncopate: 2, dotted: 3, restStart: 3, run16: 1, quarters: 3 },
    leapChance: 0.12,
  },
  // 明るい・爽やか:1-5-6-4やカノン進行。弾むピアノとベース
  akarui: {
    colorInstrument: 'bell',
    modes: ['major'],
    tonics: ['C', 'D', 'Eb', 'E', 'F', 'G', 'Ab', 'A', 'Bb'],
    progressions: {
      verse: [prog('1 5 6 4'), prog('1 6 4 5'), prog('1 5/7 6 3'), prog('4 5 3 6')],
      prechorus: [prog('4 5 3 6'), prog('2 3 4 5'), prog('4 5 6 5sus4')],
      chorus: [prog('4 5 3 6'), prog('1 5 6 4'), prog('1:2 5:2 6:2 3:2 4:2 1:2 4:2 5:2'), prog('4 5 6 1')],
    },
    seventhChance: 0.3,
    instruments: { melody: 'electric-piano', chords: 'piano', bass: 'bass', pad: 'strings' },
    chordStyles: { verse: ['syncopated', 'quarter'], prechorus: ['quarter', 'arpeggio'], chorus: ['syncopated', 'strum'] },
    bassStyles: { verse: ['half', 'syncopated'], prechorus: ['eighth', 'half'], chorus: ['octave', 'syncopated'] },
    drumStyles: { verse: ['eight-beat', 'light'], prechorus: ['eight-beat'], chorus: ['eight-beat', 'ride'] },
    rhythmWeights: { eighths: 3, syncopate: 4, dotted: 2, restStart: 2, run16: 2, quarters: 1 },
    leapChance: 0.2,
  },
  // ロック:J-ROCKの王道。速めのテンポ、歪んだギターのパワーコードと8分で刻むベース、8ビートのドラム。
  // Aメロは抑えめ(パームミュート)、サビ前は4-5を重ねて溜め、サビは開いたハイハットで開放する
  rock: {
    colorInstrument: 'electric-guitar-clean',
    modes: ['minor', 'major'],
    tonics: ['E', 'A', 'B', 'F#', 'G', 'D', 'C#'],
    progressions: {
      verse: [prog('6 4 1 5 6 4 5 5'), prog('6 6 4 4 6 6 5 5'), prog('1 5/7 6 1/3 4 1/3 2 5'), prog('6 5 4 4 6 5 4 5')],
      prechorus: [prog('4 5 3 6 4 5 4 5'), prog('2 5 3 6 4 5 1 5'), prog('6 4 2 5 6 4 5 5')],
      chorus: [prog('4 5 3 6 4 5 1 1'), prog('4 5 1 6 4 5 6 6'), prog('6 4 1 5 6 4 5 5'), prog('4 5 6 3 4 5 1 5')],
    },
    seventhChance: 0.15,
    instruments: { melody: 'piano', chords: 'electric-guitar-distortion', bass: 'bass', pad: 'strings' },
    chordStyles: { verse: ['palm'], prechorus: ['power'], chorus: ['power', 'strum'] },
    bassStyles: { verse: ['eighth'], prechorus: ['eighth'], chorus: ['eighth', 'octave'] },
    drumStyles: { verse: ['rock-verse'], prechorus: ['rock-verse'], chorus: ['rock-open'] },
    rhythmWeights: { eighths: 3, syncopate: 3, dotted: 1, restStart: 3, run16: 3, quarters: 1 },
    leapChance: 0.22,
    leadInstrument: 'electric-guitar-distortion',
    leadStyles: { intro: ['riff'], verse: ['none'], prechorus: ['none'], chorus: ['none'] },
    layout: [
      { name: 'イントロ', kind: 'intro', bars: 4 },
      { name: 'Aメロ', kind: 'verse', bars: 8 },
      { name: 'Bメロ', kind: 'prechorus', bars: 8 },
      { name: 'サビ', kind: 'chorus', bars: 8 },
    ],
    tempoRange: [140, 184],
  },
  // 和風EDM:速いテンポ、5音の節回しと16分のリフ、王道進行。四つ打ちとうねる厚いシンセ、サビ前の盛り上げ
  'wafu-edm': {
    colorInstrument: 'bell',
    modes: ['minor'],
    tonics: ['C#', 'D', 'D#', 'E', 'F#', 'G', 'A', 'B'],
    progressions: {
      verse: [prog('6 6 4 5'), prog('6 4 5 6'), prog('6 5 4 5'), prog('6 3 4 5')],
      prechorus: [prog('4 5 3 6'), prog('2 3 4 5'), prog('4 4 5 5')],
      chorus: [prog('4 5 3 6'), prog('4 5 3 6:2 1:2'), prog('6 4 5 3'), prog('4 5 6 6')],
    },
    seventhChance: 0.1,
    instruments: { melody: 'synth-lead', chords: 'supersaw', bass: 'bass', pad: 'strings' },
    chordStyles: { verse: ['pluck16', 'offbeat-stab'], prechorus: ['pluck16', 'quarter'], chorus: ['pump'] },
    bassStyles: { verse: ['eighth', 'syncopated'], prechorus: ['eighth'], chorus: ['offbeat', 'rolling'] },
    drumStyles: { verse: ['sixteen', 'eight-beat'], prechorus: ['four-floor'], chorus: ['edm'] },
    rhythmWeights: { eighths: 2, syncopate: 3, dotted: 1, restStart: 2, run16: 4, quarters: 0 },
    leapChance: 0.25,
    melodyScale: 'pentatonic',
    leadInstrument: 'koto',
    leadStyles: { intro: ['riff'], verse: ['none'], prechorus: ['arp'], chorus: ['riff', 'arp'] },
    sidechain: true,
    layout: [
      { name: 'イントロ', kind: 'intro', bars: 4 },
      { name: 'Aメロ', kind: 'verse', bars: 8 },
      { name: 'Bメロ', kind: 'prechorus', bars: 8 },
      { name: 'サビ', kind: 'chorus', bars: 8 },
    ],
    tempoRange: [140, 175],
  },
};

/**
 * イントロ・Cメロなどは近い種類の作り方を借りる
 * @param {SectionKind} kind
 * @returns {'verse' | 'prechorus' | 'chorus'}
 */
export function styleKindOf(kind) {
  if (kind === 'chorus' || kind === 'intro') return 'chorus';
  if (kind === 'prechorus' || kind === 'bridge') return 'prechorus';
  return 'verse';
}

/**
 * 雰囲気がない曲(MIDI取り込みなど)は、キーの明暗から近い雰囲気を選ぶ
 * @param {Mood | null} mood
 * @param {import('../types.js').Mode} mode
 * @returns {Mood}
 */
export function resolveMood(mood, mode) {
  return mood ?? (mode === 'minor' ? 'setsunai' : 'akarui');
}
