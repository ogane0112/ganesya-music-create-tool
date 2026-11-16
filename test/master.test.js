import { describe, expect, it } from 'vitest';
import { CEILING, limit, master, measureLufs } from '../src/audio/master.js';

const SR = 44100;
/** @param {number} amp @param {number} seconds @param {number} [hz] */
const sine = (amp, seconds, hz = 997) => Float32Array.from({ length: SR * seconds }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
/** @param {Float32Array[]} ch */
const peakOf = (ch) => Math.max(...ch.map((c) => c.reduce((m, x) => Math.max(m, Math.abs(x)), 0)));

describe('仕上げ', () => {
  it('大きさ(LUFS)を規格どおりに測る:両チャンネルに最大の1kHzの波 = 約0 LUFS', () => {
    expect(measureLufs([sine(1, 3), sine(1, 3)], SR)).toBeCloseTo(0, 0);
    expect(measureLufs([sine(0.1, 3), sine(0.1, 3)], SR)).toBeCloseTo(-20, 0);
    expect(measureLufs([sine(1, 3), new Float32Array(SR * 3)], SR)).toBeCloseTo(-3, 0);
    expect(measureLufs([new Float32Array(SR), new Float32Array(SR)], SR)).toBe(-Infinity);
  });
  it('長い無音が混ざっても、音のある所だけで測る', () => {
    const withSilence = new Float32Array(SR * 6);
    withSilence.set(sine(0.1, 3));
    expect(measureLufs([withSilence, withSilence], SR)).toBeCloseTo(-20, 0);
  });
  it('天井を超えない', () => {
    const ch = [sine(1.5, 1), sine(0.5, 1)];
    limit(ch, SR);
    expect(peakOf(ch)).toBeLessThanOrEqual(CEILING + 1e-4);
  });
  it('小さい曲も大きい曲も -14 LUFS にそろい、-1 dB を超えない', () => {
    for (const amp of [0.02, 0.9]) {
      // 打楽器のように尖った音を混ぜる
      const l = sine(amp, 4);
      for (let i = 0; i < l.length; i += SR / 2) l[i] += amp * 3;
      const ch = [l, Float32Array.from(l)];
      const { after } = master(ch, SR);
      expect(after).toBeGreaterThan(-14.6);
      expect(after).toBeLessThan(-13.4);
      expect(peakOf(ch)).toBeLessThanOrEqual(CEILING + 1e-4);
    }
  });
});
