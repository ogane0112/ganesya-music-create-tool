// MCP の道具(9個)。画面と同じ「操作」を呼び、同じ検査を通す。曲の削除は出さない。
import { generateAlternatives } from '../src/core/alternatives.js';
import { authorSection, createAuthoredSong, resolveNotes } from '../src/core/authoring.js';
import { formatChords, formatMelody, NotationError } from '../src/core/notation.js';
import {
  addArrangementItem, addSection, createDraftSong, moveArrangementItem, registerSong, removeArrangementItem, renameSection,
  replaceSection, setItem, setLyrics, setSectionKey, addSectionCopy, updateSongSettings,
} from '../src/core/operations.js';
import { lyricLines } from '../src/core/lyrics.js';
import { keyPrefersFlat, pitchName, ticksPerBar } from '../src/core/theory.js';
import { buildTimeline } from '../src/core/timeline.js';
import { ticksToSeconds } from '../src/core/theory.js';
import { songToMidi } from '../src/connectors/midi/encode.js';
import { conflict } from './db.js';
import { formatGuide } from './guide.js';

/** @typedef {import('../src/core/types.js').Song} Song */
/** @typedef {import('../src/core/types.js').AppError} AppError */
/**
 * @typedef {{ status: 'done', url: string, fileName: string, bytes: number, seconds: number, expiresMinutes: number, timing?: Record<string, number> }} ExportDone
 * @typedef {{ status: 'running', jobId?: string, waitedSeconds?: number }} ExportRunning
 * @typedef {{ status: 'failed', message: string }} ExportFailed
 * @typedef {{ store: import('./db.js').SongStore, exportAudio?: (song: Song, opts: { itemIds?: string[] }) => Promise<ExportDone | ExportRunning>, exportStatus?: (jobId: string) => Promise<ExportDone | ExportRunning | ExportFailed | null> }} ToolContext
 */

/** 道具の中の失敗(AIに理由と対処を返す) */
export class ToolError extends Error {
  /** @param {AppError} error */
  constructor(error) {
    super(error.message);
    this.error = error;
  }
}

/**
 * 操作の結果を取り出す。失敗なら、AIが直せるように詳しく書いて投げる
 * @template T
 * @param {import('../src/core/types.js').Result<T>} r
 * @param {Song} [song]
 * @returns {T}
 */
function unwrap(r, song) {
  if (r.ok) return r.value;
  const d = /** @type {any} */ (r.error.details);
  if (d?.outOfKey) {
    const lines = d.outOfKey.slice(0, 12).map((/** @type {any} */ n) => {
      const name = song?.sections.find((s) => s.id === n.sectionId)?.name ?? n.sectionId;
      const beat = n.start / 480;
      return `${name} の ${Math.floor(beat / 4) + 1}小節目 ${Math.round((beat % 4) * 100) / 100 + 1}拍目(パート ${n.trackId}): ${pitchName(n.pitch)} は、キーにもコード ${n.chord ?? 'なし'} にも合いません`;
    });
    throw new ToolError({ ...r.error, message: `${r.error.message}\n${lines.join('\n')}`, hint: 'その音をキーの音かコードの音に変えるか、その音を含むコードをそこに置いてください' });
  }
  if (d?.problems) {
    throw new ToolError({ ...r.error, message: `${r.error.message}\n${d.problems.slice(0, 8).map((/** @type {any} */ p) => `${p.path}: ${p.message}`).join('\n')}` });
  }
  throw new ToolError(r.error);
}

/** 書き方の間違いを道具の失敗にする @template T @param {() => T} fn @returns {T} */
function authoring(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ToolError) throw e;
    throw new ToolError({
      code: 'invalid_song',
      message: e instanceof Error ? e.message : String(e),
      hint: e instanceof NotationError ? 'かんたん記法の書き方を確かめてください(get_format_guide)' : '内容を直してもう一度送ってください',
    });
  }
}

/** @param {import('../src/core/types.js').Note[]} notes */
const stripIds = (notes) => notes.map(({ id: _id, ...rest }) => rest);

/**
 * AI向けの要約:設定、並び、部品ごとのコード進行とメロディ(かんたん記法)
 * @param {string} id
 * @param {Song} song
 * @param {{ velocities?: boolean }} [opts] velocities=true で、メロディに強さ(@数字)を付ける
 */
