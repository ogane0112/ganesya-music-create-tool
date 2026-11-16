// 画面の部品を作る小さな道具。フレームワークを使わずに要素を組み立てる。

/**
 * @typedef {Record<string, any>} Props
 * @typedef {Node | string | number | null | undefined | false} Child
 */

/**
 * 要素を作る。on〜 はイベント、class は className、それ以外は属性
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Props | null} [props]
 * @param {...(Child | Child[])} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

/**
 * 中身を入れ替える
 * @param {Element} el
 * @param {...(Child | Child[])} children
 */
export function replace(el, ...children) {
  el.replaceChildren();
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}
