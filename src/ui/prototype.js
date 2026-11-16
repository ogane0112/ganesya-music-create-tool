// スプリント2の試作画面。叩き台を作って聴き、部品ごとに別案を聴き比べて選び、元に戻せる。
// 保存はこの端末の中だけ(サーバー保存はスプリント4で入れる)。正式な画面はスプリント5で作り直す。
import { generateAlternatives, ALTERNATIVE_TARGETS } from '../core/alternatives.js';
import { MOODS, TEMPO_PRESETS } from '../core/catalog.js';
import { History } from '../core/history.js';
import {
  addArrangementItem, createDraftSong, moveArrangementItem, removeArrangementItem, replaceSection, updateSongSettings,
} from '../core/operations.js';
import { INSTRUMENTS } from '../core/catalog.js';
import { songDurationSeconds } from '../core/timeline.js';
import { validateSong } from '../core/validate.js';
import { Player } from '../audio/player.js';
import { renderSongToWav } from '../audio/offline.js';
import { h, replace } from './dom.js';

/** @typedef {import('../core/types.js').Song} Song */
/** @typedef {import('../core/types.js').AppError} AppError */
/** @typedef {import('../core/alternatives.js').Alternative} Alternative */
/** @typedef {import('../core/alternatives.js').AlternativeTarget} AlternativeTarget */

const STORAGE_KEY = 'ganesya.prototype.song';

const TEMPO_CHOICES = /** @type {const} */ ([
  { id: 'slow', label: 'ゆっくり', tempo: TEMPO_PRESETS.slow },
  { id: 'normal', label: 'ふつう', tempo: TEMPO_PRESETS.normal },
  { id: 'fast', label: 'はやい', tempo: TEMPO_PRESETS.fast },
]);

