// 画面本体。「聴いて選ぶ」を中心に組み立てる。
// - 曲は横に並んだ部品の帯で見せ、メロディの形を絵で出す。再生位置は線で動く
// - 再生ボタンは画面の下に固定
// - 操作は選んだ部品にだけ出す
// - 別案はカードをタップした瞬間に鳴り、下の「これに決める」で確定
// 保存はまだこの端末の中だけ(サーバー保存はスプリント4)。
import { generateAlternatives, ALTERNATIVE_TARGETS } from '../core/alternatives.js';
import { INSTRUMENTS, MOODS, TEMPO_PRESETS } from '../core/catalog.js';
import { History } from '../core/history.js';
import {
  addArrangementItem, createDraftSong, moveArrangementItem, removeArrangementItem, replaceSection, updateSongSettings,
} from '../core/operations.js';
import { buildTimeline } from '../core/timeline.js';
import { ticksToSeconds } from '../core/theory.js';
import { validateSong } from '../core/validate.js';
import { prepareSong } from '../audio/note-cache.js';
import { renderSongToWav } from '../audio/offline.js';
import { Player } from '../audio/player.js';
import { h, replace } from './dom.js';
import { sectionThumb } from './thumb.js';

/** @typedef {import('../core/types.js').Song} Song */
/** @typedef {import('../core/types.js').Mood} Mood */
/** @typedef {import('../core/types.js').AppError} AppError */
/** @typedef {import('../core/alternatives.js').AlternativeTarget} AlternativeTarget */

const STORAGE_KEY = 'ganesya.prototype.song';

/** 雰囲気の見せ方 */
const MOOD_CARDS = /** @type {Record<Mood, { icon: string, text: string }>} */ ({
  setsunai: { icon: '🌙', text: '胸がきゅっとなる、しっとりした曲' },
  shissou: { icon: '⚡', text: '前のめりに駆け抜けるロック' },
  dark: { icon: '🕯️', text: '低く重く、影のある雰囲気' },
  akarui: { icon: '☀️', text: '晴れた日のような軽やかなポップス' },
  'wafu-edm': { icon: '🏮', text: '和風の節回し × 踊れるビート' },
});

const TEMPO_CHOICES = /** @type {const} */ ([
  { id: 'slow', label: 'ゆっくり', tempo: TEMPO_PRESETS.slow },
  { id: 'normal', label: 'ふつう', tempo: TEMPO_PRESETS.normal },
  { id: 'fast', label: 'はやい', tempo: TEMPO_PRESETS.fast },
]);

const ROLE_ICONS = /** @type {Record<string, string>} */ ({ vocal: '🎤', chords: '🎹', bass: '🎸', drums: '🥁', pad: '☁️', lead: '🎛️', other: '✨' });

/**
 * @typedef {object} Candidate
 * @property {string} key
 * @property {string} label
 * @property {Song} song その案に差し替えた曲
 */

