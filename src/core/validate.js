// 曲データの検査:形の正しさ、キーから外れた音の検出。知らない項目は消さずに残す。
import { FORMAT_VERSION } from './types.js';
import { isInstrument, isMood, isSectionKind, isTrackRole, TEMPO_MAX, TEMPO_MIN } from './catalog.js';
import { chordPitchClasses, isInKey, isValidTonic, mod12, parseChord, pitchNameDoremi, ticksPerBar } from './theory.js';

/** @typedef {import('./types.js').Song} Song */
/** @typedef {import('./types.js').AppError} AppError */

/**
 * @typedef {object} Problem
 * @property {string} path 曲データの中の場所(例: "sections[0].parts.t1[3].pitch")
 * @property {string} message
 */

/**
 * @typedef {object} OutOfKeyNote
 * @property {string} sectionId
 * @property {string} trackId
 * @property {string} noteId
 * @property {number} pitch
 * @property {string} name 表示用の名前(ドレミ)
 * @property {number} start 部品の先頭からの位置(ティック)
 * @property {string | null} chord その時のコード
 */

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** @param {unknown} v */
const isInt = (v) => Number.isInteger(v);
/** @param {unknown} v */
const isStr = (v) => typeof v === 'string';

/**
 * 曲データの形が正しいかを調べ、問題の一覧を返す(空なら正しい)
 * キーから外れた音はここでは問題にしない(findOutOfKeyNotes を使う)
 * @param {unknown} song
 * @returns {Problem[]}
 */