/** @param {HTMLElement} root */
export function mountPrototype(root) {
  const player = new Player();
  /** @type {History | null} */
  let history = null;
  let loop = false;
  /** @type {string | null} 今鳴っている候補(別案パネル) */
  let auditioning = null;
  /** @type {{ itemId: string, target: AlternativeTarget, alts: Alternative[] } | null} */
  let altPanel = null;
  /** @type {AppError | null} */
  let error = null;
  /** @type {import('../core/types.js').Mood} */
  let mood = 'setsunai';
  /** @type {'slow' | 'normal' | 'fast'} */
  let tempoChoice = 'normal';
  let title = '';

  const saved = loadSaved();
  if (saved) history = new History(saved);

  player.subscribe((s) => {
    for (const el of root.querySelectorAll('[data-item]')) {
      el.classList.toggle('is-playing', s.playing && !auditioning && /** @type {HTMLElement} */ (el).dataset.item === s.itemId);
    }
    if (!s.playing && auditioning) {
      auditioning = null;
      render();
    }
    const playBtn = root.querySelector('[data-role="play-all"]');
    if (playBtn) playBtn.textContent = s.preparing ? '準備中…' : s.playing && !auditioning ? '■ 止める' : '▶ 全体を聴く';
  });

  /**
   * 操作の結果を反映する
   * @param {import('../core/types.js').Result<Song>} r
   * @param {string} label
   */
  function apply(r, label) {
    if (!r.ok) {
      showError(r.error);
      return false;
    }
    if (!history) history = new History(r.value);
    else history.push(r.value, label);
    error = null;
    persist();
    player.update(r.value);
    render();
    return true;
  }

  /** @param {AppError} e */
  function showError(e) {
    error = e;
    render();
  }

  function persist() {
    try {
      if (history) localStorage.setItem(STORAGE_KEY, JSON.stringify(history.current));
    } catch {
      // 保存できなくても続ける(試作)
    }
  }

  function render() {
    replace(root,
      h('header', { class: 'topbar' },
        h('h1', null, 'がねしゃ作曲ツール'),
        h('span', { class: 'badge' }, '試作'),
      ),
      error && errorBox(error),
      history ? editView(history) : createView(),
      altPanel && history ? alternativesPanel(history.current, altPanel) : null,
    );
  }

  // ---- 新規作成 ----
  function createView() {
    return h('main', { class: 'panel create' },
      h('h2', null, '新しい曲を作る'),
      h('label', { class: 'field' }, '曲名',
        h('input', { type: 'text', value: title, placeholder: '無題の曲', onInput: (/** @type {Event} */ e) => { title = /** @type {HTMLInputElement} */ (e.target).value; } }),
      ),
      h('fieldset', { class: 'choices' },
        h('legend', null, '雰囲気'),
        MOODS.map((m) => h('button', { type: 'button', class: m.id === mood ? 'choice selected' : 'choice', onClick: () => { mood = m.id; render(); } }, m.label)),
      ),
      h('fieldset', { class: 'choices' },
        h('legend', null, '速さ'),
        TEMPO_CHOICES.map((t) => h('button', { type: 'button', class: t.id === tempoChoice ? 'choice selected' : 'choice', onClick: () => { tempoChoice = t.id; render(); } }, t.label)),
      ),
      h('button', {
        type: 'button', class: 'primary big',
        onClick: () => {
          const tempo = TEMPO_CHOICES.find((t) => t.id === tempoChoice)?.tempo ?? 100;
          const r = createDraftSong({ mood, tempo, title });
          if (r.ok) history = null;
          apply(r, '叩き台を作る');
        },
      }, '叩き台を作る'),
    );
  }

  // ---- 編集 ----
  /** @param {History} hist */
  function editView(hist) {
    const song = hist.current;
    const duration = songDurationSeconds(song);
    return h('main', { class: 'edit' },
      h('section', { class: 'panel songhead' },
        h('div', null,
          h('h2', null, song.meta.title),
          h('p', { class: 'muted' }, `${MOODS.find((m) => m.id === song.mood)?.label ?? ''}・${formatSeconds(duration)}`),
        ),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'secondary', onClick: (/** @type {Event} */ e) => saveWav(song, /** @type {HTMLButtonElement} */ (e.currentTarget)) }, 'WAVで保存'),
          h('button', { type: 'button', class: 'secondary', onClick: newSong }, '新しく作る'),
        ),
      ),
      h('section', { class: 'transport panel' },
        h('button', {
          type: 'button', class: 'primary', dataset: { role: 'play-all' },
          onClick: async () => {
            if (player.playing && !auditioning) return player.stop();
            auditioning = null;
            await player.play(song, { loop });
          },
        }, player.playing && !auditioning ? '■ 止める' : '▶ 全体を聴く'),
        h('label', { class: 'toggle' },
          h('input', { type: 'checkbox', checked: loop, onChange: (/** @type {Event} */ e) => { loop = /** @type {HTMLInputElement} */ (e.target).checked; } }),
          'くり返す',
        ),
        h('button', {
          type: 'button', class: 'secondary', disabled: !hist.canUndo,
          title: hist.canUndo ? `「${hist.undoLabel}」を取り消す` : '',
          onClick: () => {
            const prev = hist.undo();
            if (prev) {
              player.update(prev);
              persist();
              render();
            }
          },
        }, '↶ 元に戻す'),
      ),
      h('section', { class: 'blocks' },
        h('h3', null, '曲の流れ'),
        h('p', { class: 'muted small' }, '上から順に流れます。部品を選んで、別の案と聴き比べられます。'),
        h('ol', { class: 'blocklist' },
          song.arrangement.map((item, index) => {
            const section = song.sections.find((s) => s.id === item.sectionId);
            if (!section) return null;
            const repeated = song.arrangement.filter((a) => a.sectionId === item.sectionId).length > 1;
            return h('li', { class: 'block', dataset: { item: item.id, kind: section.kind } },
              h('div', { class: 'block-name' },
                h('strong', null, section.name),
                h('span', { class: 'muted small' }, `約${Math.round(songDurationSeconds(song, { itemIds: [item.id] }))}秒${repeated ? '・同じ部品をくり返し使用' : ''}`),
              ),
              h('div', { class: 'block-actions' },
                h('button', { type: 'button', class: 'secondary', onClick: () => { auditioning = null; player.play(song, { itemIds: [item.id], loop }); } }, '▶ ここだけ'),
                h('button', { type: 'button', class: 'primary', onClick: () => openAlternatives(item.id, 'melody') }, '別案を出す'),
                h('button', { type: 'button', class: 'icon', 'aria-label': '上へ', disabled: index === 0, onClick: () => apply(moveArrangementItem(song, item.id, index - 1), '並べ替え') }, '↑'),
                h('button', { type: 'button', class: 'icon', 'aria-label': '下へ', disabled: index === song.arrangement.length - 1, onClick: () => apply(moveArrangementItem(song, item.id, index + 1), '並べ替え') }, '↓'),
                h('button', { type: 'button', class: 'icon', 'aria-label': 'もう一度使う', title: 'この部品をもう一度使う', onClick: () => apply(addArrangementItem(song, section.id, index + 1), `${section.name}を足す`) }, '+'),
                h('button', { type: 'button', class: 'icon', 'aria-label': '外す', disabled: song.arrangement.length === 1, onClick: () => apply(removeArrangementItem(song, item.id), `${section.name}を外す`) }, '×'),
              ),
            );
          }),
        ),
      ),
      partsView(song),
    );
  }

  /** パートごとの楽器・音量・消音(S5の試作) @param {Song} song */
  function partsView(song) {
    return h('details', { class: 'panel parts' },
      h('summary', null, 'パート設定(楽器・音量)'),
      h('ul', { class: 'partlist' },
        song.tracks.map((t) => h('li', null,
          h('span', { class: 'part-name' }, t.name ?? t.id),
          h('select', {
            'aria-label': `${t.name ?? t.id}の楽器`,
            onChange: (/** @type {Event} */ e) => apply(updateSongSettings(song, { tracks: [{ id: t.id, instrument: /** @type {any} */ (/** @type {HTMLSelectElement} */ (e.target).value) }] }), '楽器を変える'),
          }, INSTRUMENTS.map((i) => h('option', { value: i.id, selected: i.id === t.instrument }, i.label))),
          h('input', {
            type: 'range', min: 0, max: 1, step: 0.05, value: t.volume, 'aria-label': `${t.name ?? t.id}の音量`,
            onChange: (/** @type {Event} */ e) => apply(updateSongSettings(song, { tracks: [{ id: t.id, volume: Number(/** @type {HTMLInputElement} */ (e.target).value) }] }), '音量を変える'),
          }),
          h('label', { class: 'toggle' },
            h('input', { type: 'checkbox', checked: !!t.muted, onChange: (/** @type {Event} */ e) => apply(updateSongSettings(song, { tracks: [{ id: t.id, muted: /** @type {HTMLInputElement} */ (e.target).checked }] }), '消音') }),
            '消音',
          ),
        )),
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
    player.stop();
    altPanel = { itemId, target, alts: r.value };
    render();
  }

  /**
   * @param {Song} song
   * @param {{ itemId: string, target: AlternativeTarget, alts: Alternative[] }} panel
   */
  function alternativesPanel(song, panel) {
    const item = song.arrangement.find((a) => a.id === panel.itemId);
    const section = item && song.sections.find((s) => s.id === item.sectionId);
    if (!item || !section) return null;
    /** @param {string} key @param {Song} candidate */
    const listen = async (key, candidate) => {
      if (auditioning === key) {
        player.stop();
        return;
      }
      await player.play(candidate, { itemIds: [item.id], loop: true });
      auditioning = key;
      render();
    };
    const target = ALTERNATIVE_TARGETS.find((t) => t.id === panel.target);
    return h('div', { class: 'overlay', role: 'dialog', 'aria-label': '別案の聴き比べ' },
      h('div', { class: 'sheet' },
        h('header', { class: 'sheet-head' },
          h('h2', null, `${section.name}の別案`),
          h('button', { type: 'button', class: 'icon', 'aria-label': '閉じる', onClick: closeAlternatives }, '×'),
        ),
        h('fieldset', { class: 'choices' },
          h('legend', null, '何を変える?'),
          ALTERNATIVE_TARGETS.map((t) => h('button', {
            type: 'button', class: t.id === panel.target ? 'choice selected' : 'choice',
            onClick: () => openAlternatives(panel.itemId, t.id),
          }, t.label)),
        ),
        target && h('p', { class: 'muted small' }, target.help),
        h('ul', { class: 'candidates' },
          h('li', { class: 'candidate current' },
            h('strong', null, '今の案'),
            h('button', { type: 'button', class: 'secondary', onClick: () => listen('current', song) }, auditioning === 'current' ? '■ 止める' : '▶ 聴く'),
          ),
          panel.alts.map((alt, i) => {
            const r = replaceSection(song, section.id, alt.replacement);
            if (!r.ok) return null;
            const key = `alt${i}`;
            return h('li', { class: 'candidate' },
              h('strong', null, alt.label),
              h('button', { type: 'button', class: 'secondary', onClick: () => listen(key, r.value) }, auditioning === key ? '■ 止める' : '▶ 聴く'),
              h('button', {
                type: 'button', class: 'primary',
                onClick: () => {
                  player.stop();
                  altPanel = null;
                  auditioning = null;
                  apply(r, `${section.name}を${alt.label}にする`);
                },
              }, 'これにする'),
            );
          }),
        ),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'secondary', onClick: () => openAlternatives(panel.itemId, panel.target) }, '↻ 出し直す'),
          h('button', { type: 'button', class: 'secondary', onClick: closeAlternatives }, '今の案のままにする'),
        ),
      ),
    );
  }

  function closeAlternatives() {
    player.stop();
    altPanel = null;
    auditioning = null;
    render();
  }

  /**
   * 曲をWAVにしてダウンロードする(S6の試作)
   * @param {Song} song
   * @param {HTMLButtonElement} button
   */
  async function saveWav(song, button) {
    button.disabled = true;
    button.textContent = '音を用意しています…';
    try {
      const bytes = await renderSongToWav(song, {
        onProgress: (done, total) => { button.textContent = `音を用意しています… ${Math.round((done / total) * 100)}%`; },
      });
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
      const a = h('a', { href: url, download: `${song.meta.title}.wav` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      showError({ code: 'export_failed', message: 'WAVを作れませんでした', hint: 'もう一度試してください。続く場合はページを読み込み直してください' });
    } finally {
      button.disabled = false;
      button.textContent = 'WAVで保存';
    }
  }

  function newSong() {
    if (!confirm('今の曲を閉じて、新しく作りますか?(この試作では1曲だけ覚えます)')) return;
    player.stop();
    history = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 続ける
    }
    render();
  }

  render();
}

/** @param {AppError} e */
function errorBox(e) {
  return h('div', { class: 'error', role: 'alert' },
    h('strong', null, e.message),
    h('p', null, e.hint),
  );
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
function formatSeconds(s) {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}分${String(sec).padStart(2, '0')}秒`;
}
