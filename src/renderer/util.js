import { locale, t } from './i18n.js';

// 小工具：建 DOM、取图、配色、格式化。

// el('div.a.b', {style: {...}, text: '...'}, ...children)
export function el(spec, props = {}, ...children) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null) continue;
    if (k === 'style') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv == null) continue;
        if (sk.startsWith('--')) node.style.setProperty(sk, sv);
        else node.style[sk] = sv;
      }
    } else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

export function svg(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstChild;
}

export const px = (n) => `${n}px`;

export const artUrl = (game, kind, index = 0) => `art://game/${game.appId}/${kind}/${index}`;

// 图片：取到了淡入，取不到就去掉（下面垫着的生成封面会露出来）。
export function artImg(game, kind, { index = 0, cls = '' } = {}) {
  const img = el('img.art' + (cls ? '.' + cls : ''), { alt: '', draggable: 'false', decoding: 'async' });
  img.addEventListener('load', () => img.classList.add('ok'));
  img.addEventListener('error', () => img.remove());
  img.src = artUrl(game, kind, index);
  return img;
}

// 从 AppID 派生一个稳定的主题色，给书脊色条、没图时的封面用。
export const accent = (game, l = 55) => `hsl(${(game.appId * 47) % 360} 62% ${l}%)`;

// 没有封面图时自己排一个：主题色渐变 + 游戏名。上面再盖真图。
export function coverArt(game) {
  return el(
    'div.cover-art',
    {},
    el(
      'div.gen-cover',
      { style: { background: `linear-gradient(135deg, ${accent(game, 34)}, ${accent(game, 12)})` } },
      el('span', { text: game.name }),
    ),
    artImg(game, 'cover'),
  );
}

export function formatSize(bytes) {
  if (!bytes) return '—';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(gb >= 100 ? 0 : 1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

export function formatLastPlayed(timestamp) {
  if (!timestamp) return t('neverPlayed');
  const d = Date.now() - timestamp;
  if (d < 3600e3) return t('justNow');
  if (d < 86400e3) return t('hoursAgo', { count: Math.floor(d / 3600e3) });
  if (d < 30 * 86400e3) return t('daysAgo', { count: Math.floor(d / 86400e3) });
  return formatDate(timestamp, '-');
}

export function formatDate(t, sep = '.') {
  const d = new Date(t);
  if (locale() === 'en-US') return d.toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric' });
  const two = (v) => String(v).padStart(2, '0');
  return [d.getFullYear(), two(d.getMonth() + 1), two(d.getDate())].join(sep);
}

export function formatPlaytime(m) {
  if (!m) return '—';
  if (m < 60) return t('minutes', { count: m });
  const h = m / 60;
  return t('hours', { count: h >= 100 ? Math.round(h) : h.toFixed(1) });
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOutCubic = (t) => 1 - (1 - t) ** 3;
export const easeInCubic = (t) => t * t * t;
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const ease = (t, f) => f(clamp(t, 0, 1));

// 简单的时间轴：从 from 跑到 to，每帧回调。返回 {stop, done}
export function tween(duration, onFrame) {
  let raf = 0;
  let stopped = false;
  const start = performance.now();
  const done = new Promise((resolve) => {
    const step = (now) => {
      if (stopped) return resolve(false);
      const t = clamp((now - start) / duration, 0, 1);
      onFrame(t);
      if (t < 1) raf = requestAnimationFrame(step);
      else resolve(true);
    };
    raf = requestAnimationFrame(step);
  });
  return {
    done,
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
    },
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
