// 音のデータ(-1〜1の数の並び)を WAV ファイル(16ビット)のバイト列にする。ブラウザにもNodeにも依存しない。

/**
 * @param {Float32Array[]} channels チャンネルごとのデータ(長さは同じ)
 * @param {number} sampleRate
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function encodeWav(channels, sampleRate) {
  const numCh = channels.length;
  const frames = numCh ? channels[0].length : 0;
  const bytesPerSample = 2;
  const dataSize = frames * numCh * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  /** @param {number} o @param {string} s */
  const str = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt の大きさ
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * numCh * bytesPerSample, true);
  v.setUint16(32, numCh * bytesPerSample, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const x = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, x < 0 ? Math.round(x * 0x8000) : Math.round(x * 0x7fff), true);
      o += 2;
    }
  }
  return new Uint8Array(buf);
}
