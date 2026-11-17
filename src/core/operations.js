// 操作:曲への変更はすべてここを通す。画面もMCPも同じ関数を呼ぶ。
// どの操作も元の曲データを変えず、検査を通した新しい曲データを返す。
import { isInstrument, isMood, isSectionKind, TEMPO_MAX, TEMPO_MIN } from './catalog.js';
import { collectIds, createIdFactory } from './ids.js';
import { isValidTonic, keyPrefersFlat, mod12, pcName, pitchClassOf, ticksPerBar, transposeChord } from './theory.js';
import { STYLE_NAMES } from './style-names.js';
import { validateSong } from './validate.js';
import { assignLyrics } from './lyrics.js';
import { createEmptySong } from './song.js';
import { generateDraft } from './composer/index.js';

export { createEmptySong };

/** @typedef {import('./types.js').Song} Song */
/** @typedef {import('./types.js').Section} Section */
/** @typedef {import('./types.js').Note} Note */
/** @typedef {import('./types.js').Chord} Chord */
/** @typedef {import('./types.js').Key} Key */
/** @typedef {import('./types.js').AppError} AppError */
/** @typedef {import('./types.js').Result<Song>} SongResult */

/**
 * @param {string} message
 * @param {string} hint
 * @param {string} [code]
 * @param {unknown} [details]
 * @returns {{ ok: false, error: AppError }}
 */
export function fail(message, hint, code = 'invalid_operation', details) {
  return { ok: false, error: { code, message, hint, ...(details === undefined ? {} : { details }) } };
}

/** @template T @param {T} v @returns {T} */
const clone = (v) => structuredClone(v);

/**
 * 変更後の曲を検査して返す。対象の部品だけキーを厳しく調べ、他は注意書きにとどめる
 * (MIDI取り込みの曲で、関係ない部品の外れた音のせいで操作できなくなるのを防ぐ)
 * @param {Song} next
 * @param {{ strictSectionIds?: string[] }} [opts]
 * @returns {SongResult}
 */
function finish(next, opts = {}) {
  const shape = validateSong(next, { allowOutOfKey: true });
  if (!shape.ok) return shape;
  if (opts.strictSectionIds && opts.strictSectionIds.length > 0) {
    const strict = validateSong(next, { sectionIds: opts.strictSectionIds });
    if (!strict.ok) return strict;
  }
  return { ok: true, value: next, warnings: [] };
}

// ---- 曲を作る ----

/**
 * 取り込んだ曲データやAIが作った曲データを登録する。
 * revision は0から始め直す。キーから外れた音は、allowOutOfKey(MIDI取り込み)なら注意書き、そうでなければ拒否
 * @param {unknown} data
 * @param {{ allowOutOfKey?: boolean, now?: string }} [opts]
 * @returns {SongResult}
 */
export function registerSong(data, opts = {}) {
  /** @type {any} */
  const song = clone(data);
  if (song && typeof song === 'object') {
    song.revision = 0;
    const now = opts.now ?? new Date().toISOString();
    if (song.meta && typeof song.meta === 'object') {
      if (typeof song.meta.createdAt !== 'string') song.meta.createdAt = now;
      if (typeof song.meta.updatedAt !== 'string') song.meta.updatedAt = now;
      if (typeof song.meta.artist !== 'string') song.meta.artist = '';
    }
    if (song.extensions === undefined) song.extensions = {};
    if (Array.isArray(song.arrangement)) {
      for (const a of song.arrangement) if (a && typeof a === 'object' && a.lyrics === undefined) a.lyrics = [];
    }
  }
  return validateSong(song, { allowOutOfKey: opts.allowOutOfKey });
}

/**
 * 雰囲気とテンポから叩き台を作る
 * @param {{ mood: import('./types.js').Mood, tempo: number, title?: string, seed?: number, now?: string }} input
 * @returns {SongResult}
 */
export function createDraftSong(input) {
  if (!isMood(input.mood)) return fail(`知らない雰囲気です: ${String(input.mood)}`, '切ない・疾走感・ダーク・明るい から選んでください');
  if (!(input.tempo >= TEMPO_MIN && input.tempo <= TEMPO_MAX)) {
    return fail(`テンポは${TEMPO_MIN}〜${TEMPO_MAX}にしてください`, '速さを範囲の中で選んでください');
  }
  const title = input.title?.trim() || '無題の曲';
  return validateSong(generateDraft({ ...input, title }));
}

