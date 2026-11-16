import { describe, expect, it } from 'vitest';
import { encodeWav } from '../src/audio/wav-encode.js';

describe('WAVの形', () => {
  it('ヘッダとデータ', () => {
    const l = new Float32Array([0, 1, -1, 0.5]);
    const r = new Float32Array([0, -1, 1, 2]);
    const bytes = encodeWav([l, r], 44100);
    const v = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(40, true)).toBe(4 * 2 * 2);
    expect(bytes.length).toBe(44 + 16);
    expect(v.getInt16(44 + 2, true)).toBe(0); // 右 0
    expect(v.getInt16(44 + 4, true)).toBe(32767); // 左 1
    expect(v.getInt16(44 + 6, true)).toBe(-32768); // 右 -1
    expect(v.getInt16(44 + 14, true)).toBe(32767); // はみ出しは切る
  });
});
