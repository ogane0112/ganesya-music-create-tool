import { describe, expect, it } from 'vitest';
import { createAuthoredSong } from '../src/core/authoring.js';
import { addArrangementItem, addSectionCopy, createDraftSong, setItem, setSectionKey } from '../src/core/operations.js';
import { performSong } from '../src/core/performance.js';
import { buildTimeline } from '../src/core/timeline.js';
import { songToMidi } from '../src/connectors/midi/encode.js';
import { validateSong } from '../src/core/validate.js';
import { unwrap } from './helpers.js';

const base = unwrap(createDraftSong({ mood: 'rock', tempo: 150, seed: 11 }));
const chorus = base.arrangement[3];
const notesOf = (/** @type {import('../src/core/types.js').Song} */ s, /** @type {string} */ itemId, /** @type {string} */ trackId) =>
  buildTimeline(s).events.filter((e) => e.itemId === itemId && e.trackId === trackId);

describe('F2 並びの1か所ごとの消音と音量', () => {
  it('その場所のパートだけ消える。同じ部品の別の場所は鳴る', () => {
    const twice = unwrap(addArrangementItem(base, base.arrangement[3].sectionId));
    const second = twice.arrangement[4].id;
    const s = unwrap(setItem(twice, second, { mix: { t4: { muted: true } } }));
    expect(notesOf(s, second, 't4')).toHaveLength(0);
    expect(notesOf(s, chorus.id, 't4').length).toBeGreaterThan(10);
    expect(notesOf(s, second, 't3').length).toBeGreaterThan(10);
    expect(twice.arrangement[4].mix).toBeUndefined(); // 元は変わらない
  });
  it('音量はパートの音量に対する倍率になり、消音・音量は元に戻せる', () => {
    const s = unwrap(setItem(base, chorus.id, { mix: { t3: { volume: 0.3 } } }));
    const ev = notesOf(s, chorus.id, 't3')[0];
    expect(ev.gain).toBeCloseTo(0.3 / 0.75, 5);
    expect(performSong(s).notes.find((n) => n.itemId === chorus.id && n.trackId === 't3')?.gain).toBeCloseTo(0.4, 5);
    const back = unwrap(setItem(s, chorus.id, { mix: { t3: null } }));
    expect(back.arrangement[3].mix).toBeUndefined();
    expect(notesOf(back, chorus.id, 't3')[0].gain).toBeUndefined();
  });
  it('間違いは理由付きで断る', () => {
    expect(setItem(base, chorus.id, { mix: { t99: { muted: true } } }).ok).toBe(false);
    expect(setItem(base, chorus.id, { mix: { t3: { volume: 3 } } }).ok).toBe(false);
    expect(setItem(base, 'zz', {}).ok).toBe(false);
  });
});

describe('F5 部品の変化版', () => {
  it('弾き方を変えた場所だけ、指定したパートが作り直され、メロディとコードは同じ', () => {
    const twice = unwrap(addArrangementItem(base, chorus.sectionId));
    const second = twice.arrangement[4].id;
    const s = unwrap(setItem(twice, second, { styles: { drumStyle: 'four-floor' }, instruments: { t2: 'piano' } }));
    const drums = (/** @type {string} */ id) => notesOf(s, id, 't4').map((e) => [e.tick - (id === second ? buildTimeline(s).items.find((i) => i.itemId === id)?.startTick ?? 0 : 0), e.pitch]).filter(([, p]) => p === 36).length;
    expect(drums(second)).not.toBe(drums(chorus.id));
    // 変えていないパート(ベース・歌メロ)は同じ
    const rel = (/** @type {string} */ id, /** @type {string} */ t) => {
      const start = buildTimeline(s).items.find((i) => i.itemId === id)?.startTick ?? 0;
      return notesOf(s, id, t).map((e) => [e.tick - start, e.pitch]);
    };
    expect(rel(second, 't3')).toEqual(rel(chorus.id, 't3'));
    expect(rel(second, 't1')).toEqual(rel(chorus.id, 't1'));
    expect(notesOf(s, second, 't2')[0].instrument).toBe('piano');
    expect(notesOf(s, chorus.id, 't2')[0].instrument).toBeUndefined();
    // 同じ設定なら、毎回同じ結果
    expect(buildTimeline(s).events).toEqual(buildTimeline(s).events);
    expect(setItem(twice, second, { styles: { drumStyle: 'samba' } }).ok).toBe(false);
  });
});

describe('F3 つなぎの演出', () => {
  it('頭のシンバル、最後のフィル、上がっていく効果音、無音のブレイク(歌は残る)', () => {
    const pre = base.arrangement[2];
    const s = unwrap(setItem(base, pre.id, { fx: { crash: true, fill: true, riser: true, break: 2 } }));
    const tl = buildTimeline(s);
    const item = tl.items.find((i) => i.itemId === pre.id);
    if (!item) throw new Error('部品がない');
    const bar = 1920;
    const drums = tl.events.filter((e) => e.itemId === pre.id && e.trackId === 't4');
    expect(drums.some((e) => e.pitch === 49 && e.tick === item.startTick)).toBe(true);
    expect(drums.some((e) => e.pitch === 27 && e.tick === item.endTick - 2 * bar)).toBe(true);
    // 最後の2拍に、歌以外の音がない(効果音は除く)
    const from = item.endTick - 960;
    const late = tl.events.filter((e) => e.itemId === pre.id && e.tick >= from && e.trackId !== 't1' && e.pitch !== 27);
    expect(late).toHaveLength(0);
    // 歌メロは残る
    expect(tl.events.filter((e) => e.itemId === pre.id && e.trackId === 't1' && e.tick >= item.endTick - 1920).length).toBeGreaterThan(0);
    const off = unwrap(setItem(s, pre.id, { fx: null }));
    expect(off.arrangement[2].fx).toBeUndefined();
    expect(setItem(base, pre.id, { fx: { break: 20 } }).ok).toBe(false);
  });
});