// ---- 部品を差し替える ----

/**
 * 部品1つのコード進行やパートを置き換える。渡さなかった項目はそのまま。
 * 音符のIDは付け直し、歌詞の割り当ては置き換わった音符の分だけ外す
 * @param {Song} song
 * @param {string} sectionId
 * @param {{ chords?: Chord[], parts?: Record<string, Omit<Note, 'id'>[] | Note[]>, bars?: number }} replacement
 * @returns {SongResult}
 */
export function replaceSection(song, sectionId, replacement) {
  const next = clone(song);
  const section = next.sections.find((s) => s.id === sectionId);
  if (!section) return fail(`部品が見つかりません: ${sectionId}`, '曲を読み込み直してください', 'not_found');

  if (replacement.bars !== undefined) section.bars = replacement.bars;
  if (replacement.chords !== undefined) section.chords = clone(replacement.chords);
  if (replacement.parts !== undefined) {
    const ids = collectIds(next);
    for (const [trackId, notes] of Object.entries(section.parts)) {
      if (trackId in replacement.parts) for (const n of notes) ids.delete(n.id);
    }
    const nextId = createIdFactory(ids);
    for (const [trackId, notes] of Object.entries(replacement.parts)) {
      if (!next.tracks.some((t) => t.id === trackId)) {
        return fail(`知らないパートです: ${trackId}`, '曲のパートの一覧から選んでください', 'invalid_song');
      }
      section.parts[trackId] = notes.map((n) => ({
        ...clone(n),
        id: nextId('n'),
      }));
    }
    // 消えた音符を指す歌詞を外す
    const alive = new Set(Object.values(section.parts).flat().map((n) => n.id));
    for (const a of next.arrangement) {
      if (a.sectionId === sectionId) a.lyrics = a.lyrics.filter((l) => alive.has(l.noteId));
    }
  }
  return finish(next, { strictSectionIds: [sectionId] });
}

// ---- 並び順を変える ----

/**
 * 並び順に部品を追加する。既存の部品をもう一度使う(例:サビをもう1回)
 * @param {Song} song
 * @param {string} sectionId
 * @param {number} [index] 入れる位置(省略で末尾)
 * @returns {SongResult}
 */
export function addArrangementItem(song, sectionId, index) {
  if (!song.sections.some((s) => s.id === sectionId)) {
    return fail(`部品が見つかりません: ${sectionId}`, '曲を読み込み直してください', 'not_found');
  }
  const next = clone(song);
  const nextId = createIdFactory(collectIds(next));
  const item = { id: nextId('a'), sectionId, lyrics: [] };
  const at = clampIndex(index ?? next.arrangement.length, next.arrangement.length);
  next.arrangement.splice(at, 0, item);
  return finish(next);
}

/**
 * 新しい部品の定義を足し、並び順にも入れる
 * @param {Song} song
 * @param {Omit<Section, 'id'> & { id?: string }} section 音符のIDは付け直す
 * @param {number} [index]
 * @returns {SongResult}
 */
export function addSection(song, section, index) {
  const next = clone(song);
  const nextId = createIdFactory(collectIds(next));
  /** @type {Section} */
  const s = {
    ...clone(section),
    id: nextId('s'),
    parts: Object.fromEntries(
      Object.entries(section.parts).map(([tid, notes]) => [tid, notes.map((n) => ({ ...clone(n), id: nextId('n') }))]),
    ),
  };
  next.sections.push(s);
  const at = clampIndex(index ?? next.arrangement.length, next.arrangement.length);
  next.arrangement.splice(at, 0, { id: nextId('a'), sectionId: s.id, lyrics: [] });
  return finish(next, { strictSectionIds: [s.id] });
}

/**
 * 並び順から1か所を外す。どこからも使われなくなった部品の定義も消す
 * @param {Song} song
 * @param {string} itemId
 * @returns {SongResult}
 */
export function removeArrangementItem(song, itemId) {
  const next = clone(song);
  const i = next.arrangement.findIndex((a) => a.id === itemId);
  if (i < 0) return fail(`並び順の項目が見つかりません: ${itemId}`, '曲を読み込み直してください', 'not_found');
  if (next.arrangement.length === 1) return fail('最後の1つの部品は消せません', '先に別の部品を足してください');
  const [removed] = next.arrangement.splice(i, 1);
  if (!next.arrangement.some((a) => a.sectionId === removed.sectionId)) {
    next.sections = next.sections.filter((s) => s.id !== removed.sectionId);
  }
  return finish(next);
}

