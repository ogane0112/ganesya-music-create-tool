// 接続口の登録簿。接続口を足す時は、1ファイル作ってここに1行足す。本体は中身を知らず、一覧に出すだけ。
import { midiExport } from './midi-export.js';
import { wavExport } from './wav-export.js';

/** @type {import('../core/types.js').Connector[]} */
const connectors = [wavExport, midiExport];

/** @param {import('../core/types.js').Connector['kind']} [kind] */
export function listConnectors(kind) {
  return kind ? connectors.filter((c) => c.kind === kind) : [...connectors];
}

/** @returns {import('../core/types.js').ExportConnector[]} */
export function exportConnectors() {
  return /** @type {import('../core/types.js').ExportConnector[]} */ (listConnectors('export'));
}
