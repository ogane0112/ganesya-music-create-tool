// 曲データで使う名前の一覧(楽器・雰囲気・役割など)と、画面に出す日本語の名前。

/** @type {{ id: import('./types.js').InstrumentId, label: string }[]} */
export const INSTRUMENTS = [
  { id: 'piano', label: 'ピアノ' },
  { id: 'acoustic-guitar', label: 'アコースティックギター' },
  { id: 'electric-guitar-clean', label: 'エレキギター(クリーン)' },
  { id: 'electric-guitar-distortion', label: 'エレキギター(歪み)' },
  { id: 'bass', label: 'ベース' },
  { id: 'drums', label: 'ドラム' },
  { id: 'strings', label: 'ストリングス' },
  { id: 'synth-lead', label: 'シンセリード' },
  { id: 'synth-pad', label: 'シンセパッド' },
  { id: 'bell', label: 'ベル' },
  { id: 'supersaw', label: 'シンセ(厚い音)' },
];

/** @type {{ id: import('./types.js').Mood, label: string }[]} */
export const MOODS = [
  { id: 'setsunai', label: '切ない' },
  { id: 'shissou', label: '疾走感' },
  { id: 'dark', label: 'ダーク・不穏' },
  { id: 'akarui', label: '明るい・爽やか' },
  { id: 'wafu-edm', label: '和風EDM' },
];

/** @type {import('./types.js').TrackRole[]} */
export const TRACK_ROLES = ['vocal', 'chords', 'bass', 'drums', 'pad', 'lead', 'other'];

/** @type {{ id: import('./types.js').SectionKind, label: string }[]} */
export const SECTION_KINDS = [
  { id: 'intro', label: 'イントロ' },
  { id: 'verse', label: 'Aメロ' },
  { id: 'prechorus', label: 'Bメロ' },
  { id: 'chorus', label: 'サビ' },
  { id: 'bridge', label: 'Cメロ' },
  { id: 'outro', label: 'アウトロ' },
  { id: 'other', label: 'その他' },
];

/** テンポの3段階(画面の「ゆっくり・ふつう・はやい」) */
export const TEMPO_PRESETS = {
  slow: 78,
  normal: 100,
  fast: 150,
};

export const TEMPO_MIN = 40;
export const TEMPO_MAX = 240;

/** @param {unknown} id @returns {id is import('./types.js').InstrumentId} */
export const isInstrument = (id) => INSTRUMENTS.some((i) => i.id === id);
/** @param {unknown} id @returns {id is import('./types.js').Mood} */
export const isMood = (id) => MOODS.some((m) => m.id === id);
/** @param {unknown} id @returns {id is import('./types.js').TrackRole} */
export const isTrackRole = (id) => TRACK_ROLES.includes(/** @type {any} */ (id));
/** @param {unknown} id @returns {id is import('./types.js').SectionKind} */
export const isSectionKind = (id) => SECTION_KINDS.some((k) => k.id === id);
