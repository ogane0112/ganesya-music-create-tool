// 編曲の起伏を付ける。同じ調子が続いて眠くならないように、部品の中と部品の間で変化を作る。
// - 彩り:メロディが休む所に短い駆け上がり・駆け下り、サビでは高い所で対旋律
// - Aメロ前半は静かに、後半から本調子
// - Bメロ:頭でシンバル、終わり2小節で「シューッ」と上がる効果音、最後の1拍は全員止まって溜める(ブレイク)
// - サビ:後半はハイハットを細かく、EDMでは手拍子を重ねる
// - ドラムに小さな音(ゴースト)と開いたハイハットで揺れを足す
import { chordPitchClasses, mod12, pentatonicPitchesInRange, scalePitchesInRange, ticksPerBar } from '../theory.js';
import { DRUM } from './drums.js';
import { chordAt } from './progressions.js';

/** @typedef {import('../types.js').Key} Key */
/** @typedef {import('../types.js').Chord} Chord */
/** @typedef {import('../random.js').Rng} Rng */
/** @typedef {Omit<import('../types.js').Note, 'id'>} NoteData */

const S = 120;
const BEAT = 480;

/**
 * @typedef {object} ColorOptions
 * @property {Key} key
 * @property {Chord[]} chords
 * @property {NoteData[]} melody
 * @property {'verse' | 'prechorus' | 'chorus'} kind
 * @property {boolean} isIntro
 * @property {number} bars
 * @property {[number, number]} timeSignature
 * @property {boolean} pentatonic
 * @property {Rng} rng
 */

/**
 * 彩りのパート
 * @param {ColorOptions} o
 * @returns {NoteData[]}
 */
export function generateColor(o) {
  if (o.isIntro) return [];
  const scale = o.pentatonic ? pentatonicPitchesInRange(o.key, 72, 96) : scalePitchesInRange(o.key, 72, 96);
  if (o.kind === 'chorus') return counterLine(o);
  return fills(o, scale);
}

/**
 * メロディが2拍以上休む所に、短いフレーズを入れる
 * @param {ColorOptions} o
 * @param {number[]} scale
 */
function fills(o, scale) {
  const total = o.bars * ticksPerBar(o.timeSignature);
  const mel = [...o.melody].sort((a, b) => a.start - b.start);
  /** @type {[number, number][]} */
  const gaps = [];
  let cursor = 0;
  for (const n of mel) {
    if (n.start - cursor >= 2 * BEAT) gaps.push([cursor, n.start]);
    cursor = Math.max(cursor, n.start + n.length);
  }
  if (total - cursor >= 2 * BEAT) gaps.push([cursor, total]);

  /** @type {NoteData[]} */
  const out = [];
  for (const [from, to] of gaps) {
    if (!o.rng.chance(0.75)) continue;
    const step = o.rng.chance(0.6) ? S : 2 * S;
    // 休みの頭から少し空けて始め、次の歌の直前で終える
    const start = Math.ceil((from + S) / (2 * S)) * (2 * S);
    const count = Math.min(o.rng.int(4, 7), Math.floor((to - 60 - start) / step));
    if (count < 3) continue;
    const chord = chordAt(o.chords, start);
    const tones = chord ? chordPitchClasses(chord.symbol) : [];
    // 和音の音から始める
    let idx = scale.findIndex((p) => p >= 80 && (!tones.length || tones.includes(mod12(p))));
    if (idx < 0) idx = Math.floor(scale.length / 2);
    const dir = o.rng.chance(0.55) ? -1 : 1;
    for (let i = 0; i < count; i++) {
      const p = scale[Math.max(0, Math.min(scale.length - 1, idx + dir * i))];
      out.push({ start: start + i * step, length: step - 15, pitch: p, velocity: 78 - i * 2 + o.rng.int(-4, 4) });
    }
  }
  return out;
}

/**
 * サビの対旋律:高い所で和音の音を2拍ずつ、なるべく近い音へつないでいく
 * @param {ColorOptions} o
 */
function counterLine(o) {
  const total = o.bars * ticksPerBar(o.timeSignature);
  /** @type {NoteData[]} */
  const out = [];
  let prev = 84;
  for (let t = 0; t < total; t += 2 * BEAT) {
    const chord = chordAt(o.chords, t);
    if (!chord) continue;
    const pcs = chordPitchClasses(chord.symbol);
    /** @type {number[]} */
    const cands = [];
    for (let p = 76; p <= 91; p++) if (pcs.includes(mod12(p))) cands.push(p);
    if (!cands.length) continue;
    // 前の音から一番近い和音の音(同じ音が続きすぎないよう、ときどき隣へ)
    cands.sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev));
    const pick = cands[o.rng.chance(0.3) && cands.length > 1 ? 1 : 0];
    out.push({ start: t, length: 2 * BEAT - 30, pitch: pick, velocity: 70 + o.rng.int(-5, 5) });
    prev = pick;
  }
  return out;
}

