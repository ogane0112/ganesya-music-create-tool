// 部品の中身を小さな絵にする。メロディの上がり下がりが一目で分かり、別案どうしの違いも目で比べられる。
import { ticksPerBar } from '../core/theory.js';
import { svg } from './dom.js';

/** @typedef {import('../core/types.js').Song} Song */
/** @typedef {import('../core/types.js').Section} Section */

const W = 200;
const H = 48;

/**
 * @param {Song} song
 * @param {Section} section
 * @returns {SVGElement}
 */
export function sectionThumb(song, section) {
  const total = section.bars * ticksPerBar(song.timeSignature);
  /** @param {import('../core/types.js').TrackRole} role */
  const notesOf = (role) => song.tracks.filter((t) => t.role === role).flatMap((t) => section.parts[t.id] ?? []);
  const melody = notesOf('vocal');
  const color = notesOf('other');
  const lead = notesOf('lead');
  const bass = notesOf('bass');
  const kicks = notesOf('drums').filter((n) => n.pitch === 35 || n.pitch === 36);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'thumb', 'aria-hidden': 'true' });
  /** @param {number} t */
  const x = (t) => (t / total) * W;

  // 上の段:メロディと合いの手。高さは音の高さ
  const upper = [...melody, ...color, ...lead];
  if (upper.length) {
    const lo = Math.min(...upper.map((n) => n.pitch));
    const hi = Math.max(...upper.map((n) => n.pitch));
    /** @param {number} p */
    const y = (p) => 3 + (1 - (p - lo) / Math.max(1, hi - lo)) * 26;
    for (const [notes, cls] of /** @type {const} */ ([[lead, 'thumb-sub'], [color, 'thumb-sub'], [melody, 'thumb-melody']])) {
      for (const n of notes) {
        root.append(svg('rect', { x: x(n.start), y: y(n.pitch), width: Math.max(1.2, x(n.length) - 0.6), height: 3, rx: 1, class: cls }));
      }
    }
  }
  // 下の段:ベースの動きとバスドラムの位置(リズムの違いが見える)
  if (bass.length) {
    const lo = Math.min(...bass.map((n) => n.pitch));
    const hi = Math.max(...bass.map((n) => n.pitch));
    for (const n of bass) {
      const y = 36 + (1 - (n.pitch - lo) / Math.max(1, hi - lo)) * 5;
      root.append(svg('rect', { x: x(n.start), y, width: Math.max(1, x(n.length) - 0.6), height: 2, class: 'thumb-bass' }));
    }
  }
  for (const n of kicks) root.append(svg('rect', { x: x(n.start), y: 44.5, width: 1.6, height: 3, class: 'thumb-kick' }));
  return root;
}