/**
 * 並び順の1か所を別の位置に動かす
 * @param {Song} song
 * @param {string} itemId
 * @param {number} toIndex 動かした後の位置
 * @returns {SongResult}
 */
export function moveArrangementItem(song, itemId, toIndex) {
  const next = clone(song);
  const i = next.arrangement.findIndex((a) => a.id === itemId);
  if (i < 0) return fail(`並び順の項目が見つかりません: ${itemId}`, '曲を読み込み直してください', 'not_found');
  const [item] = next.arrangement.splice(i, 1);
  next.arrangement.splice(clampIndex(toIndex, next.arrangement.length), 0, item);
  return finish(next);
}

/**
 * @param {number} i
 * @param {number} max
 */
function clampIndex(i, max) {
  return Math.max(0, Math.min(max, Math.trunc(i)));
}

// ---- 部品の区切りを直す ----

/**
 * 部品の名前と種類を変える
 * @param {Song} song
 * @param {string} sectionId
 * @param {{ name?: string, kind?: import('./types.js').SectionKind }} changes
 * @returns {SongResult}
 */
export function renameSection(song, sectionId, changes) {
  const next = clone(song);
  const s = next.sections.find((x) => x.id === sectionId);
  if (!s) return fail(`部品が見つかりません: ${sectionId}`, '曲を読み込み直してください', 'not_found');
  if (changes.name !== undefined) {
    const name = changes.name.trim();
    if (!name) return fail('部品の名前が空です', '名前を入れてください');
    s.name = name;
  }
  if (changes.kind !== undefined) {
    if (!isSectionKind(changes.kind)) return fail(`知らない部品の種類です: ${changes.kind}`, '一覧から選んでください');
    s.kind = changes.kind;
  }
  return finish(next);
}

/**
 * 曲を頭から並び順どおりにつないで、区切り位置(小節)で切り直す。MIDI取り込み後に使う。
 * 切り直した後は、どの部品も1回ずつ並ぶ。歌詞の割り当ては外れる
 * @param {Song} song
 * @param {{ startBar: number, name: string, kind?: import('./types.js').SectionKind }[]} segments 各部品の開始小節(0から)と名前。先頭は0
 * @returns {SongResult}
 */
export function resplitSections(song, segments) {
  if (segments.length === 0) return fail('区切りがありません', '少なくとも1つの部品を作ってください');
  const barTicks = ticksPerBar(song.timeSignature);
  const totalBars = song.arrangement.reduce((sum, a) => sum + (song.sections.find((s) => s.id === a.sectionId)?.bars ?? 0), 0);
  const sorted = [...segments].sort((a, b) => a.startBar - b.startBar);
  if (sorted[0].startBar !== 0) return fail('最初の区切りは曲の頭(0小節目)である必要があります', '区切りを曲の頭に合わせてください');
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    if (!Number.isInteger(s.startBar) || s.startBar < 0 || s.startBar >= totalBars) {
      return fail(`区切りの位置が曲の外です: ${s.startBar + 1}小節目`, `1〜${totalBars}小節目の中で区切ってください`);
    }
    if (i > 0 && sorted[i - 1].startBar === s.startBar) return fail('同じ位置に区切りが2つあります', '区切りの位置をずらしてください');
  }

  // 曲全体を1本の時間軸に並べる
  /** @type {Record<string, Note[]>} */
  const timeline = {};
  /** @type {Chord[]} */
  const chords = [];
  let offset = 0;
  for (const a of song.arrangement) {
    const sec = song.sections.find((s) => s.id === a.sectionId);
    if (!sec) continue;
    for (const [tid, notes] of Object.entries(sec.parts)) {
      (timeline[tid] ??= []).push(...notes.map((n) => ({ ...n, start: n.start + offset })));
    }
    chords.push(...sec.chords.map((c) => ({ ...c, start: c.start + offset })));
    offset += sec.bars * barTicks;
  }

  const next = clone(song);
  const nextId = createIdFactory(next.tracks.map((t) => t.id));
  next.sections = [];
  next.arrangement = [];
  for (let i = 0; i < sorted.length; i++) {
    const startBar = sorted[i].startBar;
    const endBar = i + 1 < sorted.length ? sorted[i + 1].startBar : totalBars;
    const from = startBar * barTicks;
    const to = endBar * barTicks;
    /** @type {Section} */
    const section = {
      id: nextId('s'),
      name: sorted[i].name.trim() || `部品${i + 1}`,
      kind: sorted[i].kind ?? 'other',
      bars: endBar - startBar,
      chords: cut(chords, from, to),
      parts: Object.fromEntries(
        Object.entries(timeline).map(([tid, notes]) => [tid, cut(notes, from, to).map((n) => ({ ...n, id: nextId('n') }))]),
      ),
    };
    next.sections.push(section);
    next.arrangement.push({ id: nextId('a'), sectionId: section.id, lyrics: [] });
  }
  return finish(next);
}

