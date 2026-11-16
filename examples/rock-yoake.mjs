// 作例:ロック「夜明けのシャウト」(オリジナル)。J-ROCKの型(王道進行、借用したV7、サビ前の溜め、Cメロ→ラスサビ)を使って
// コード進行とメロディをかんたん記法で書き、伴奏はルールに任せ、歌詞はかなで音数を合わせている。
// 使い方: node examples/rock-yoake.mjs [出力.json]   曲データ(歌詞入り)を書き出す。音数が合わなければ理由を出して止まる。
import { writeFileSync } from 'node:fs';
import { createAuthoredSong } from '../src/core/authoring.js';
import { lyricLines } from '../src/core/lyrics.js';
import { addArrangementItem, moveArrangementItem, setLyrics } from '../src/core/operations.js';

/** キー B minor(D major と同じ音)。コードの借用: F#7(A# を含む)で Bm へ強く引っぱる */
export const SECTIONS = [
  { name: 'イントロ', kind: 'intro', bars: 4, chords: 'Bm:4 G:4 D:4 A:4' },
  {
    name: 'Aメロ', kind: 'verse', bars: 8,
    chords: 'Bm:4 G:4 D:4 A:4 Bm:4 G:4 D/F#:4 Em7:2 A7sus4:1 A7:1',
    melody: [
      'r:0.5 B3:0.25 B3:0.25 B3:0.5 D4:0.5 F#4:1 E4:0.5 D4:0.5',
      'D4:0.5 D4:0.5 E4:1 D4:0.5 B3:1 r:0.5',
      'r:0.5 A3:0.25 A3:0.25 A3:0.5 D4:0.5 F#4:1 A4:0.5 F#4:0.5',
      'E4:0.5 E4:0.5 F#4:1 E4:0.5 C#4:1 r:0.5',
      'r:0.5 B3:0.25 B3:0.25 B3:0.5 D4:0.5 F#4:1 B4:0.5 A4:0.5',
      'G4:0.5 G4:0.5 F#4:1 E4:0.5 D4:1 r:0.5',
      'r:0.5 A3:0.5 D4:0.5 F#4:0.5 A4:1 G4:0.5 F#4:0.5',
      'E4:1 G4:1 A4:1.5 r:0.5',
    ].join(' | '),
  },
  {
    name: 'Bメロ', kind: 'prechorus', bars: 8,
    chords: 'G:4 A:4 F#m:4 Bm:4 G:4 A:4 G:2 A:2 A7sus4:2 A7:2',
    melody: [
      'r:1 D4:0.5 E4:0.5 G4:1 F#4:1',
      'E4:1.5 F#4:0.5 A4:1.5 r:0.5',
      'r:1 F#4:0.5 A4:0.5 C#5:1 B4:1',
      'D5:1.5 C#5:0.5 B4:1.5 r:0.5',
      'r:0.5 B4:0.5 B4:0.5 D5:0.5 E5:1 D5:1',
      'C#5:1 D5:0.5 C#5:0.5 E5:2',
      'r:0.5 E5:0.5 D5:0.5 B4:0.5 C#5:0.5 D5:0.5 E5:1',
      'E5:2 r:2',
    ].join(' | '),
  },
  {
    name: 'サビ', kind: 'chorus', bars: 8,
    chords: 'G:4 A:4 D:4 F#7:4 G:4 A:4 Bm:2 G:2 A:2 F#7:2',
    melody: [
      'B4:0.5 D5:0.5 E5:1.5 D5:0.5 B4:1',
      'C#5:0.5 E5:0.5 F#5:1.5 E5:0.5 C#5:1',
      'D5:0.5 D5:0.5 F#5:1 E5:1 D5:1',
      'C#5:1.5 B4:0.5 A#4:1 r:1',
      'B4:0.5 D5:0.5 E5:1.5 D5:0.5 B4:1',
      'C#5:0.5 E5:0.5 F#5:1.5 E5:0.5 C#5:1',
      'D5:1 B4:1 r:0.5 D5:0.5 E5:1',
      'F#5:1 E5:1 C#5:1.5 r:0.5',
    ].join(' | '),
  },
  {
    name: 'Cメロ', kind: 'bridge', bars: 8,
    chords: 'Bm:4 G:4 Em:4 F#7:4 G:4 Em:4 G:2 A:2 A7:4',
    melody: [
      'F#4:2 D4:1 B3:1',
      'D4:1 E4:1 G4:1.5 r:0.5',
      'E4:1 G4:1 B4:2',
      'A#4:1 C#5:1 B4:1 r:1',
      'D5:1.5 B4:0.5 G4:2',
      'B4:1 G4:1 E4:1.5 r:0.5',
      'G4:1 B4:1 C#5:1 E5:1',
      'E5:3 r:1',
    ].join(' | '),
  },
  { name: 'アウトロ', kind: 'outro', bars: 4, chords: 'G:4 A:4 Bm:4 Bm:4', melody: 'r:16' },
];