/** @param {HTMLElement} root */
export function mountApp(root) {
  const player = new Player();
  /** @type {History | null} */
  let history = null;
  let creating = false; // 曲があっても新規作成の画面を出す
  /** @type {string | null} */
  let selectedId = null;
  let loop = false;
  /** @type {'whole' | 'section' | 'audition' | null} 何を鳴らしているか */
  let mode = null;
  /** @type {{ itemId: string, target: AlternativeTarget, candidates: Candidate[], chosen: string } | null} */
  let alt = null;
  /** @type {{ message: string, action?: { label: string, run: () => void }, error?: boolean } | null} */
  let toast = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let toastTimer = null;
  let menuOpen = false;
  let sheetEntering = false; // 別案のパネルを開いた最初の1回だけ動きを付ける
  /** @type {string | null} WAVを作っている途中の表示 */
  let wavStatus = null;
  const draft = { title: '', mood: /** @type {Mood} */ ('wafu-edm'), tempo: /** @type {'slow' | 'normal' | 'fast'} */ ('normal') };

  const saved = loadSaved();
  if (saved) {
    history = new History(saved);
    selectedId = saved.arrangement[0]?.id ?? null;
  }

  // ---- 再生の表示(作り直さずに、その場で書き換える) ----
  player.subscribe((s) => {
    if (!s.playing && !s.preparing && mode) {
      mode = null;
      if (alt) render(); // 聴き比べのカードの表示を戻す
    }
    for (const el of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('.block'))) {
      const on = s.playing && mode !== 'audition' && el.dataset.item === s.itemId;
      el.classList.toggle('is-playing', on);
      const head = /** @type {HTMLElement | null} */ (el.querySelector('.playhead'));
      if (head) head.style.left = on ? `${(s.itemProgress ?? 0) * 100}%` : '0%';
    }
    const btn = root.querySelector('[data-role="play"]');
    if (btn) {
      const active = s.playing && mode !== 'audition';
      btn.textContent = s.preparing ? '…' : active ? '■' : '▶';
      btn.setAttribute('aria-label', s.preparing ? '準備中' : active ? '止める' : 'はじめから聴く');
      btn.classList.toggle('is-active', active);
    }
    const section = root.querySelector('[data-role="play-section"]');
    if (section) section.textContent = s.playing && mode === 'section' ? '■ 止める' : '▶ ここだけ聴く';
    const time = root.querySelector('[data-role="time"]');
    if (time && history) time.textContent = timeLabel(history.current, s);
  });

  /**
   * @param {Song} song
   * @param {import('../audio/player.js').PlayerState} s
   */
  function timeLabel(song, s) {
    const tl = buildTimeline(song);
    const total = ticksToSeconds(tl.totalTicks, song.tempo);
    let now = 0;
    if (s.playing && mode !== 'audition' && s.itemId) {
      const item = tl.items.find((i) => i.itemId === s.itemId);
      if (item) now = ticksToSeconds(item.startTick + (item.endTick - item.startTick) * (s.itemProgress ?? 0), song.tempo);
    }
    const status = s.preparing ? '音を用意しています…' : s.playing && mode === 'section' ? 'ここだけ再生中' : '';
    return `${clock(now)} / ${clock(total)}${status ? `  ${status}` : ''}`;
  }

  // ---- 状態の変更 ----
  /**
   * 操作の結果を反映する
   * @param {import('../core/types.js').Result<Song>} r
   * @param {{ label: string, message?: string, keepPlaying?: boolean }} o
   */
  function apply(r, o) {
    if (!r.ok) {
      showError(r.error);
      return false;
    }
    if (!history) history = new History(r.value);
    else history.push(r.value, o.label);
    if (!r.value.arrangement.some((a) => a.id === selectedId)) selectedId = r.value.arrangement[0]?.id ?? null;
    persist();
    if (o.keepPlaying) player.update(r.value);
    else stop();
    if (o.message) showToast(o.message, { label: '元に戻す', run: undo });
    render();
    return true;
  }

  function undo() {
    if (!history) return;
    const label = history.undoLabel;
    const prev = history.undo();
    if (!prev) return;
    if (!prev.arrangement.some((a) => a.id === selectedId)) selectedId = prev.arrangement[0]?.id ?? null;
    stop();
    persist();
    showToast(label ? `「${label}」を取り消しました` : '元に戻しました');
    render();
  }

  /**
   * @param {string} message
   * @param {{ label: string, run: () => void }} [action]
   * @param {boolean} [error]
   */
  function showToast(message, action, error = false) {
    toast = { message, action, error };
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast = null;
      root.querySelector('.toast')?.remove();
    }, error ? 9000 : 6000);
  }

  /** @param {AppError} e */
  function showError(e) {
    showToast(`${e.message}。${e.hint}`, undefined, true);
    render();
  }

  function persist() {
    try {
      if (history) localStorage.setItem(STORAGE_KEY, JSON.stringify(history.current));
    } catch {
      // 保存できなくても続ける(試作)
    }
  }

  // ---- 再生 ----
  function stop() {
    mode = null;
    player.stop();
  }

  /** @param {string} [fromItemId] ここから最後まで */
  async function playWhole(fromItemId) {
    if (!history) return;
    const song = history.current;
    const i = fromItemId ? song.arrangement.findIndex((a) => a.id === fromItemId) : 0;
    const itemIds = i > 0 ? song.arrangement.slice(i).map((a) => a.id) : undefined;
    mode = 'whole';
    await player.play(song, { itemIds, loop: loop && !itemIds });
    mode = player.playing ? 'whole' : null;
  }

  /** @param {string} itemId */
  async function playSection(itemId) {
    if (!history) return;
    mode = 'section';
    await player.play(history.current, { itemIds: [itemId], loop: true });
    mode = player.playing ? 'section' : null;
  }

  // ---- 画面 ----
  function render() {
    const scroll = root.querySelector('.timeline')?.scrollLeft ?? 0;
    const editing = history && !creating;
    replace(root,
      editing && history ? editorView(history) : createView(),
      alt && history ? alternativesSheet(history.current, alt) : null,
      toast ? toastView(toast) : null,
    );
    const tl = root.querySelector('.timeline');
    if (tl) tl.scrollLeft = scroll;
    document.body.classList.toggle('has-sheet', !!alt);
    player.emit();
  }

  // ---- 新しい曲 ----
  function createView() {
    return h('main', { class: 'create' },
      h('header', { class: 'create-head' },
        h('h1', null, 'どんな曲にする?'),
        h('p', { class: 'muted' }, '雰囲気を選ぶと、Aメロ・Bメロ・サビの叩き台ができます。あとから部品ごとに差し替えられます。'),
      ),
      h('div', { class: 'mood-grid', role: 'radiogroup', 'aria-label': '雰囲気' },
        MOODS.map((m) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': String(m.id === draft.mood),
          class: `mood-card mood-${m.id}${m.id === draft.mood ? ' selected' : ''}`,
          onClick: () => { draft.mood = m.id; render(); },
        },
          h('span', { class: 'mood-icon', 'aria-hidden': 'true' }, MOOD_CARDS[m.id].icon),
          h('span', { class: 'mood-name' }, m.label),
          h('span', { class: 'mood-text' }, MOOD_CARDS[m.id].text),
        )),
      ),
      h('div', { class: 'field-row' },
        h('div', { class: 'field' },
          h('span', { class: 'field-label', id: 'tempo-label' }, '速さ'),
          h('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': 'tempo-label' },
            TEMPO_CHOICES.map((t) => h('button', {
              type: 'button', role: 'radio', 'aria-checked': String(t.id === draft.tempo), class: t.id === draft.tempo ? 'selected' : '',
              onClick: () => { draft.tempo = t.id; render(); },
            }, t.label)),
          ),
        ),
        h('label', { class: 'field grow' },
          h('span', { class: 'field-label' }, '曲名(あとで変えられます)'),
          h('input', { type: 'text', value: draft.title, placeholder: '無題の曲', onInput: (/** @type {Event} */ e) => { draft.title = /** @type {HTMLInputElement} */ (e.target).value; } }),
        ),
      ),
      history && h('p', { class: 'muted small' }, 'いま作っている曲は新しい曲に置き換わります(試作のため、覚えておけるのは1曲です)。'),
      h('div', { class: 'create-actions' },
        history && h('button', { type: 'button', class: 'ghost', onClick: () => { creating = false; render(); } }, '← いまの曲に戻る'),
        h('button', { type: 'button', class: 'primary big', onClick: createSong }, '♪ この雰囲気で作る'),
      ),
    );
  }

  function createSong() {
    const tempo = TEMPO_CHOICES.find((t) => t.id === draft.tempo)?.tempo ?? 100;
    const r = createDraftSong({ mood: draft.mood, tempo, title: draft.title });
    if (!r.ok) return showError(r.error);
    stop();
    history = new History(r.value);
    selectedId = r.value.arrangement[0]?.id ?? null;
    creating = false;
    draft.title = '';
    persist();
    render();
    playWhole(); // 作ったらすぐ聴ける
  }

  // ---- 編集 ----
  /** @param {History} hist */
  function editorView(hist) {
    const song = hist.current;
    const tl = buildTimeline(song);
    const selected = song.arrangement.find((a) => a.id === selectedId) ?? song.arrangement[0];
    return h('div', { class: 'editor' },
      h('header', { class: 'appbar' },
        h('input', {
          class: 'title-input', type: 'text', value: song.meta.title, 'aria-label': '曲名',
          onChange: (/** @type {Event} */ e) => {
            const value = /** @type {HTMLInputElement} */ (e.target).value.trim();
            if (value && value !== song.meta.title) apply(updateSongSettings(song, { title: value }), { label: '曲名を変える', keepPlaying: true });
            else render();
          },
        }),
        h('button', { type: 'button', class: 'ghost', disabled: !hist.canUndo, onClick: undo, title: hist.canUndo ? `「${hist.undoLabel}」を取り消す` : '' }, '↶ 元に戻す'),
        h('div', { class: 'menu-wrap' },
          h('button', { type: 'button', class: 'ghost icon', 'aria-label': 'メニュー', 'aria-expanded': String(menuOpen), onClick: () => { menuOpen = !menuOpen; render(); } }, '⋯'),
          menuOpen && h('div', { class: 'menu', role: 'menu' },
            h('button', { type: 'button', role: 'menuitem', onClick: () => { menuOpen = false; reroll(song); } }, '🎲 同じ雰囲気で作り直す'),
            h('button', { type: 'button', role: 'menuitem', disabled: !!wavStatus, onClick: () => { menuOpen = false; saveWav(song); } }, '💾 音声ファイル(WAV)で保存'),
            h('button', { type: 'button', role: 'menuitem', onClick: () => { menuOpen = false; creating = true; stop(); render(); } }, '＋ 新しい曲を作る'),
          ),
        ),
      ),
      wavStatus && h('p', { class: 'status', role: 'status' }, wavStatus),

      h('section', { class: 'timeline-wrap', 'aria-label': '曲の流れ' },
        h('div', { class: 'timeline' },
          tl.items.map((item) => {
            const section = song.sections.find((s) => s.id === item.sectionId);
            if (!section) return null;
            const seconds = ticksToSeconds(item.endTick - item.startTick, song.tempo);
            return h('button', {
              type: 'button', class: `block kind-${section.kind}${item.itemId === selected?.id ? ' selected' : ''}`,
              style: `flex-grow:${section.bars}`, dataset: { item: item.itemId },
              'aria-pressed': String(item.itemId === selected?.id),
              onClick: () => {
                selectedId = item.itemId;
                // 全体を再生中なら、タップした部品へ飛ぶ
                if (player.playing && mode === 'whole') playWhole(item.itemId);
                render();
              },
            },
              h('span', { class: 'block-name' }, section.name),
              sectionThumb(song, section),
              h('span', { class: 'block-time' }, `${Math.round(seconds)}秒`),
              h('span', { class: 'playhead' }),
            );
          }),
        ),
        h('p', { class: 'hint' }, '部品をタップして選ぶと、その部品だけ聴いたり、別の案に差し替えたりできます。'),
      ),

      selected ? sectionPanel(song, selected) : null,
      mixerPanel(song),

      h('footer', { class: 'transport' },
        h('button', {
          type: 'button', class: 'play', dataset: { role: 'play' }, 'aria-label': 'はじめから聴く',
          onClick: () => (player.playing && mode !== 'audition' ? stop() : playWhole()),
        }, '▶'),
        h('div', { class: 'transport-info' },
          h('span', { class: 'time', dataset: { role: 'time' } }, ''),
          h('span', { class: 'muted small' }, MOODS.find((m) => m.id === song.mood)?.label ?? ''),
        ),
        h('label', { class: 'toggle' },
          h('input', { type: 'checkbox', checked: loop, onChange: (/** @type {Event} */ e) => { loop = /** @type {HTMLInputElement} */ (e.target).checked; } }),
          'くり返す',
        ),
      ),
    );
  }

  /**
   * 選んだ部品の操作
   * @param {Song} song
   * @param {import('../core/types.js').ArrangementItem} item
   */
  function sectionPanel(song, item) {
    const section = song.sections.find((s) => s.id === item.sectionId);
    if (!section) return null;
    const index = song.arrangement.findIndex((a) => a.id === item.id);
    const uses = song.arrangement.filter((a) => a.sectionId === item.sectionId).length;
    return h('section', { class: `panel section-panel kind-${section.kind}` },
      h('div', { class: 'panel-head' },
        h('h2', null, section.name),
        uses > 1 && h('span', { class: 'tag' }, `${uses}か所で使用中(差し替えると全部に反映)`),
      ),
      h('div', { class: 'panel-main' },
        h('button', {
          type: 'button', class: 'secondary', dataset: { role: 'play-section' },
          onClick: () => (player.playing && mode === 'section' ? stop() : playSection(item.id)),
        }, '▶ ここだけ聴く'),
        h('button', { type: 'button', class: 'primary', onClick: () => openAlternatives(item.id, 'melody') }, '✨ 別の案を聴いてみる'),
      ),
      h('div', { class: 'panel-sub' },
        h('button', { type: 'button', class: 'ghost', disabled: index === 0, onClick: () => apply(moveArrangementItem(song, item.id, index - 1), { label: `${section.name}を前へ`, message: `${section.name}を前へ動かしました` }) }, '← 前へ'),
        h('button', { type: 'button', class: 'ghost', disabled: index === song.arrangement.length - 1, onClick: () => apply(moveArrangementItem(song, item.id, index + 1), { label: `${section.name}を後ろへ`, message: `${section.name}を後ろへ動かしました` }) }, '後ろへ →'),
        h('button', { type: 'button', class: 'ghost', onClick: () => apply(addArrangementItem(song, section.id, index + 1), { label: `${section.name}をもう一度使う`, message: `${section.name}をもう一度入れました` }) }, '＋ もう一度使う'),
        h('button', { type: 'button', class: 'ghost danger', disabled: song.arrangement.length === 1, onClick: () => apply(removeArrangementItem(song, item.id), { label: `${section.name}を外す`, message: `${section.name}を外しました` }) }, '外す'),
      ),
    );
  }

  /** 楽器ごとの鳴らす・音量・音色 @param {Song} song */
  function mixerPanel(song) {
    /** @param {import('../core/operations.js').SongSettings['tracks']} tracks @param {string} label */
    const change = (tracks, label) => apply(updateSongSettings(song, { tracks }), { label, keepPlaying: true });
    return h('section', { class: 'panel mixer' },
      h('div', { class: 'panel-head' },
        h('h2', null, '楽器'),
        h('span', { class: 'muted small' }, '聴きながら切り替えられます'),
      ),
      h('ul', { class: 'partlist' },
        song.tracks.map((t) => {
          const name = t.name ?? t.id;
          return h('li', { class: t.muted ? 'part muted-part' : 'part' },
            h('button', {
              type: 'button', class: `part-toggle${t.muted ? '' : ' on'}`, 'aria-pressed': String(!t.muted), 'aria-label': `${name}を鳴らす`,
              onClick: () => change([{ id: t.id, muted: !t.muted }], `${name}を${t.muted ? '鳴らす' : '消す'}`),
            },
              h('span', { 'aria-hidden': 'true' }, ROLE_ICONS[t.role] ?? '🎵'),
              h('span', { class: 'part-name' }, name),
            ),
            h('input', {
              type: 'range', min: 0, max: 1, step: 0.05, value: t.volume, 'aria-label': `${name}の音量`, disabled: !!t.muted,
              onChange: (/** @type {Event} */ e) => change([{ id: t.id, volume: Number(/** @type {HTMLInputElement} */ (e.target).value) }], `${name}の音量`),
            }),
            t.role === 'drums' ? h('span', { class: 'muted small part-fixed' }, 'ドラム') : h('select', {
              'aria-label': `${name}の音色`,
              onChange: (/** @type {Event} */ e) => change([{ id: t.id, instrument: /** @type {any} */ (/** @type {HTMLSelectElement} */ (e.target).value) }], `${name}の音色`),
            }, INSTRUMENTS.filter((i) => i.id !== 'drums').map((i) => h('option', { value: i.id, selected: i.id === t.instrument }, i.label))),
          );
        }),
      ),
    );
  }

  // ---- 別案の聴き比べ ----
  /**
   * @param {string} itemId
   * @param {AlternativeTarget} target
   */
  function openAlternatives(itemId, target) {
    if (!history) return;
    const song = history.current;
    const item = song.arrangement.find((a) => a.id === itemId);
    if (!item) return;
    const r = generateAlternatives(song, item.sectionId, target);
    if (!r.ok) return showError(r.error);
    /** @type {Candidate[]} */
    const candidates = [];
    r.value.forEach((a, i) => {
      const next = replaceSection(song, item.sectionId, a.replacement);
      if (next.ok) candidates.push({ key: `alt${i}`, label: `${'ABC'[i]}案`, song: next.value });
    });
    stop();
    sheetEntering = !alt;
    alt = { itemId, target, candidates, chosen: 'current' };
    render();
    sheetEntering = false;
    // タップしてすぐ鳴るように、先に音を用意しておく
    player.ensureContext().then((ctx) => {
      for (const c of candidates) prepareSong(c.song, ctx.sampleRate, { itemIds: [itemId] }).catch(() => {});
    });
  }

  /**
   * @param {Song} song
   * @param {NonNullable<typeof alt>} panel
   */
  function alternativesSheet(song, panel) {
    const item = song.arrangement.find((a) => a.id === panel.itemId);
    const section = item && song.sections.find((s) => s.id === item.sectionId);
    if (!item || !section) return null;
    const target = ALTERNATIVE_TARGETS.find((t) => t.id === panel.target);
    const cards = [{ key: 'current', label: 'いまの案', song }, ...panel.candidates];
    /** @param {{ key: string, song: Song }} c */
    const audition = async (c) => {
      panel.chosen = c.key;
      mode = 'audition';
      render();
      await player.play(c.song, { itemIds: [item.id], loop: true });
      mode = player.playing ? 'audition' : null;
      render();
    };
    const chosen = panel.candidates.find((c) => c.key === panel.chosen);
    return h('div', { class: 'overlay', onClick: (/** @type {Event} */ e) => { if (e.target === e.currentTarget) closeAlternatives(); } },
      h('div', { class: sheetEntering ? 'sheet entering' : 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${section.name}の別の案` },
        h('header', { class: 'sheet-head' },
          h('h2', null, `${section.name}の別の案`),
          h('button', { type: 'button', class: 'ghost icon', 'aria-label': '閉じる', onClick: closeAlternatives }, '×'),
        ),
        h('div', { class: 'segmented wide', role: 'radiogroup', 'aria-label': '何を変えるか' },
          ALTERNATIVE_TARGETS.map((t) => h('button', {
            type: 'button', role: 'radio', 'aria-checked': String(t.id === panel.target), class: t.id === panel.target ? 'selected' : '',
            onClick: () => openAlternatives(panel.itemId, t.id),
          }, t.label)),
        ),
        target && h('p', { class: 'muted small' }, target.help),
        h('div', { class: 'cards' },
          cards.map((c) => {
            const sec = c.song.sections.find((s) => s.id === section.id) ?? section;
            const isChosen = c.key === panel.chosen;
            const sounding = isChosen && mode === 'audition';
            return h('button', {
              type: 'button', class: `card kind-${section.kind}${isChosen ? ' selected' : ''}${c.key === 'current' ? ' current' : ''}`, 'aria-pressed': String(isChosen),
              onClick: () => (sounding ? (stop(), render()) : audition(c)),
            },
              h('span', { class: 'card-head' },
                h('strong', null, c.label),
                h('span', { class: 'card-state' }, sounding ? '♪ 再生中(タップで止める)' : 'タップで聴く'),
              ),
              sectionThumb(c.song, sec),
            );
          }),
        ),
        h('div', { class: 'sheet-actions' },
          h('button', { type: 'button', class: 'ghost', onClick: () => openAlternatives(panel.itemId, panel.target) }, '↻ ほかの案を出す'),
          h('button', {
            type: 'button', class: 'primary', disabled: !chosen,
            onClick: () => {
              if (!chosen) return;
              alt = null;
              apply({ ok: true, value: chosen.song, warnings: [] }, { label: `${section.name}を${chosen.label}にする`, message: `${section.name}を${chosen.label}に差し替えました` });
            },
          }, chosen ? `${chosen.label}に決める` : '案を選んでください'),
        ),
      ),
    );
  }

  function closeAlternatives() {
    alt = null;
    stop();
    render();
  }

  // ---- メニュー ----
  /** @param {Song} song */
  function reroll(song) {
    const r = createDraftSong({ mood: song.mood ?? 'setsunai', tempo: song.tempo, title: song.meta.title });
    if (apply(r, { label: '作り直す', message: '同じ雰囲気で作り直しました' })) playWhole();
  }

  /** @param {Song} song */
  async function saveWav(song) {
    wavStatus = '音声ファイルを作っています…';
    render();
    try {
      const bytes = await renderSongToWav(song, {
        onProgress: (done, total) => {
          wavStatus = `音声ファイルを作っています… ${Math.round((done / total) * 100)}%`;
          const el = root.querySelector('.status');
          if (el) el.textContent = wavStatus;
        },
      });
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
      const a = h('a', { href: url, download: `${song.meta.title}.wav` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      showToast('音声ファイルを保存しました');
    } catch {
      showToast('音声ファイルを作れませんでした。もう一度試してください', undefined, true);
    } finally {
      wavStatus = null;
      render();
    }
  }

  /** @param {NonNullable<typeof toast>} t */
  function toastView(t) {
    return h('div', { class: `toast${t.error ? ' error' : ''}`, role: t.error ? 'alert' : 'status' },
      h('span', null, t.message),
      t.action && h('button', { type: 'button', onClick: () => { const run = t.action?.run; toast = null; run?.(); } }, t.action.label),
    );
  }

  // スペースキーで再生・停止(入力中は除く)
  document.addEventListener('keydown', (e) => {
    const el = /** @type {HTMLElement | null} */ (e.target);
    if (e.code !== 'Space' || !history || creating || alt || (el && /INPUT|SELECT|TEXTAREA|BUTTON/.test(el.tagName))) return;
    e.preventDefault();
    if (player.playing) stop();
    else playWhole();
  });
  document.addEventListener('click', (e) => {
    if (menuOpen && !(/** @type {HTMLElement} */ (e.target).closest('.menu-wrap'))) {
      menuOpen = false;
      render();
    }
  });

  render();
}

/** @returns {Song | null} */
function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const r = validateSong(JSON.parse(raw), { allowOutOfKey: true });
    return r.ok ? r.value : null;
  } catch {
    return null;
  }
}

/** @param {number} s */
function clock(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