/**
 * 時間の範囲 [from, to) に頭がかかるものを取り出し、範囲の先頭からの位置に直す。はみ出す分は切る
 * @template {{ start: number, length: number }} T
 * @param {T[]} items
 * @param {number} from
 * @param {number} to
 * @returns {T[]}
 */
function cut(items, from, to) {
  return items
    .filter((x) => x.start >= from && x.start < to)
    .map((x) => ({ ...x, start: x.start - from, length: Math.min(x.length, to - x.start) }));
}

// ---- 歌詞を入れる ----

/**
 * 並び順の1か所に歌詞を割り当てる。かな(ひらがな・カタカナ)で書き、行はフレーズ(息継ぎまで)ごとに改行か / で区切る。
 * 音数が合わなくても入る分だけ入れ、ズレは注意書きで知らせる。strict なら、ズレや読めない字があれば断る(AI向け)
 * @param {Song} song
 * @param {string} itemId
 * @param {string} text 空なら歌詞を消す
 * @param {{ strict?: boolean }} [opts]
 * @returns {SongResult}
 */
export function setLyrics(song, itemId, text, opts = {}) {
  const next = clone(song);
  const item = next.arrangement.find((a) => a.id === itemId);
  if (!item) return fail(`並び順の項目が見つかりません: ${itemId}`, '曲を読み込み直してください', 'not_found');
  const r = assignLyrics(next, item.sectionId, text);
  /** @type {string[]} */
  const warnings = [];
  if (r.invalid.length) warnings.push(`かなで書いてください(読めない字: ${r.invalid.slice(0, 8).join(' ')})`);
  r.lines.forEach((l, i) => {
    if (l.morae > l.notes) warnings.push(`${i + 1}行目「${l.kana}」: ${l.morae - l.notes}音多い(メロディは${l.notes}音)`);
    else if (l.morae < l.notes) warnings.push(`${i + 1}行目「${l.kana}」: ${l.notes - l.morae}音足りない(メロディは${l.notes}音)`);
  });
  if (opts.strict && warnings.length && text.trim()) {
    return fail(`歌詞の音数がメロディと合いません\n${warnings.join('\n')}`, `行ごとの音数を ${r.lines.map((l) => l.notes).join('・')} に合わせてください(小さい「ゃゅょ」は前の字と合わせて1音、「ん」「っ」は1音)`, 'lyrics_mismatch', { lines: r.lines });
  }
  item.lyrics = r.lyrics;
  const done = finish(next);
  return done.ok ? { ...done, warnings } : done;
}

// ---- 並びの1か所だけの設定 ----

/**
 * 並びの1か所だけの、消音・音量・弾き方・楽器・つなぎの演出を変える。
 * 渡した項目だけを変える。null(または false・0)で、その項目を元に戻す
 * @typedef {object} ItemPatch
 * @property {Record<string, { muted?: boolean | null, volume?: number | null } | null> | null} [mix] トラックIDごと。null でそのパートを元に戻す、全体が null なら全部戻す
 * @property {Partial<Record<'chordStyle' | 'bassStyle' | 'drumStyle' | 'leadStyle', string | null>> | null} [styles]
 * @property {Record<string, import('./types.js').InstrumentId | null> | null} [instruments]
 * @property {{ crash?: boolean, fill?: boolean, riser?: boolean, break?: number } | null} [fx]
 *
 * @param {Song} song
 * @param {string} itemId
 * @param {ItemPatch} patch
 * @returns {SongResult}
 */