/** 歌詞(かな)。1行 = 1フレーズ。音数はフレーズの音符の数に合わせてある */
export const LYRICS = {
  verse1: ['くらいへやでひとりぼっち', 'なりやまないこどうのおと', 'まどのそとではよがあける', 'きみのこえをきいた'],
  pre1: ['いまをにげたら', 'かわれないまま', 'ふるえるこえでいい', 'さけべいまなら'],
  chorus1: ['はしりだせあしたへと', 'もうとまらないよ', 'このこえがかれるまで', 'うたいつづける'],
  verse2: ['ふあんなんてもうなれたよ', 'つまずいたってたちあがる', 'まけたくないからわらった', 'かっこわるくていい'],
  pre2: ['だれかのまねじゃ', 'とどかないんだ', 'じぶんだけのうたを', 'うたいたいんだ'],
  chorus2: ['さけびだせあさやけへ', 'もうとめられない', 'このこえがとどくまで', 'うたいつづける'],
  bridge: ['ゆめはとおい', 'あきらめない', 'ぼくのこえが', 'とどくまで'],
  chorus3: ['はしりだせあしたへと', 'もうとまらないよ', 'このこえがかれるまで', 'うたいつづける'],
};

/** 並び順: イントロ → A → B → サビ → A → B → サビ → C → ラスサビ → アウトロ */
export function build({ title = '夜明けのシャウト', seed = 20260101 } = {}) {
  const r = createAuthoredSong({
    title, mood: 'rock', tempo: 160, key: { tonic: 'B', mode: 'minor' }, seed,
    sections: SECTIONS.map((s) => ({ ...s })),
  });
  if (!r.ok) throw new Error(r.error.message);
  let song = r.value;
  const id = (name) => song.sections.find((s) => s.name === name).id;
  const add = (name) => {
    const res = addArrangementItem(song, id(name));
    if (!res.ok) throw new Error(res.error.message);
    song = res.value;
  };
  // もとの並びは Intro, A, B, サビ, C, アウトロ。2番とラスサビを足して並べ替える
  for (const name of ['Aメロ', 'Bメロ', 'サビ', 'サビ']) add(name);
  const order = ['イントロ', 'Aメロ', 'Bメロ', 'サビ', 'Aメロ', 'Bメロ', 'サビ', 'Cメロ', 'サビ', 'アウトロ'];
  // 目標の並びになるまで、1つずつ正しい位置へ動かす
  const nameOf = (a) => song.sections.find((s) => s.id === a.sectionId).name;
  for (let i = 0; i < order.length; i++) {
    if (nameOf(song.arrangement[i]) === order[i]) continue;
    const from = song.arrangement.findIndex((a, k) => k > i && nameOf(a) === order[i]);
    const res = moveArrangementItem(song, song.arrangement[from].id, i);
    if (!res.ok) throw new Error(res.error.message);
    song = res.value;
  }
  const texts = [null, LYRICS.verse1, LYRICS.pre1, LYRICS.chorus1, LYRICS.verse2, LYRICS.pre2, LYRICS.chorus2, LYRICS.bridge, LYRICS.chorus3, null];
  song.arrangement.forEach((a, i) => {
    if (!texts[i]) return;
    const res = setLyrics(song, a.id, texts[i].join('\n'), { strict: true });
    if (!res.ok) throw new Error(`${nameOf(a)}(${i + 1}番目): ${res.error.message}`);
    song = res.value;
  });
  return song;
}

if (process.argv[1] && process.argv[1].endsWith('rock-yoake.mjs')) {
  try {
    const song = build();
    for (const a of song.arrangement) console.log(song.sections.find((s) => s.id === a.sectionId).name.padEnd(6), lyricLines(song, a.id).map((l) => `${l.notes}:${l.kana || '-'}`).join(' / '));
    if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ song }));
  } catch (e) {
    console.error('NG', e.message);
    process.exit(1);
  }
}