export function checkShape(song) {
  /** @type {Problem[]} */
  const problems = [];
  /** @param {string} path @param {string} message */
  const bad = (path, message) => problems.push({ path, message });

  if (!isObj(song)) {
    bad('', '曲データがオブジェクトではありません');
    return problems;
  }
  if (song.formatVersion !== FORMAT_VERSION) bad('formatVersion', `形式の版は ${FORMAT_VERSION} である必要があります`);
  if (!isInt(song.revision) || song.revision < 0) bad('revision', 'revision は0以上の整数である必要があります');

  if (!isObj(song.meta)) bad('meta', 'meta がありません');
  else {
    for (const k of ['title', 'artist', 'createdAt', 'updatedAt']) {
      if (!isStr(song.meta[k])) bad(`meta.${k}`, `meta.${k} は文字列である必要があります`);
    }
  }

  if (typeof song.tempo !== 'number' || !(song.tempo >= TEMPO_MIN && song.tempo <= TEMPO_MAX)) {
    bad('tempo', `テンポは ${TEMPO_MIN}〜${TEMPO_MAX} の数である必要があります`);
  }

  checkKey(song.key, 'key', bad);

  const ts = song.timeSignature;
  const tsOk = Array.isArray(ts) && ts.length === 2 && isInt(ts[0]) && isInt(ts[1]) && ts[0] > 0 && [1, 2, 4, 8, 16].includes(ts[1]);
  if (!tsOk) bad('timeSignature', '拍子は [拍の数, 拍の単位] の形である必要があります');

  if (song.mood !== null && !isMood(song.mood)) bad('mood', `知らない雰囲気です: ${String(song.mood)}`);

  /** @type {Set<string>} */
  const trackIds = new Set();
  if (!Array.isArray(song.tracks)) bad('tracks', 'tracks は配列である必要があります');
  else {
    song.tracks.forEach((t, i) => {
      const p = `tracks[${i}]`;
      if (!isObj(t)) return bad(p, 'パートがオブジェクトではありません');
      if (!isStr(t.id) || !t.id) bad(`${p}.id`, 'パートのIDがありません');
      else if (trackIds.has(t.id)) bad(`${p}.id`, `パートのIDが重複しています: ${t.id}`);
      else trackIds.add(t.id);
      if (!isTrackRole(t.role)) bad(`${p}.role`, `知らない役割です: ${String(t.role)}`);
      if (!isInstrument(t.instrument)) bad(`${p}.instrument`, `知らない楽器です: ${String(t.instrument)}`);
      if (typeof t.volume !== 'number' || t.volume < 0 || t.volume > 1) bad(`${p}.volume`, '音量は0〜1である必要があります');
      if (t.muted !== undefined && typeof t.muted !== 'boolean') bad(`${p}.muted`, '消音は true か false である必要があります');
      if (t.sidechain !== undefined && typeof t.sidechain !== 'boolean') bad(`${p}.sidechain`, 'sidechain は true か false である必要があります');
      if (t.name !== undefined && !isStr(t.name)) bad(`${p}.name`, 'パートの名前は文字列である必要があります');
    });
  }

  const barTicks = tsOk ? ticksPerBar(/** @type {[number, number]} */ (ts)) : 1920;
  /** @type {Set<string>} */
  const sectionIds = new Set();
  /** @type {Map<string, Set<string>>} 部品ごとの音符ID */
  const noteIdsBySection = new Map();
  if (!Array.isArray(song.sections)) bad('sections', 'sections は配列である必要があります');
  else {
    song.sections.forEach((s, i) => {
      const p = `sections[${i}]`;
      if (!isObj(s)) return bad(p, '部品がオブジェクトではありません');
      if (!isStr(s.id) || !s.id) bad(`${p}.id`, '部品のIDがありません');
      else if (sectionIds.has(s.id)) bad(`${p}.id`, `部品のIDが重複しています: ${s.id}`);
      else sectionIds.add(s.id);
      if (!isStr(s.name)) bad(`${p}.name`, '部品の名前は文字列である必要があります');
      if (!isSectionKind(s.kind)) bad(`${p}.kind`, `知らない部品の種類です: ${String(s.kind)}`);
      if (!isInt(s.bars) || s.bars < 1 || s.bars > 64) bad(`${p}.bars`, '小節数は1〜64の整数である必要があります');
      if (s.key !== undefined) checkKey(s.key, `${p}.key`, bad);
      const length = (isInt(s.bars) ? s.bars : 0) * barTicks;

      if (!Array.isArray(s.chords)) bad(`${p}.chords`, 'chords は配列である必要があります');
      else {
        s.chords.forEach((c, j) => {
          const cp = `${p}.chords[${j}]`;
          if (!isObj(c)) return bad(cp, 'コードがオブジェクトではありません');
          checkSpan(c, cp, length, bad);
          if (!isStr(c.symbol) || !parseChord(c.symbol)) bad(`${cp}.symbol`, `読めないコード名です: ${String(c.symbol)}`);
        });
      }

      /** @type {Set<string>} */
      const noteIds = new Set();
      if (isStr(s.id)) noteIdsBySection.set(s.id, noteIds);
      if (!isObj(s.parts)) bad(`${p}.parts`, 'parts はオブジェクトである必要があります');
      else {
        for (const [trackId, notes] of Object.entries(s.parts)) {
          const pp = `${p}.parts.${trackId}`;
          if (!trackIds.has(trackId)) bad(pp, `知らないパートです: ${trackId}`);
          if (!Array.isArray(notes)) {
            bad(pp, '音符は配列である必要があります');
            continue;
          }
          notes.forEach((n, k) => {
            const np = `${pp}[${k}]`;
            if (!isObj(n)) return bad(np, '音符がオブジェクトではありません');
            if (!isStr(n.id) || !n.id) bad(`${np}.id`, '音符のIDがありません');
            else if (noteIds.has(n.id)) bad(`${np}.id`, `音符のIDが重複しています: ${n.id}`);
            else noteIds.add(n.id);
            checkSpan(n, np, length, bad);
            if (!isInt(n.pitch) || n.pitch < 0 || n.pitch > 127) bad(`${np}.pitch`, '音の高さは0〜127の整数である必要があります');
            if (!isInt(n.velocity) || n.velocity < 1 || n.velocity > 127) bad(`${np}.velocity`, '音の強さは1〜127の整数である必要があります');
          });
        }
      }
    });
  }

  /** @type {Set<string>} */
  const itemIds = new Set();
  if (!Array.isArray(song.arrangement)) bad('arrangement', 'arrangement は配列である必要があります');
  else {
    song.arrangement.forEach((a, i) => {
      const p = `arrangement[${i}]`;
      if (!isObj(a)) return bad(p, '並び順の項目がオブジェクトではありません');
      if (!isStr(a.id) || !a.id) bad(`${p}.id`, '並び順の項目のIDがありません');
      else if (itemIds.has(a.id)) bad(`${p}.id`, `並び順の項目のIDが重複しています: ${a.id}`);
      else itemIds.add(a.id);
      if (!isStr(a.sectionId) || !sectionIds.has(a.sectionId)) bad(`${p}.sectionId`, `存在しない部品を指しています: ${String(a.sectionId)}`);
      if (!Array.isArray(a.lyrics)) bad(`${p}.lyrics`, 'lyrics は配列である必要があります');
      else {
        const noteIds = noteIdsBySection.get(a.sectionId);
        a.lyrics.forEach((l, j) => {
          const lp = `${p}.lyrics[${j}]`;
          if (!isObj(l) || !isStr(l.noteId) || !isStr(l.kana)) return bad(lp, '歌詞は { noteId, kana } の形である必要があります');
          if (noteIds && !noteIds.has(l.noteId)) bad(`${lp}.noteId`, `存在しない音符を指しています: ${l.noteId}`);
        });
      }
    });
  }

  if (!isObj(song.extensions)) bad('extensions', 'extensions はオブジェクトである必要があります');

  return problems;
}