/**
 * @typedef {object} EnergyOptions
 * @property {Record<string, NoteData[]>} parts 書き換える(この部品で作ったパートだけ)
 * @property {{ melody?: string, drums?: string, chords?: string }} roles
 * @property {'verse' | 'prechorus' | 'chorus'} kind
 * @property {boolean} isIntro
 * @property {string} drumStyle
 * @property {number} bars
 * @property {[number, number]} timeSignature
 * @property {Rng} rng
 */

/** @param {EnergyOptions} o */
export function applyEnergy(o) {
  const barTicks = ticksPerBar(o.timeSignature);
  const end = o.bars * barTicks;
  const edm = o.drumStyle === 'edm' || o.drumStyle === 'four-floor';
  const drums = o.roles.drums ? o.parts[o.roles.drums] : undefined;

  if (drums) {
    // 揺れ:小さなスネアと開いたハイハット(四つ打ちとおかずの小節は除く)
    if (!edm && !o.isIntro) {
      for (let bar = 0; bar < o.bars - 1; bar++) {
        const b = bar * barTicks;
        for (const slot of [7, 10, 15]) {
          if (o.rng.chance(0.3)) drums.push({ start: b + slot * S, length: 60, pitch: DRUM.snare, velocity: o.rng.int(30, 42) });
        }
        if (bar % 2 === 1) {
          const at = b + 14 * S;
          const i = drums.findIndex((n) => n.pitch === DRUM.closedHat && n.start === at);
          if (i >= 0) drums.splice(i, 1);
          drums.push({ start: at, length: 200, pitch: DRUM.openHat, velocity: 80 });
        }
      }
    }
    if (o.kind === 'verse' && !o.isIntro) {
      // Aメロ前半は静かに:スネアを縁打ちに、開いたハイハットは抜く
      const half = Math.floor(o.bars / 2) * barTicks;
      for (let i = drums.length - 1; i >= 0; i--) {
        const n = drums[i];
        if (n.start >= half) continue;
        if (n.pitch === DRUM.openHat) drums.splice(i, 1);
        else if (n.pitch === DRUM.snare) drums[i] = { ...n, pitch: DRUM.sideStick, velocity: Math.min(n.velocity, 80) };
      }
    }
    if (o.kind === 'prechorus') {
      drums.push({ start: 0, length: 1440, pitch: DRUM.crash, velocity: 88 });
      // 終わり2小節で上がっていく効果音
      drums.push({ start: end - 2 * barTicks, length: 2 * barTicks, pitch: DRUM.riser, velocity: edm ? 110 : 80 });
    }
    if (o.kind === 'chorus' && !o.isIntro) {
      // 後半はハイハットを細かく
      if (o.drumStyle !== 'sixteen' && o.drumStyle !== 'edm') {
        for (let t = Math.floor(o.bars / 2) * barTicks; t < end - barTicks; t += S) {
          if (t % (2 * S) === 0) continue;
          drums.push({ start: t, length: 60, pitch: DRUM.closedHat, velocity: o.rng.int(40, 55) });
        }
      }
      if (edm) {
        for (let t = BEAT; t < end; t += 2 * BEAT) drums.push({ start: t, length: 200, pitch: DRUM.clap, velocity: 100 });
      }
    }
  }

  // Bメロ最後の1拍は全員止まって溜める(歌と、EDMの盛り上げのスネア・効果音は残す)
  if (o.kind === 'prechorus') {
    const cut = end - BEAT;
    for (const [tid, notes] of Object.entries(o.parts)) {
      if (tid === o.roles.melody) continue;
      const isDrums = tid === o.roles.drums;
      o.parts[tid] = notes
        .filter((n) => n.start < cut || (isDrums && (n.pitch === DRUM.riser || (edm && n.pitch === DRUM.snare))))
        .map((n) => (!isDrums && n.start + n.length > cut ? { ...n, length: Math.max(60, cut - n.start) } : n));
    }
    // 止まる直前に全員で「ジャン」
    const d = o.roles.drums ? o.parts[o.roles.drums] : undefined;
    if (d && !edm) {
      d.push({ start: cut - BEAT, length: 240, pitch: DRUM.kick, velocity: 115 });
      d.push({ start: cut - BEAT, length: 200, pitch: DRUM.snare, velocity: 115 });
    }
  }

  if (o.roles.drums && o.parts[o.roles.drums]) o.parts[o.roles.drums] = o.parts[o.roles.drums].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}