export function setItem(song, itemId, patch) {
  const next = clone(song);
  const item = next.arrangement.find((a) => a.id === itemId);
  if (!item) return fail(`並び順の項目が見つかりません: ${itemId}`, '曲を読み込み直してください', 'not_found');
  /** @param {Record<string, any>} o */
  const empty = (o) => Object.keys(o).length === 0;

  if (patch.mix !== undefined) {
    if (patch.mix === null) delete item.mix;
    else {
      const mix = item.mix ?? {};
      for (const [tid, m] of Object.entries(patch.mix)) {
        if (!next.tracks.some((t) => t.id === tid)) return fail(`パートが見つかりません: ${tid}`, '曲のパートの一覧から選んでください', 'invalid_song');
        if (m === null) delete mix[tid];
        else {
          const cur = { ...mix[tid] };
          if (m.muted !== undefined) m.muted ? (cur.muted = true) : delete cur.muted;
          if (m.volume !== undefined) m.volume === null ? delete cur.volume : (cur.volume = m.volume);
          if (empty(cur)) delete mix[tid];
          else mix[tid] = cur;
        }
      }
      if (empty(mix)) delete item.mix;
      else item.mix = mix;
    }
  }
  if (patch.styles !== undefined) {
    if (patch.styles === null) delete item.styles;
    else {
      const styles = { ...item.styles };
      for (const [k, v] of Object.entries(patch.styles)) {
        if (!(k in STYLE_NAMES)) return fail(`知らない弾き方の項目です: ${k}`, `${Object.keys(STYLE_NAMES).join(' / ')} から選んでください`, 'invalid_song');
        if (v === null || v === '') delete (/** @type {any} */ (styles))[k];
        else /** @type {any} */ (styles)[k] = v;
      }
      if (empty(styles)) delete item.styles;
      else item.styles = styles;
    }
  }
  if (patch.instruments !== undefined) {
    if (patch.instruments === null) delete item.instruments;
    else {
      const instruments = { ...item.instruments };
      for (const [tid, v] of Object.entries(patch.instruments)) {
        if (v === null) delete instruments[tid];
        else instruments[tid] = v;
      }
      if (empty(instruments)) delete item.instruments;
      else item.instruments = instruments;
    }
  }
  if (patch.fx !== undefined) {
    if (patch.fx === null) delete item.fx;
    else {
      const fx = { ...item.fx };
      for (const k of /** @type {const} */ (['crash', 'fill', 'riser'])) if (patch.fx[k] !== undefined) patch.fx[k] ? (fx[k] = true) : delete fx[k];
      if (patch.fx.break !== undefined) patch.fx.break > 0 ? (fx.break = patch.fx.break) : delete fx.break;
      if (empty(fx)) delete item.fx;
      else item.fx = fx;
    }
  }
  return finish(next);
}

// ---- 部品ごとの転調 ----

/**
 * キーから キーへ移る時の半音の数(明るい/暗いが違う時は、音の並びが同じになる位置を基準にする)
 * @param {Key} from
 * @param {Key} to
 */
function keyShift(from, to) {
  /** @param {Key} k */
  const majorPc = (k) => mod12((pitchClassOf(k.tonic) ?? 0) + (k.mode === 'minor' ? 3 : 0));
  const shift = mod12(majorPc(to) - majorPc(from));
  return shift > 6 ? shift - 12 : shift;
}

/**
 * 部品の中身(コードと、ドラム以外の音符)を半音ずらす。部品を書き換える
 * @param {Song} song
 * @param {Section} section
 * @param {number} shift
 * @param {Key} newKey
 */
function shiftSection(song, section, shift, newKey) {
  const flat = keyPrefersFlat(newKey);
  const drums = new Set(song.tracks.filter((t) => t.role === 'drums').map((t) => t.id));
  section.chords = section.chords.map((c) => ({ ...c, symbol: transposeChord(c.symbol, shift, flat) }));
  for (const [tid, notes] of Object.entries(section.parts)) {
    if (drums.has(tid)) continue;
    section.parts[tid] = notes.map((n) => {
      let p = n.pitch + shift;
      while (p > 127) p -= 12;
      while (p < 0) p += 12;
      return { ...n, pitch: p };
    });
  }
  section.key = song.key.tonic === newKey.tonic && song.key.mode === newKey.mode ? undefined : { tonic: newKey.tonic, mode: newKey.mode };
  if (section.key === undefined) delete section.key;
}

