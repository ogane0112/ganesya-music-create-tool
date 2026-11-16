// 「元に戻す」の履歴。メモリ上だけに持ち、アプリを閉じたら消える。
// 曲データは操作のたびに新しいものが作られる(書き換えない)ので、そのまま積んでおける。
// 注意: 戻した曲の revision は古いことがある。保存する側はサーバーの最新の revision を付けて送ること。

/** @typedef {import('./types.js').Song} Song */

export class History {
  /** @param {Song} initial */
  constructor(initial) {
    /** @type {{ song: Song, label: string }[]} 戻り先と、それを取り消す操作の名前 */
    this.past = [];
    /** @type {Song} */
    this.current = initial;
  }

  /**
   * 操作の結果を今の曲にする
   * @param {Song} song
   * @param {string} [label] 何をしたか(画面の「元に戻す」に添える)
   */
  push(song, label = '') {
    if (song === this.current) return;
    this.past.push({ song: this.current, label });
    this.current = song;
  }

  get canUndo() {
    return this.past.length > 0;
  }

  /** 次に戻した時に取り消される操作の名前 */
  get undoLabel() {
    return this.past.at(-1)?.label ?? '';
  }

  /**
   * 直前の操作を取り消し、戻った後の曲を返す。戻せなければ null
   * @returns {Song | null}
   */
  undo() {
    const prev = this.past.pop();
    if (!prev) return null;
    this.current = prev.song;
    return prev.song;
  }

  /**
   * 保存でサーバーから revision が変わって返ってきた時など、今の曲だけを差し替える(履歴は残す)
   * @param {Song} song
   */
  replaceCurrent(song) {
    this.current = song;
  }

  /**
   * 履歴を消して、この曲から始め直す(最新を読み込んだ時など)
   * @param {Song} song
   */
  reset(song) {
    this.past = [];
    this.current = song;
  }
}
