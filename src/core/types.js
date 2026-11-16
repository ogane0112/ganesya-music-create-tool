// 曲データと接続口の型定義(JSDoc)。実行時の中身は持たず、型だけを書く。
// 設計は docs/02-song-data-design.md と docs/03-connector-design.md を正とする。

/** 1拍のティック数。MIDIと同じ数え方にする */
export const TICKS_PER_BEAT = 480;

/** 曲データの形式の版番号 */
export const FORMAT_VERSION = 1;

/** @typedef {'C'|'C#'|'Db'|'D'|'D#'|'Eb'|'E'|'F'|'F#'|'Gb'|'G'|'G#'|'Ab'|'A'|'A#'|'Bb'|'B'} Tonic */

/** @typedef {'major'|'minor'} Mode */

/**
 * キー(曲の音の高さの基準)
 * @typedef {object} Key
 * @property {Tonic} tonic 基準の音
 * @property {Mode} mode 明るい(major)か暗い(minor)か
 */

/** @typedef {'setsunai'|'shissou'|'dark'|'akarui'|'wafu-edm'} Mood 雰囲気(切ない、疾走感、ダーク・不穏、明るい・爽やか、和風EDM) */

/**
 * 楽器11種(10種+EDM用のスーパーソー)
 * @typedef {'piano'|'acoustic-guitar'|'electric-guitar-clean'|'electric-guitar-distortion'|'bass'|'drums'|'strings'|'synth-lead'|'synth-pad'|'bell'|'supersaw'} InstrumentId
 */

/**
 * パートの役割。vocal は歌メロ(P1では楽器で鳴らす)
 * @typedef {'vocal'|'chords'|'bass'|'drums'|'pad'|'lead'|'other'} TrackRole
 */

/**
 * パート
 * @typedef {object} Track
 * @property {string} id
 * @property {TrackRole} role
 * @property {InstrumentId} instrument
 * @property {number} volume 0〜1
 * @property {boolean} [muted] 消音
 * @property {boolean} [sidechain] バスドラムに合わせて音量をへこませる(EDMのうねり)
 * @property {string} [name] 表示名
 */

/**
 * 音符。start は部品の先頭からのティック
 * @typedef {object} Note
 * @property {string} id
 * @property {number} start
 * @property {number} length
 * @property {number} pitch MIDIの音番号(0〜127)。ドラムでは打楽器の種類
 * @property {number} velocity 強さ(1〜127)
 */

/**
 * コード(和音)。start は部品の先頭からのティック
 * @typedef {object} Chord
 * @property {number} start
 * @property {number} length
 * @property {string} symbol 例: "Am", "Fmaj7", "G/B"
 */

/** @typedef {'intro'|'verse'|'prechorus'|'chorus'|'bridge'|'outro'|'other'} SectionKind */

/**
 * 部品(Aメロ・サビなど)の定義
 * @typedef {object} Section
 * @property {string} id
 * @property {string} name
 * @property {SectionKind} kind
 * @property {number} bars 小節数
 * @property {Key} [key] 部品ごとのキーの上書き(P1では使わない)
 * @property {Chord[]} chords
 * @property {Record<string, Note[]>} parts トラックIDごとの音符
 */

/**
 * 歌詞の1文字(P2)
 * @typedef {object} LyricSyllable
 * @property {string} noteId
 * @property {string} kana
 */

/**
 * 並び順の1か所
 * @typedef {object} ArrangementItem
 * @property {string} id
 * @property {string} sectionId
 * @property {LyricSyllable[]} lyrics
 */

/**
 * @typedef {object} SongMeta
 * @property {string} title
 * @property {string} artist
 * @property {string} createdAt ISO 8601
 * @property {string} updatedAt ISO 8601
 */

/**
 * 曲データ(1曲=1つのJSON)
 * @typedef {object} Song
 * @property {number} formatVersion
 * @property {number} revision
 * @property {SongMeta} meta
 * @property {number} tempo 1分あたりの拍数
 * @property {Key} key
 * @property {[number, number]} timeSignature
 * @property {Mood | null} mood
 * @property {Track[]} tracks
 * @property {Section[]} sections
 * @property {ArrangementItem[]} arrangement
 * @property {Record<string, unknown>} extensions
 */

// ---- 失敗と結果 ----

/**
 * 失敗の共通形式。画面は何が起きたか(message)とどうすればよいか(hint)を必ず出す
 * @typedef {object} AppError
 * @property {string} code 例: "invalid_song", "revision_conflict"
 * @property {string} message
 * @property {string} hint
 * @property {unknown} [details]
 */

/**
 * 操作の結果
 * @template T
 * @typedef {{ ok: true, value: T, warnings: string[] } | { ok: false, error: AppError }} Result
 */

// ---- 接続口 ----

/**
 * @typedef {{ ok: true } | { ok: false, reason: string }} Availability
 */

/**
 * @typedef {object} ExportedFile
 * @property {string} name
 * @property {string} type MIMEタイプ
 * @property {Uint8Array<ArrayBuffer>} bytes
 */

/**
 * 取り込み接続口(外部ファイル→曲データ)
 * @typedef {object} ImportConnector
 * @property {string} id
 * @property {string} name
 * @property {'import'} kind
 * @property {string[]} accept 受け付けるファイルの拡張子
 * @property {() => Promise<Availability>} isAvailable
 * @property {(file: { name: string, bytes: Uint8Array }) => Promise<Result<Song>>} run
 */

/**
 * 書き出し接続口(曲データ→外部ファイル)
 * @typedef {object} ExportConnector
 * @property {string} id
 * @property {string} name
 * @property {'export'} kind
 * @property {() => Promise<Availability>} isAvailable
 * @property {(song: Song) => Promise<Result<ExportedFile>>} run
 */

/**
 * エンジン接続口(曲データの一部を渡して結果を受け取る)
 * @typedef {object} EngineConnector
 * @property {string} id
 * @property {string} name
 * @property {'engine'} kind
 * @property {() => Promise<Availability>} isAvailable
 * @property {(song: Song, range: { arrangementItemIds: string[] }) => Promise<Result<unknown>>} run
 */

/** @typedef {ImportConnector | ExportConnector | EngineConnector} Connector */

export {};
