// 伴奏の弾き方として選べる名前(検査・曲の書き方・手引きで共有する)
import { DRUM_PATTERNS } from './composer/drums.js';

export const STYLE_NAMES = {
  chordStyle: ['arpeggio', 'strum', 'palm', 'power', 'syncopated', 'quarter', 'sustain', 'pluck16', 'offbeat-stab', 'pump'],
  bassStyle: ['whole', 'half', 'eighth', 'octave', 'syncopated', 'offbeat', 'rolling'],
  drumStyle: Object.keys(DRUM_PATTERNS),
  leadStyle: ['riff', 'arp', 'none'],
};