/**
 * 部品のキーを変える(転調)。その部品のコードと音符だけが移る。同じ部品を使っている場所は、全部変わる。
 * 曲のキーと同じにすると、部品のキーの指定は外れる
 * @param {Song} song
 * @param {string} sectionId
 * @param {Key} key
 * @returns {SongResult}
 */
export function setSectionKey(song, sectionId, key) {
  if (!key || !isValidTonic(key.tonic) || (key.mode !== 'major' && key.mode !== 'minor')) {
    return fail('キーの書き方が正しくありません', '{ "tonic": "C#", "mode": "minor" } の形で指定してください', 'invalid_song');
  }
  const next = clone(song);
  const section = next.sections.find((s) => s.id === sectionId);
  if (!section) return fail(`部品が見つかりません: ${sectionId}`, '曲を読み込み直してください', 'not_found');
  shiftSection(next, section, keyShift(section.key ?? next.key, key), key);
  return finish(next, { strictSectionIds: [sectionId] });
}

/**
 * 部品を半音ずらして複製し、並びに入れる(大サビで上げる、など)。元の部品はそのまま
 * @param {Song} song
 * @param {string} sectionId
 * @param {{ semitones: number, name?: string, index?: number }} opts
 * @returns {SongResult}
 */
export function addSectionCopy(song, sectionId, opts) {
  const source = song.sections.find((s) => s.id === sectionId);
  if (!source) return fail(`部品が見つかりません: ${sectionId}`, '曲を読み込み直してください', 'not_found');
  if (!Number.isInteger(opts.semitones) || Math.abs(opts.semitones) > 12) return fail('ずらす半音の数は-12〜12の整数にしてください', '例: 半音上げるなら 1、全音なら 2');
  const next = clone(song);
  const nextId = createIdFactory(collectIds(next));
  const cur = source.key ?? next.key;
  const newPc = mod12((pitchClassOf(cur.tonic) ?? 0) + opts.semitones);
  const sharpKey = /** @type {Key} */ ({ tonic: pcName(newPc, false), mode: cur.mode });
  const newKey = keyPrefersFlat(sharpKey) ? /** @type {Key} */ ({ tonic: pcName(newPc, true), mode: cur.mode }) : sharpKey;
  /** @type {Section} */
  const copy = {
    ...clone(source),
    id: nextId('s'),
    name: (opts.name ?? `${source.name}(転調)`).trim() || source.name,
    parts: Object.fromEntries(Object.entries(source.parts).map(([tid, notes]) => [tid, notes.map((n) => ({ ...clone(n), id: nextId('n') }))])),
  };
  delete copy.key;
  shiftSection(next, copy, opts.semitones, newKey);
  next.sections.push(copy);
  const at = clampIndex(opts.index ?? next.arrangement.length, next.arrangement.length);
  next.arrangement.splice(at, 0, { id: nextId('a'), sectionId: copy.id, lyrics: [] });
  return finish(next, { strictSectionIds: [copy.id] });
}

// ---- 接続口の設定 ----

/**
 * 接続口だけが使う設定を、曲の extensions に入れる(例: VOICEVOX の歌い手)
 * @param {Song} song
 * @param {string} connectorId
 * @param {Record<string, unknown>} settings 今の設定に上書きする
 * @returns {SongResult}
 */
export function setConnectorSettings(song, connectorId, settings) {
  const next = clone(song);
  const current = /** @type {Record<string, unknown>} */ (next.extensions[connectorId] ?? {});
  next.extensions[connectorId] = { ...current, ...settings };
  return finish(next);
}

// ---- 曲の設定を変える ----

/**
 * @typedef {object} SongSettings
 * @property {string} [title]
 * @property {string} [artist]
 * @property {number} [tempo]
 * @property {Key} [key] キーを変えると音符とコードも一緒に移す
 * @property {import('./types.js').Mood | null} [mood]
 * @property {number} [humanize] 演奏の揺らぎの強さ 0〜1(0 で楽譜どおり)
 * @property {{ id: string, instrument?: import('./types.js').InstrumentId, volume?: number, muted?: boolean, name?: string, pan?: number, reverb?: number }[]} [tracks]
 */

/**
 * 曲名、テンポ、キー、パートの楽器と音量を変える
 * @param {Song} song
 * @param {SongSettings} settings
 * @returns {SongResult}
 */