export function summarize(id, song, opts = {}) {
  const flat = keyPrefersFlat(song.key);
  const barTicks = ticksPerBar(song.timeSignature);
  const melodyTrack = song.tracks.find((t) => t.role === 'vocal')?.id;
  const tl = buildTimeline(song);
  return {
    songId: id,
    revision: song.revision,
    title: song.meta.title,
    tempo: song.tempo,
    key: song.key,
    mood: song.mood,
    seconds: Math.round(ticksToSeconds(tl.totalTicks, song.tempo)),
    humanize: song.humanize ?? 1,
    tracks: song.tracks.map((t) => ({ id: t.id, role: t.role, name: t.name, instrument: t.instrument, volume: t.volume, muted: !!t.muted, pan: t.pan, reverb: t.reverb })),
    // lyrics はフレーズ(息継ぎまで)ごとの行。notes がその行に必要な音数、kana が今の歌詞
    arrangement: song.arrangement.map((a, index) => ({
      index, itemId: a.id, sectionId: a.sectionId, name: song.sections.find((s) => s.id === a.sectionId)?.name,
      lyrics: lyricLines(song, a.id).map((l) => ({ notes: l.notes, kana: l.kana })),
      ...(a.mix ? { mix: a.mix } : {}), ...(a.styles ? { styles: a.styles } : {}), ...(a.instruments ? { instruments: a.instruments } : {}), ...(a.fx ? { fx: a.fx } : {}),
    })),
    sections: song.sections.map((s) => ({
      sectionId: s.id,
      name: s.name,
      kind: s.kind,
      bars: s.bars,
      ...(s.key ? { key: s.key } : {}),
      chords: formatChords(s.chords),
      melody: melodyTrack ? formatMelody(s.parts[melodyTrack] ?? [], { flat, barTicks, totalTicks: s.bars * barTicks, velocities: opts.velocities }) : '',
    })),
  };
}

/**
 * 保存して要約を返す
 * @param {ToolContext} ctx
 * @param {string} id
 * @param {Song} song
 * @param {number} revision
 */
async function save(ctx, id, song, revision) {
  const saved = await ctx.store.update(id, song, revision);
  return summarize(id, saved);
}

/**
 * 曲を読み、渡された revision が最新かを確かめる
 * @param {ToolContext} ctx
 * @param {any} args
 */
async function loadForWrite(ctx, args) {
  if (typeof args.songId !== 'string') throw new ToolError({ code: 'invalid_arguments', message: 'songId がありません', hint: 'list_songs で曲のIDを確かめてください' });
  if (!Number.isInteger(args.revision)) throw new ToolError({ code: 'invalid_arguments', message: 'revision がありません', hint: 'get_song で最新の revision を受け取って渡してください' });
  const song = await ctx.store.get(args.songId);
  if (song.revision !== args.revision) throw conflict();
  return song;
}

const KEY_SCHEMA = { type: 'object', properties: { tonic: { type: 'string', description: '主音。C, C#, Db, D, ... B' }, mode: { type: 'string', enum: ['major', 'minor'] } }, required: ['tonic', 'mode'] };
const STYLES_SCHEMA = {
  type: 'object',
  description: '伴奏の弾き方(省略すると雰囲気に合わせて自動)',
  properties: { chordStyle: { type: 'string' }, bassStyle: { type: 'string' }, drumStyle: { type: 'string' }, leadStyle: { type: 'string' } },
};
const SECTION_SPEC_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: '表示名。例: Aメロ、Bメロ、サビ' },
    kind: { type: 'string', enum: ['intro', 'verse', 'prechorus', 'chorus', 'bridge', 'outro', 'other'] },
    bars: { type: 'integer', description: '小節数(4/4拍子。1小節=4拍)' },
    chords: { type: 'string', description: 'コード進行(かんたん記法)。例 "Fmaj7:4 E7:4 Am7:4 Gm7:2 C7:2"。省略するとルールが作る' },
    melody: { type: 'string', description: 'メロディ(かんたん記法)。例 "r:0.5 A4:0.5 C5:1 | E5:2 r:2"。省略するとルールが作る' },
    styles: STYLES_SCHEMA,
  },
  required: ['name', 'kind', 'bars'],
};
const WRITE_PROPS = { songId: { type: 'string' }, revision: { type: 'integer', description: '手元の最新の revision(get_song や前の書き込みの結果で受け取ったもの)' } };

