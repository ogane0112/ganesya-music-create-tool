// 歌詞。メロディの音符1つに、かな1音(モーラ)を乗せる。
// - 「きゃ」「しゅ」のような小さい字は前の字とまとめて1音
// - 「ん」「っ」「ー」はそれぞれ1音(ー は前の音の母音を伸ばす)
// - ひらがな・カタカナだけを受け付ける(漢字は読みが決まらないので、かなで書く)
import { ticksPerBar } from './theory.js';

/** @typedef {import('./types.js').Song} Song */
/** @typedef {import('./types.js').Note} Note */

const SMALL = 'ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ';
const KANA = /^[ぁ-ゖァ-ヺー]$/;

/** カタカナをひらがなにする @param {string} s */
export function toHiragana(s) {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/**
 * かなの文を、歌う1音ずつに分ける。空白・改行・句読点・記号は無視する
 * @param {string} text
 * @returns {{ morae: string[], invalid: string[] }} invalid は読めなかった字(漢字・英字など)
 */
export function splitMorae(text) {
  /** @type {string[]} */
  const morae = [];
  /** @type {string[]} */
  const invalid = [];
  for (const ch of text.normalize('NFKC')) {
    if (/[\s、。,.!?!?・「」『』()()\/|~〜…\-]/.test(ch)) continue;
    if (!KANA.test(ch)) {
      if (!invalid.includes(ch)) invalid.push(ch);
      continue;
    }
    if (SMALL.includes(ch) && morae.length) morae[morae.length - 1] += toHiragana(ch);
    else morae.push(toHiragana(ch));
  }
  return { morae, invalid };
}

/**
 * 歌のパート(役割が vocal のパート)。先頭が主旋律
 * @param {Song} song
 */
export function vocalTracks(song) {
  return song.tracks.filter((t) => t.role === 'vocal');
}

/**
 * 部品の歌のパートの音符(歌う順)。trackId を省くと主旋律(最初の歌のパート)
 * @param {Song} song
 * @param {string} sectionId
 * @param {string} [trackId]
 * @returns {Note[]}
 */
export function melodyNotes(song, sectionId, trackId) {
  const track = trackId ? song.tracks.find((t) => t.id === trackId) : vocalTracks(song)[0];
  const section = song.sections.find((s) => s.id === sectionId);
  if (!track || !section) return [];
  return [...(section.parts[track.id] ?? [])].sort((a, b) => a.start - b.start);
}

/** フレーズの区切りの規則(手引きにも書く) */
export const PHRASE_RULES = {
  /** これ以上の休み(ティック)があれば区切る。200 = 半拍(240)より少し短い */
  restTicks: 200,
  /** 1つのフレーズの長さの上限(小節) */
  maxBars: 2,
  /** これ以下の音数のまとまりは、近いフレーズにつなげる */
  mergeNotes: 2,
};

/**
 * メロディをフレーズ(息継ぎまでのまとまり)に分ける。
 * 音符に区切りの印(phrase、記法では / )が1つでもあれば、印だけで区切る。
 * なければ自動:半拍ほどの休みか、2小節の長さで区切り、1〜2音だけのまとまりは近い方へつなげる
 * @param {Song} song
 * @param {string} sectionId
 * @param {string} [trackId]
 * @returns {Note[][]}
 */
export function melodyPhrases(song, sectionId, trackId) {
  const notes = melodyNotes(song, sectionId, trackId);
  /** @type {Note[][]} */
  const phrases = [];
  if (notes.some((n) => n.phrase)) {
    for (const n of notes) {
      if (n.phrase || phrases.length === 0) phrases.push([n]);
      else phrases[phrases.length - 1].push(n);
    }
    return phrases;
  }
  const maxSpan = PHRASE_RULES.maxBars * ticksPerBar(song.timeSignature);
  for (const n of notes) {
    const cur = phrases[phrases.length - 1];
    const prev = cur?.[cur.length - 1];
    if (!cur || !prev || n.start - (prev.start + prev.length) >= PHRASE_RULES.restTicks || n.start - cur[0].start >= maxSpan) phrases.push([n]);
    else cur.push(n);
  }
  // 1〜2音だけの短いまとまり(次のフレーズへの入りの音など)は、近い方のフレーズにつなげる
  for (let i = 0; i < phrases.length; i++) {
    const p = phrases[i];
    if (p.length > PHRASE_RULES.mergeNotes || phrases.length === 1) continue;
    const last = p[p.length - 1];
    const next = phrases[i + 1];
    const prev = phrases[i - 1];
    if (next && next[0].start - (last.start + last.length) < 480) {
      next.unshift(...p);
      phrases.splice(i, 1);
      i--;
    } else if (prev && p[0].start - (prev[prev.length - 1].start + prev[prev.length - 1].length) < 480) {
      prev.push(...p);
      phrases.splice(i, 1);
      i--;
    }
  }
  return phrases;
}

/**
 * @typedef {object} LyricLine
 * @property {number} notes そのフレーズの音符の数
 * @property {number} morae 書かれた歌詞の音の数
 * @property {string} kana そのフレーズに乗った歌詞
 */

/**
 * 歌詞を音符に割り当てる。行(改行か / で区切る)がフレーズの数と同じなら、行ごとにフレーズへ割り当てる。
 * そうでなければ頭から順に割り当てる。
 * @param {Song} song
 * @param {string} sectionId
 * @param {string} text
 * @param {string} [trackId] 歌のパート(省略で主旋律)
 * @returns {{ lyrics: { noteId: string, kana: string }[], lines: LyricLine[], invalid: string[], fits: boolean }}
 */
export function assignLyrics(song, sectionId, text, trackId) {
  const phrases = melodyPhrases(song, sectionId, trackId);
  const rawLines = text.split(/[\n\/]/).map((l) => l.trim()).filter(Boolean);
  const all = splitMorae(text);
  /** @type {{ noteId: string, kana: string }[]} */
  const lyrics = [];
  /** @type {LyricLine[]} */
  const lines = [];
  if (rawLines.length === phrases.length) {
    phrases.forEach((phrase, i) => {
      const { morae } = splitMorae(rawLines[i]);
      phrase.forEach((n, k) => {
        if (morae[k]) lyrics.push({ noteId: n.id, kana: morae[k] });
      });
      lines.push({ notes: phrase.length, morae: morae.length, kana: morae.join('') });
    });
  } else {
    let k = 0;
    for (const phrase of phrases) {
      const used = all.morae.slice(k, k + phrase.length);
      phrase.forEach((n, i) => {
        if (used[i]) lyrics.push({ noteId: n.id, kana: used[i] });
      });
      lines.push({ notes: phrase.length, morae: used.length, kana: used.join('') });
      k += phrase.length;
    }
    // あふれた分は最後の行の字余りとして数える
    if (k < all.morae.length && lines.length) lines[lines.length - 1].morae += all.morae.length - k;
  }
  return { lyrics, lines, invalid: all.invalid, fits: all.invalid.length === 0 && lines.every((l) => l.notes === l.morae) };
}

/**
 * いま入っている歌詞を、フレーズごとの行にして返す(編集画面・AI向け)
 * @param {Song} song
 * @param {string} itemId 並び順のどこか
 * @param {string} [trackId] 歌のパート(省略で主旋律)
 * @returns {LyricLine[]}
 */
export function lyricLines(song, itemId, trackId) {
  const item = song.arrangement.find((a) => a.id === itemId);
  if (!item) return [];
  const byNote = new Map(item.lyrics.map((l) => [l.noteId, l.kana]));
  return melodyPhrases(song, item.sectionId, trackId).map((phrase) => {
    const kana = phrase.map((n) => byNote.get(n.id) ?? '');
    return { notes: phrase.length, morae: kana.filter(Boolean).length, kana: kana.join('') };
  });
}

/**
 * 歌わせる時の、音符ごとの歌詞。歌詞のない音符は、前の音の母音を伸ばす(フレーズの頭なら「ら」)
 * @param {Song} song
 * @param {string} itemId
 * @param {string} [trackId] 歌のパート(省略で主旋律)
 * @returns {{ note: Note, kana: string }[]}
 */
export function sungNotes(song, itemId, trackId) {
  const item = song.arrangement.find((a) => a.id === itemId);
  if (!item) return [];
  const byNote = new Map(item.lyrics.map((l) => [l.noteId, l.kana]));
  /** @type {{ note: Note, kana: string }[]} */
  const out = [];
  for (const phrase of melodyPhrases(song, item.sectionId, trackId)) {
    let prev = '';
    for (const note of phrase) {
      let kana = byNote.get(note.id) ?? '';
      if (!kana || kana === 'ー') kana = prev ? vowelOf(prev) : 'ら';
      out.push({ note, kana });
      prev = kana;
    }
  }
  return out;
}

const VOWEL_ROWS = /** @type {[string, string][]} */ ([
  ['あ', 'あかさたなはまやらわがざだばぱぁゃゎ'],
  ['い', 'いきしちにひみりぎじぢびぴぃ'],
  ['う', 'うくすつぬふむゆるぐずづぶぷぅゅゔ'],
  ['え', 'えけせてねへめれげぜでべぺぇ'],
  ['お', 'おこそとのほもよろをごぞどぼぽぉょ'],
]);

/** その音を伸ばした時の母音(「きゃ」→「あ」、「ん」→「ん」) @param {string} kana */
export function vowelOf(kana) {
  const last = kana[kana.length - 1];
  if (last === 'ん' || last === 'っ') return 'ん';
  for (const [vowel, chars] of VOWEL_ROWS) if (chars.includes(last)) return vowel;
  return 'あ';
}