export function updateSongSettings(song, settings) {
  let next = clone(song);
  if (settings.title !== undefined) {
    const title = settings.title.trim();
    if (!title) return fail('曲名が空です', '曲名を入れてください');
    next.meta.title = title;
  }
  if (settings.artist !== undefined) next.meta.artist = settings.artist.trim();
  if (settings.tempo !== undefined) {
    if (!(settings.tempo >= TEMPO_MIN && settings.tempo <= TEMPO_MAX)) {
      return fail(`テンポは${TEMPO_MIN}〜${TEMPO_MAX}にしてください`, '速さを範囲の中で選んでください');
    }
    next.tempo = settings.tempo;
  }
  if (settings.humanize !== undefined) {
    if (!(settings.humanize >= 0 && settings.humanize <= 1)) return fail('揺らぎの強さは0〜1にしてください', '0で楽譜どおり、1で標準です');
    next.humanize = settings.humanize;
  }
  if (settings.mood !== undefined) {
    if (settings.mood !== null && !isMood(settings.mood)) return fail(`知らない雰囲気です: ${settings.mood}`, '一覧から選んでください');
    next.mood = settings.mood;
  }
  if (settings.key !== undefined) {
    const k = settings.key;
    if (!isValidTonic(k.tonic) || (k.mode !== 'major' && k.mode !== 'minor')) {
      return fail('キーの書き方が正しくありません', '{ tonic: "A", mode: "minor" } の形で指定してください', 'invalid_song');
    }
    next = transposeSong(next, k);
  }
  if (settings.tracks !== undefined) {
    for (const change of settings.tracks) {
      const t = next.tracks.find((x) => x.id === change.id);
      if (!t) return fail(`パートが見つかりません: ${change.id}`, '曲を読み込み直してください', 'not_found');
      if (change.instrument !== undefined) {
        if (!isInstrument(change.instrument)) return fail(`知らない楽器です: ${change.instrument}`, '楽器の一覧から選んでください');
        t.instrument = change.instrument;
      }
      if (change.volume !== undefined) {
        if (!(change.volume >= 0 && change.volume <= 1)) return fail('音量は0〜1にしてください', '音量を範囲の中で選んでください');
        t.volume = change.volume;
      }
      if (change.pan !== undefined) {
        if (!(change.pan >= -1 && change.pan <= 1)) return fail('左右の位置は-1(左)〜1(右)にしてください', '範囲の中で選んでください');
        t.pan = change.pan;
      }
      if (change.reverb !== undefined) {
        if (!(change.reverb >= 0 && change.reverb <= 1)) return fail('残響の量は0〜1にしてください', '範囲の中で選んでください');
        t.reverb = change.reverb;
      }
      if (change.muted !== undefined) t.muted = change.muted;
      if (change.name !== undefined) t.name = change.name;
    }
  }
  return finish(next);
}

/**
 * キーを変え、音符とコードを一緒に移す(ドラムは除く)。
 * 明るい/暗いが変わる時は、音の並びが同じになる位置(平行調)を基準に移す
 * @param {Song} song
 * @param {Key} newKey
 * @returns {Song}
 */
function transposeSong(song, newKey) {
  /** @param {Key} k */
  const majorPc = (k) => mod12((pitchClassOf(k.tonic) ?? 0) + (k.mode === 'minor' ? 3 : 0));
  let shift = mod12(majorPc(newKey) - majorPc(song.key));
  if (shift > 6) shift -= 12;
  const flat = keyPrefersFlat(newKey);
  const drums = new Set(song.tracks.filter((t) => t.role === 'drums').map((t) => t.id));
  song.key = { tonic: newKey.tonic, mode: newKey.mode };
  if (shift === 0) {
    for (const s of song.sections) s.chords = s.chords.map((c) => ({ ...c, symbol: transposeChord(c.symbol, 0, flat) }));
    return song;
  }
  for (const s of song.sections) {
    s.chords = s.chords.map((c) => ({ ...c, symbol: transposeChord(c.symbol, shift, flat) }));
    for (const [tid, notes] of Object.entries(s.parts)) {
      if (drums.has(tid)) continue;
      s.parts[tid] = notes.map((n) => {
        let p = n.pitch + shift;
        while (p > 127) p -= 12;
        while (p < 0) p += 12;
        return { ...n, pitch: p };
      });
    }
  }
  return song;
}