/**
 * @param {unknown} key
 * @param {string} path
 * @param {(path: string, message: string) => void} bad
 */
function checkKey(key, path, bad) {
  if (!isObj(key) || !isStr(key.tonic) || !isValidTonic(key.tonic) || (key.mode !== 'major' && key.mode !== 'minor')) {
    bad(path, 'キーは { tonic: "A", mode: "minor" } の形である必要があります');
    return false;
  }
  return true;
}

/**
 * 開始位置と長さが部品の中に収まっているか
 * @param {Record<string, any>} x
 * @param {string} path
 * @param {number} sectionLength
 * @param {(path: string, message: string) => void} bad
 */
function checkSpan(x, path, sectionLength, bad) {
  if (!isInt(x.start) || x.start < 0) bad(`${path}.start`, '開始位置は0以上の整数である必要があります');
  if (!isInt(x.length) || x.length < 1) bad(`${path}.length`, '長さは1以上の整数である必要があります');
  if (isInt(x.start) && isInt(x.length) && sectionLength > 0 && x.start + x.length > sectionLength) {
    bad(path, '部品の長さからはみ出しています');
  }
}

/**
 * キーから外れた音符を探す。ドラムのパートは音の高さを持たないので除く
 * 形が正しい曲データを前提とする
 * @param {Song} song
 * @param {{ sectionIds?: string[] }} [opts] 調べる部品を絞る
 * @returns {OutOfKeyNote[]}
 */
export function findOutOfKeyNotes(song, opts = {}) {
  const drumTracks = new Set(song.tracks.filter((t) => t.role === 'drums').map((t) => t.id));
  /** @type {OutOfKeyNote[]} */
  const out = [];
  for (const s of song.sections) {
    if (opts.sectionIds && !opts.sectionIds.includes(s.id)) continue;
    const key = s.key ?? song.key;
    for (const [trackId, notes] of Object.entries(s.parts)) {
      if (drumTracks.has(trackId)) continue;
      for (const n of notes) {
        if (isInKey(n.pitch, key)) continue;
        // キーの外でも、その時鳴っているコードの音なら合っている(借りてきたコードなど)
        const chord = s.chords.find((c) => n.start >= c.start && n.start < c.start + c.length);
        const parsed = chord ? parseChord(chord.symbol) : null;
        if (parsed && chordPitchClasses(/** @type {any} */ (chord).symbol).includes(mod12(n.pitch))) continue;
        out.push({ sectionId: s.id, trackId, noteId: n.id, pitch: n.pitch, name: pitchNameDoremi(n.pitch), start: n.start, chord: chord?.symbol ?? null });
      }
    }
  }
  return out;
}

/**
 * 曲データを検査する。
 * - 形が正しくなければ invalid_song
 * - キーから外れた音があれば、allowOutOfKey なら注意書き、そうでなければ invalid_song
 * 曲データは書き換えない(知らない項目もそのまま残る)
 * @param {unknown} song
 * @param {{ allowOutOfKey?: boolean, sectionIds?: string[] }} [opts]
 * @returns {import('./types.js').Result<Song>}
 */
export function validateSong(song, opts = {}) {
  const problems = checkShape(song);
  if (problems.length > 0) {
    return {
      ok: false,
      error: {
        code: 'invalid_song',
        message: `曲データの形が正しくありません(${problems.length}件)。${problems[0].message}`,
        hint: '曲データの書き方を確かめてください',
        details: { problems },
      },
    };
  }
  const s = /** @type {Song} */ (song);
  const outOfKey = findOutOfKeyNotes(s, { sectionIds: opts.sectionIds });
  if (outOfKey.length > 0) {
    const names = summarizeNotes(outOfKey);
    if (!opts.allowOutOfKey) {
      return {
        ok: false,
        error: {
          code: 'invalid_song',
          message: `曲のキーにも、その時のコードにも合わない音があります(${outOfKey.length}個: ${names})`,
          hint: 'キーに合う音か、その時鳴っているコードの音に置き換えてください',
          details: { outOfKey },
        },
      };
    }
    return { ok: true, value: s, warnings: [`曲のキーに合わない音が${outOfKey.length}個あります(${names})`] };
  }
  return { ok: true, value: s, warnings: [] };
}

/** @param {OutOfKeyNote[]} notes */
function summarizeNotes(notes) {
  const names = [...new Set(notes.map((n) => n.name))];
  return names.slice(0, 5).join('、') + (names.length > 5 ? ' など' : '');
}