describe('F1 部品ごとの転調', () => {
  const song = unwrap(createAuthoredSong({
    title: 't', mood: 'rock', tempo: 150, key: { tonic: 'B', mode: 'minor' },
    sections: [{ name: 'サビ', kind: 'chorus', bars: 2, chords: 'G:4 A:4', melody: 'B4:1 D5:1 E5:2 | C#5:2 E5:2' }],
  }));
  const sec = song.sections[0].id;

  it('部品のキーを変えると、その部品のコードと音符だけが移る', () => {
    const two = unwrap(addArrangementItem(song, sec));
    const other = unwrap(createAuthoredSong({ title: 't', mood: 'rock', tempo: 150, key: { tonic: 'B', mode: 'minor' }, sections: [
      { name: 'A', kind: 'verse', bars: 2, chords: 'Bm:8', melody: 'B3:4 | D4:4' },
      { name: 'サビ', kind: 'chorus', bars: 2, chords: 'G:4 A:4', melody: 'B4:1 D5:1 E5:2 | C#5:2 E5:2' },
    ] }));
    const up = unwrap(setSectionKey(other, other.sections[1].id, { tonic: 'C', mode: 'minor' }));
    expect(up.sections[1].key).toEqual({ tonic: 'C', mode: 'minor' });
    expect(up.sections[1].chords.map((c) => c.symbol)).toEqual(['Ab', 'Bb']); // Cマイナーは フラット系
    expect(up.sections[1].parts.t1.map((n) => n.pitch)).toEqual(other.sections[1].parts.t1.map((n) => n.pitch + 1));
    expect(up.sections[0]).toEqual(other.sections[0]); // 別の部品は変わらない
    expect(validateSong(up).ok).toBe(true);
    expect(two.arrangement).toHaveLength(2);
    // 曲のキーに戻すと、指定が外れる
    const back = unwrap(setSectionKey(up, up.sections[1].id, { tonic: 'B', mode: 'minor' }));
    expect(back.sections[1].key).toBeUndefined();
    expect(back.sections[1].parts.t1.map((n) => n.pitch)).toEqual(other.sections[1].parts.t1.map((n) => n.pitch));
    expect(setSectionKey(other, 'zz', { tonic: 'C', mode: 'minor' }).ok).toBe(false);
    expect(setSectionKey(other, other.sections[1].id, { tonic: /** @type {any} */ ('H'), mode: 'minor' }).ok).toBe(false);
  });

  it('移調して複製し、並びに入れる。元の部品はそのまま。キーの外の音にはならない', () => {
    const s = unwrap(addSectionCopy(song, sec, { semitones: 2, name: '大サビ' }));
    expect(s.sections).toHaveLength(2);
    expect(s.sections[1].name).toBe('大サビ');
    expect(s.sections[1].key).toEqual({ tonic: 'C#', mode: 'minor' });
    expect(s.sections[1].chords.map((c) => c.symbol)).toEqual(['A', 'B']);
    expect(s.sections[1].parts.t1.map((n) => n.pitch)).toEqual(song.sections[0].parts.t1.map((n) => n.pitch + 2));
    expect(s.sections[0]).toEqual(song.sections[0]);
    expect(s.arrangement.map((a) => a.sectionId)).toEqual([sec, s.sections[1].id]);
    expect(validateSong(s).ok).toBe(true);
    // 音の高さが上がっている(曲の中で転調して聞こえる)
    const tl = buildTimeline(s);
    const first = tl.events.filter((e) => e.trackId === 't1' && e.itemId === s.arrangement[0].id)[0];
    const second = tl.events.filter((e) => e.trackId === 't1' && e.itemId === s.arrangement[1].id)[0];
    expect(second.pitch - first.pitch).toBe(2);
    expect(addSectionCopy(song, sec, { semitones: 20 }).ok).toBe(false);
    // 書き出しも通る
    expect(songToMidi(s).bytes.length).toBeGreaterThan(100);
  });

  it('部品を別のキーで書ける(create_song の key)。そのキーで破綻チェックされる', () => {
    // D と F は C マイナーの音。B マイナーには F がない
    const ok = createAuthoredSong({ title: 't', mood: 'rock', tempo: 150, key: { tonic: 'B', mode: 'minor' }, sections: [
      { name: 'A', kind: 'verse', bars: 1, chords: 'Bm:4', melody: 'B3:4' },
      { name: '大サビ', kind: 'chorus', bars: 1, key: { tonic: 'C', mode: 'minor' }, chords: 'Cm:4', melody: 'D4:2 F4:2' },
    ] });
    const s = unwrap(ok);
    expect(s.sections[1].key).toEqual({ tonic: 'C', mode: 'minor' });
    const bad = createAuthoredSong({ title: 't', mood: 'rock', tempo: 150, key: { tonic: 'B', mode: 'minor' }, sections: [{ name: 'A', kind: 'verse', bars: 1, chords: 'Cm:4', melody: 'D4:2 F4:2' }] });
    expect(bad.ok).toBe(false);
  });
});
