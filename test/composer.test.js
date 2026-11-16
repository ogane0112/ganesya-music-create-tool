import { describe, expect, it } from 'vitest';
import { createDraftSong, replaceSection } from '../src/core/operations.js';
import { generateAlternatives, ALTERNATIVE_TARGETS } from '../src/core/alternatives.js';
import { MOODS } from '../src/core/catalog.js';
import { validateSong } from '../src/core/validate.js';
import { isChordInKey } from '../src/core/theory.js';
import { unwrap } from './helpers.js';

/** @param {import('../src/core/types.js').Song} s */
const content = (s) => JSON.stringify([s.key, s.sections.map((x) => [x.chords, x.parts])]);

describe('叩き台(B6)', () => {
  for (const { id: mood } of MOODS) {
    it(`${mood}: 検査を通る1コーラスができる`, () => {
      for (let seed = 1; seed <= 40; seed++) {
        const r = createDraftSong({ mood, tempo: 100, seed });
        if (!r.ok) throw new Error(`seed ${seed}: ${r.error.message}`);
        const s = r.value;
        expect(s.sections.map((x) => x.kind)).toEqual(['verse', 'prechorus', 'chorus']);
        expect(s.arrangement).toHaveLength(3);
        expect(s.mood).toBe(mood);
        for (const sec of s.sections) {
          for (const c of sec.chords) expect(isChordInKey(c.symbol, s.key)).toBe(true);
          expect(sec.parts.t1.length).toBeGreaterThan(8); // メロディがある
          expect(sec.parts.t3.length).toBeGreaterThan(0); // ベース
          expect(sec.parts.t4.length).toBeGreaterThan(0); // ドラム
        }
      }
    });
  }

  it('毎回違う結果になる', () => {
    const a = unwrap(createDraftSong({ mood: 'setsunai', tempo: 90 }));
    const b = unwrap(createDraftSong({ mood: 'setsunai', tempo: 90 }));
    expect(content(a)).not.toEqual(content(b));
  });

  it('同じ種なら同じ結果', () => {
    const a = unwrap(createDraftSong({ mood: 'dark', tempo: 90, seed: 7, now: 'x' }));
    const b = unwrap(createDraftSong({ mood: 'dark', tempo: 90, seed: 7, now: 'x' }));
    expect(a).toEqual(b);
  });

  it('テンポと曲名が入る', () => {
    const s = unwrap(createDraftSong({ mood: 'akarui', tempo: 150, title: ' 夏の終わり ' }));
    expect(s.tempo).toBe(150);
    expect(s.meta.title).toBe('夏の終わり');
  });

  it('知らない雰囲気や範囲外のテンポは拒否', () => {
    expect(createDraftSong({ mood: /** @type {any} */ ('happy'), tempo: 100 }).ok).toBe(false);
    expect(createDraftSong({ mood: 'akarui', tempo: 999 }).ok).toBe(false);
  });

  it('メロディは歌える音域に収まる', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = unwrap(createDraftSong({ mood: 'shissou', tempo: 150, seed }));
      const pitches = s.sections.flatMap((x) => x.parts.t1.map((n) => n.pitch));
      expect(Math.min(...pitches)).toBeGreaterThanOrEqual(52);
      expect(Math.max(...pitches)).toBeLessThanOrEqual(84);
    }
  });
});

describe('別案(B7)', () => {
  const song = unwrap(createDraftSong({ mood: 'setsunai', tempo: 96, seed: 3 }));

  for (const { id: target } of ALTERNATIVE_TARGETS) {
    it(`${target}: 互いに違う3案が返り、どれも差し替えられる`, () => {
      for (const sec of song.sections) {
        const alts = unwrap(generateAlternatives(song, sec.id, target, { seed: 11 }));
        expect(alts).toHaveLength(3);
        const sigs = alts.map((a) => JSON.stringify(a.replacement));
        expect(new Set(sigs).size).toBe(3);
        for (const a of alts) {
          const next = unwrap(replaceSection(song, sec.id, a.replacement));
          expect(validateSong(next).ok).toBe(true);
          expect(content(next)).not.toEqual(content(song));
        }
      }
    });
  }

  it('メロディの別案ではコード進行と伴奏は変わらない', () => {
    const sec = song.sections[0];
    const [alt] = unwrap(generateAlternatives(song, sec.id, 'melody'));
    expect(alt.replacement.chords).toBeUndefined();
    expect(Object.keys(alt.replacement.parts)).toEqual(['t1']);
  });

  it('伴奏の別案ではメロディとコード進行は変わらない', () => {
    const sec = song.sections[1];
    const [alt] = unwrap(generateAlternatives(song, sec.id, 'accompaniment'));
    expect(alt.replacement.chords).toBeUndefined();
    expect(Object.keys(alt.replacement.parts)).not.toContain('t1');
  });

  it('コード進行の別案ではメロディは変わらない', () => {
    const sec = song.sections[2];
    const [alt] = unwrap(generateAlternatives(song, sec.id, 'chords'));
    expect(alt.replacement.chords).toBeDefined();
    expect(Object.keys(alt.replacement.parts)).not.toContain('t1');
  });

  it('ない部品は not_found', () => {
    const r = generateAlternatives(song, 'nope', 'all');
    expect(!r.ok && r.error.code).toBe('not_found');
  });

  it('雰囲気のない曲(取り込み)でも作れる', () => {
    const s2 = { ...song, mood: null };
    expect(generateAlternatives(s2, song.sections[0].id, 'all').ok).toBe(true);
  });
});