/**
 * @typedef {object} Tool
 * @property {string} name
 * @property {string} description
 * @property {object} inputSchema
 * @property {(args: any, ctx: ToolContext) => Promise<unknown>} run 返したものは JSON にして返す。{ __content } を返すとそのまま返す
 */

/** @type {Tool[]} */
export const TOOLS = [
  {
    name: 'get_format_guide',
    description: '最初に必ず読む。曲の書き方(かんたん記法)、破綻防止の決まり、良い曲にするための作風の手引き(米津玄師風の特徴を含む)を返す。',
    inputSchema: { type: 'object', properties: {} },
    run: async () => ({ __content: [{ type: 'text', text: formatGuide() }] }),
  },
  {
    name: 'list_songs',
    description: '保存されている曲の一覧(ID、曲名、更新日時)を返す。',
    inputSchema: { type: 'object', properties: {} },
    run: async (_args, ctx) => ({ songs: await ctx.store.list() }),
  },
  {
    name: 'get_song',
    description: '曲1つを読む。既定(summary)は設定・並び・部品ごとのコード進行とメロディをかんたん記法で返す。detail: "full" で全パートの音符を含む曲データをそのまま返す(大きいので必要な時だけ。sectionId で1つの部品に絞れる)。',
    inputSchema: {
      type: 'object',
      properties: { songId: { type: 'string' }, detail: { type: 'string', enum: ['summary', 'full'] }, sectionId: { type: 'string', description: 'full の時、この部品だけ返す' }, velocity: { type: 'boolean', description: 'true なら、メロディの各音に強さ(@数字)を付けて返す' } },
      required: ['songId'],
    },
    run: async (args, ctx) => {
      const song = await ctx.store.get(args.songId);
      if (args.detail !== 'full') return summarize(args.songId, song, { velocities: !!args.velocity });
      if (args.sectionId) {
        const section = song.sections.find((s) => s.id === args.sectionId);
        if (!section) throw new ToolError({ code: 'not_found', message: `部品が見つかりません: ${args.sectionId}`, hint: 'get_song の summary で sectionId を確かめてください' });
        return { songId: args.songId, revision: song.revision, tracks: song.tracks, section };
      }
      return { songId: args.songId, song };
    },
  },
  {
    name: 'create_song',
    description: '曲を新しく作って保存する。3通り: (1) sections にコード進行とメロディを書いて渡す(おすすめ。伴奏は自動で付く。key が必要) (2) title・mood・tempo だけ渡すと、ルールが叩き台(Aメロ・Bメロ・サビ)を作る (3) song に曲データ全体を渡すとそのまま登録する。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        mood: { type: 'string', enum: ['setsunai', 'shissou', 'dark', 'akarui', 'wafu-edm', 'rock'], description: '雰囲気。楽器の組み合わせと伴奏の傾向が決まる' },
        tempo: { type: 'number', description: '1分あたりの拍数(40〜240)' },
        key: KEY_SCHEMA,
        sections: { type: 'array', items: SECTION_SPEC_SCHEMA, description: '曲の頭から順に並べる部品' },
        song: { type: 'object', description: '曲データ全体(formatVersion 1)。これを渡した時は他の項目は使わない' },
      },
    },
    run: async (args, ctx) => {
      /** @type {Song} */
      let song;
      if (args.song) song = unwrap(registerSong(args.song));
      else if (args.sections) song = unwrap(createAuthoredSong(args));
      else song = unwrap(createDraftSong({ mood: args.mood, tempo: args.tempo, title: args.title }));
      const created = await ctx.store.create(song);
      return summarize(created.id, created.song);
    },
  },
  {
    name: 'generate_alternatives',
    description: '部品1つについて、ルールによる別案を3つ作って返す(保存はしない)。気に入った案は、返ってきた seed と index を replace_section の alternative に渡して採用する。',
    inputSchema: {
      type: 'object',
      properties: { songId: { type: 'string' }, sectionId: { type: 'string' }, target: { type: 'string', enum: ['melody', 'chords', 'accompaniment', 'all'], description: '何を変えるか' } },
      required: ['songId', 'sectionId', 'target'],
    },
    run: async (args, ctx) => {
      const song = await ctx.store.get(args.songId);
      const seed = Math.floor(Math.random() * 0x7fffffff);
      const alts = unwrap(generateAlternatives(song, args.sectionId, args.target, { seed }), song);
      const section = song.sections.find((s) => s.id === args.sectionId);
      const melodyTrack = song.tracks.find((t) => t.role === 'vocal')?.id ?? '';
      const barTicks = ticksPerBar(song.timeSignature);
      return {
        revision: song.revision,
        seed,
        target: args.target,
        alternatives: alts.map((a, index) => ({
          index,
          chords: a.replacement.chords ? formatChords(a.replacement.chords) : '(変わらない)',
          melody: a.replacement.parts[melodyTrack]
            ? formatMelody(a.replacement.parts[melodyTrack], { flat: keyPrefersFlat(song.key), barTicks, totalTicks: (section?.bars ?? 0) * barTicks })
            : '(変わらない)',
          changedParts: Object.keys(a.replacement.parts),
        })),
      };
    },
  },
  {
    name: 'replace_section',
    description: '部品1つを書き換えて保存する。key を渡すと、その部品のキーを変える(転調。コードと音符がその部品だけ移る)。melody だけ → メロディ(と合間の彩り)だけ変わる。chords → コード進行が変わり伴奏も作り直す(メロディはそのまま)。styles だけ → 伴奏の弾き方だけ変わる。parts であるパートの音符を直接書ける。alternative で generate_alternatives の案を採用できる。',
    inputSchema: {
      type: 'object',
      properties: {
        ...WRITE_PROPS,
        sectionId: { type: 'string' },
        chords: { type: 'string', description: 'コード進行(かんたん記法)' },
        melody: { type: 'string', description: 'メロディ(かんたん記法)' },
        bars: { type: 'integer', description: '小節数を変える時だけ。変えると伴奏はすべて作り直す' },
        key: KEY_SCHEMA,
        styles: STYLES_SCHEMA,
        parts: { type: 'object', description: 'パートID(t2 など)ごとに音符を直接書く。値はかんたん記法の文字か、{start,length,pitch,velocity} の配列(1拍=480)。ドラム(t4)は pitch が打楽器の番号(36=バスドラム、38=スネア、42=ハイハット、46=開いたハイハット、49=シンバル、39=手拍子)' },
        alternative: { type: 'object', description: 'generate_alternatives の案を採用する', properties: { target: { type: 'string' }, seed: { type: 'integer' }, index: { type: 'integer' } }, required: ['target', 'seed', 'index'] },
      },
      required: ['songId', 'revision', 'sectionId'],
    },
    run: async (args, ctx) => {
      const song = await loadForWrite(ctx, args);
      const section = song.sections.find((s) => s.id === args.sectionId);
      if (!section) throw new ToolError({ code: 'not_found', message: `部品が見つかりません: ${args.sectionId}`, hint: 'get_song で sectionId を確かめてください' });
      /** @type {Parameters<typeof replaceSection>[2]} */
      let replacement = { parts: {} };
      if (args.alternative) {
        const alts = unwrap(generateAlternatives(song, section.id, args.alternative.target, { seed: args.alternative.seed }), song);
        const alt = alts[args.alternative.index];
        if (!alt) throw new ToolError({ code: 'invalid_arguments', message: 'その番号の別案はありません', hint: 'index は 0〜2 です' });
        replacement = alt.replacement;
      } else if (args.chords !== undefined || args.melody !== undefined || args.styles || args.bars) {
        const melodyTrack = song.tracks.find((t) => t.role === 'vocal')?.id;
        const everything = !!args.bars && args.bars !== section.bars;
        const accompaniment = args.chords !== undefined || !!args.styles;
        /** @type {import('../src/core/composer/index.js').Part[] | undefined} */
        const only = everything ? undefined : [
          ...(args.melody !== undefined ? /** @type {const} */ (['melody']) : []),
          ...(accompaniment ? /** @type {const} */ (['chords', 'bass', 'drums', 'pad', 'lead']) : []),
          'color',
        ];
        const content = authoring(() => authorSection(song, {
          name: section.name,
          kind: section.kind,
          bars: args.bars ?? section.bars,
          chords: args.chords ?? section.chords,
          melody: args.melody ?? (everything ? undefined : melodyTrack ? stripIds(section.parts[melodyTrack] ?? []) : undefined),
          styles: args.styles,
        }, { only }));
        replacement = { parts: content.parts };
        if (args.chords !== undefined || everything) replacement.chords = content.chords;
        if (everything) replacement.bars = args.bars;
      }
      if (args.parts) {
        for (const [trackId, value] of Object.entries(args.parts)) {
          /** @type {any} */ (replacement.parts)[trackId] = authoring(() => resolveNotes(/** @type {any} */ (value)) ?? []);
        }
      }
      if (!replacement.chords && Object.keys(replacement.parts ?? {}).length === 0 && !args.key) {
        throw new ToolError({ code: 'invalid_arguments', message: '書き換える内容がありません', hint: 'melody・chords・styles・parts・alternative のどれかを渡してください' });
      }
      let result = unwrap(replaceSection(song, section.id, replacement), song);
      // key を渡すと、その部品のキーを変える(部品のコードと音符がそのキーへ移る。同じ部品を使う場所は全部変わる)
      if (args.key) result = unwrap(setSectionKey(result, section.id, args.key), result);
      return save(ctx, args.songId, result, args.revision);
    },
  },
  {
    name: 'update_arrangement',
    description: '部品の並びを変えて保存する。action: add(既にある部品をもう一度並べる)/ add_section(新しい部品を書いて足す)/ add_copy(部品を半音ずらして複製して並べる = 転調。大サビで上げる時など)/ remove(並びから外す)/ move(並べ替え)/ rename(名前・種類を変える)/ set_item(並びの1か所だけの、消音・音量・弾き方・楽器・つなぎの演出)。',
    inputSchema: {
      type: 'object',
      properties: {
        ...WRITE_PROPS,
        action: { type: 'string', enum: ['add', 'add_section', 'add_copy', 'remove', 'move', 'rename', 'set_item'] },
        sectionId: { type: 'string', description: 'add / rename で使う' },
        itemId: { type: 'string', description: 'remove / move で使う(get_song の arrangement の itemId)' },
        index: { type: 'integer', description: 'add / add_section で入れる位置、move で動かした後の位置(0が先頭。省略で末尾)' },
        section: SECTION_SPEC_SCHEMA,
        name: { type: 'string', description: 'rename の新しい名前、add_copy の複製の名前' },
        kind: { type: 'string' },
        semitones: { type: 'integer', description: 'add_copy でずらす半音の数。上げるなら正(半音上げ = 1、全音上げ = 2)、下げるなら負' },
        mix: { type: 'object', description: 'set_item:パート(t4 など)ごとに { muted: true } か { volume: 0〜1 }。null でそのパートを元に戻す。例 {"t4":{"muted":true}} で、この場所だけドラムを抜く' },
        styles: { type: 'object', description: 'set_item:この場所だけの伴奏の弾き方(chordStyle・bassStyle・drumStyle・leadStyle)。指定したパートだけ作り直し、メロディとコードは部品のまま。null の項目は元に戻す' },
        instruments: { type: 'object', description: 'set_item:この場所だけのパートの楽器。例 {"t2":"piano"}。null で元に戻す' },
        fx: { type: 'object', description: 'set_item:つなぎの演出 { crash: 頭にシンバル, fill: 最後の1小節をフィル, riser: 最後の2小節に上がっていく効果音, break: 終わりの何拍を無音にするか(0〜8) }' },
      },
      required: ['songId', 'revision', 'action'],
    },
    run: async (args, ctx) => {
      const song = await loadForWrite(ctx, args);
      /** @type {import('../src/core/types.js').Result<Song>} */
      let r;
      switch (args.action) {
        case 'add': r = addArrangementItem(song, args.sectionId, args.index); break;
        case 'remove': r = removeArrangementItem(song, args.itemId); break;
        case 'move': r = moveArrangementItem(song, args.itemId, args.index ?? song.arrangement.length); break;
        case 'rename': r = renameSection(song, args.sectionId, { name: args.name, kind: args.kind }); break;
        case 'add_copy': r = addSectionCopy(song, args.sectionId, { semitones: args.semitones, name: args.name, index: args.index }); break;
        case 'set_item': r = setItem(song, args.itemId, { mix: args.mix, styles: args.styles, instruments: args.instruments, fx: args.fx }); break;
        case 'add_section': {
          const spec = args.section;
          if (!spec) throw new ToolError({ code: 'invalid_arguments', message: 'section がありません', hint: 'name・kind・bars・chords・melody を書いて渡してください' });
          const content = authoring(() => authorSection(song, spec));
          r = addSection(song, { name: String(spec.name ?? '部品'), kind: spec.kind, bars: spec.bars, chords: content.chords, parts: /** @type {any} */ (content.parts) }, args.index);
          break;
        }
        default:
          throw new ToolError({ code: 'invalid_arguments', message: `知らない action です: ${args.action}`, hint: 'add / add_section / add_copy / remove / move / rename / set_item から選んでください' });
      }
      return save(ctx, args.songId, unwrap(r, song), args.revision);
    },
  },
  {
    name: 'set_lyrics',
    description: '並び順の1か所(itemId)に歌詞を入れて保存する。歌詞はかな(ひらがな・カタカナ)で、フレーズ(息継ぎまで)ごとに1行。各行の音数は get_song の arrangement[].lyrics[].notes に合わせる(小さい「ゃゅょ」は前の字と合わせて1音、「ん」「っ」「ー」は1音)。合わない時は、どの行が何音ずれているかを返すので直して送り直す。1番と2番は itemId が別なので、同じメロディに違う歌詞を入れられる。',
    inputSchema: {
      type: 'object',
      properties: {
        ...WRITE_PROPS,
        itemId: { type: 'string', description: 'get_song の arrangement の itemId' },
        lines: { type: 'array', items: { type: 'string' }, description: 'フレーズごとの歌詞(かな)。行数はフレーズの数と同じにする。空の配列で歌詞を消す' },
      },
      required: ['songId', 'revision', 'itemId', 'lines'],
    },
    run: async (args, ctx) => {
      const song = await loadForWrite(ctx, args);
      const lines = Array.isArray(args.lines) ? args.lines.map(String) : [];
      const expected = lyricLines(song, args.itemId).length;
      if (lines.length && lines.length !== expected) {
        throw new ToolError({ code: 'lyrics_mismatch', message: `行数が合いません(渡された行: ${lines.length}、フレーズ: ${expected})`, hint: `get_song の arrangement[].lyrics を見て、${expected}行にしてください` });
      }
      return save(ctx, args.songId, unwrap(setLyrics(song, args.itemId, lines.join('\n'), { strict: true }), song), args.revision);
    },
  },
  {
    name: 'update_song_settings',
    description: '曲名、テンポ、キー(変えると音符とコードも一緒に移る)、演奏の揺らぎ(humanize)、パートの楽器・音量・消音・左右の位置(pan)・残響の量(reverb)を変えて保存する。',
    inputSchema: {
      type: 'object',
      properties: {
        ...WRITE_PROPS,
        title: { type: 'string' },
        artist: { type: 'string' },
        tempo: { type: 'number' },
        key: KEY_SCHEMA,
        humanize: { type: 'number', description: '演奏の揺らぎ(タイミング・強弱)の強さ。0 で楽譜どおり、1 が標準' },
        tracks: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, instrument: { type: 'string' }, volume: { type: 'number', description: '0〜1' }, muted: { type: 'boolean' }, pan: { type: 'number', description: '左右の位置。-1(左)〜1(右)' }, reverb: { type: 'number', description: '残響の量。0〜1' } }, required: ['id'] } },
      },
      required: ['songId', 'revision'],
    },
    run: async (args, ctx) => {
      const song = await loadForWrite(ctx, args);
      const { title, artist, tempo, key, tracks, humanize } = args;
      return save(ctx, args.songId, unwrap(updateSongSettings(song, { title, artist, tempo, key, tracks, humanize }), song), args.revision);
    },
  },
  {
    name: 'export_audio',
    description: '曲を音声ファイル(WAV)にして、ダウンロードできるURLを返す。音は画面の書き出しと同じ(録音の楽器・残響・演奏の揺らぎ・音量の仕上げ込み)。サーバーのブラウザで作るので、1曲で20秒〜1分ほどかかる。25秒以内に終われば status: "done" とURLを返す。終わらなければ status: "running" と jobId を返すので、少し待って get_export に jobId を渡して受け取る(利用者には「作っています」と伝えて待てばよい)。URLは1時間だけ使える(知っている人は誰でも受け取れるので、人に見せない)。歌声(VOICEVOX)は利用者のPCで作るので入らない。楽器の演奏だけ。一部だけ書き出すなら itemIds を渡す。',
    inputSchema: {
      type: 'object',
      properties: {
        songId: { type: 'string' },
        itemIds: { type: 'array', items: { type: 'string' }, description: '一部の場所だけ書き出す時の、get_song の arrangement の itemId(省略で曲全体)' },
      },
      required: ['songId'],
    },
    run: async (args, ctx) => {
      if (!ctx.exportAudio) throw new ToolError({ code: 'unavailable', message: '音声の書き出しは、この環境では使えません', hint: 'アプリの画面の「音声ファイル(WAV)で保存」を使ってください' });
      const song = await ctx.store.get(args.songId);
      if (args.itemIds && !args.itemIds.every((/** @type {string} */ id) => song.arrangement.some((a) => a.id === id))) {
        throw new ToolError({ code: 'not_found', message: '知らない itemId があります', hint: 'get_song の arrangement の itemId から選んでください' });
      }
      try {
        const r = await ctx.exportAudio(song, { itemIds: args.itemIds });
        return r.status === 'done'
          ? { ...r, note: '歌声は入っていません(楽器の演奏だけ)。URLは1時間で切れます' }
          : { ...r, note: 'まだ作っています。10〜20秒ほど待ってから、get_export に jobId を渡してください' };
      } catch (e) {
        throw new ToolError({ code: 'export_failed', message: e instanceof Error ? e.message : '音声を作れませんでした', hint: '1分ほど待ってからもう一度試してください(短い時間に何度も書き出すと、サーバーのブラウザの起動回数の上限に当たります)。続く場合は、画面の「音声ファイル(WAV)で保存」を使ってください' });
      }
    },
  },
  {
    name: 'get_export',
    description: 'export_audio が status: "running" を返した時に、jobId を渡して、書き出しの結果(ダウンロードできるURL)を受け取る。まだなら status: "running" のまま。',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
    run: async (args, ctx) => {
      if (!ctx.exportStatus) throw new ToolError({ code: 'unavailable', message: '音声の書き出しは、この環境では使えません', hint: 'アプリの画面の「音声ファイル(WAV)で保存」を使ってください' });
      const r = await ctx.exportStatus(String(args.jobId ?? ''));
      if (!r) throw new ToolError({ code: 'not_found', message: 'その書き出し(jobId)は見つかりません', hint: 'export_audio が返した jobId をそのまま渡してください' });
      if (r.status === 'failed') throw new ToolError({ code: 'export_failed', message: r.message, hint: 'もう一度 export_audio から始めてください。続く場合は、画面の「音声ファイル(WAV)で保存」を使ってください' });
      return r.status === 'done'
        ? { ...r, note: '歌声は入っていません(楽器の演奏だけ)。URLは1時間で切れます' }
        : { ...r, note: 'まだ作っています。10秒ほど待って、もう一度 get_export を呼んでください' };
    },
  },
  {
    name: 'export_midi',
    description: '曲をMIDIファイル(.mid)にして返す。他の作曲ソフトで開ける。',
    inputSchema: { type: 'object', properties: { songId: { type: 'string' } }, required: ['songId'] },
    run: async (args, ctx) => {
      const song = await ctx.store.get(args.songId);
      const { bytes, warnings } = songToMidi(song);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return {
        __content: [
          { type: 'text', text: JSON.stringify({ fileName: `${song.meta.title}.mid`, bytes: bytes.length, warnings }) },
          { type: 'resource', resource: { uri: `ganesya://songs/${args.songId}.mid`, mimeType: 'audio/midi', blob: btoa(bin) } },
        ],
      };
    },
  },
];
