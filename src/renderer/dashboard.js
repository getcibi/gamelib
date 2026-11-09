import { locale, t } from './i18n.js';

// 数据面板：盖在架子上面的全屏一层，看游玩时长和口味。
// 图表都是手画的 SVG / DOM，没有图表库。
import { el, artImg, accent, formatLastPlayed, formatSize } from './util.js';
import { computeStats } from './stats.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const c of children.flat()) if (c != null && c !== false) n.append(c);
  return n;
}

// ---------------------------------------------------------------- 格式

const hours = (m) => m / 60;
function fmtHours(m) {
  const h = hours(m);
  if (h < 1) return t('minutes', { count: Math.round(m) });
  return t('hours', { count: h >= 100 ? Math.round(h).toLocaleString(locale()) : h.toFixed(1) });
}
const fmtH = (m) => {
  const h = hours(m);
  return h >= 100 ? Math.round(h).toLocaleString(locale()) : h >= 10 ? h.toFixed(0) : h.toFixed(1);
};
const yuan = (cents, digits = 0) =>
  '¥' + (cents / 100).toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pct = (v) => `${Math.round(v * 100)}%`;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// 数字从 0 滚上来
function countUp(node, to, format, delay = 0) {
  if (reduceMotion() || !Number.isFinite(to)) {
    node.textContent = format(to);
    return;
  }
  node.textContent = format(0);
  const dur = 1300;
  setTimeout(() => {
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      node.textContent = format(to * (1 - (1 - t) ** 4));
      if (t < 1 && node.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, delay);
}

// ---------------------------------------------------------------- 面板

export class Dashboard {
  constructor(parent, { games, demo, accountStatus, onPick, onClose }) {
    this.onPick = onPick;
    this.onClose = onClose;
    this.st = computeStats(games);
    this.demo = demo;
    this.accountStatus = accountStatus;
    this.root = el('div.dash', { id: 'dash', role: 'dialog', 'aria-label': t('dashboard') });
    this.tip = el('div.d-tip', { role: 'tooltip' });
    this.scroll = el('div.d-scroll');
    this.root.append(el('div.d-bg', {}, el('i.b1'), el('i.b2'), el('i.b3'), el('i.grid')), this.scroll, this.tip);
    this.scroll.addEventListener('scroll', () => this.tip.classList.remove('show'), { passive: true });
    this.build();
    parent.append(this.root);
    requestAnimationFrame(() => {
      this.root.classList.add('in');
      // 条形图从 0 长出来
      setTimeout(() => this.root.classList.add('grown'), 60);
    });
  }

  close() {
    if (this.closing) return;
    this.closing = true;
    this.root.classList.remove('in');
    this.root.classList.add('out');
    setTimeout(() => {
      this.root.remove();
      this.onClose?.();
    }, 320);
  }

  pick(game) {
    this.onPick?.(game);
    this.close();
  }

  // ---- 悬停提示
  bindTip(node, content) {
    const move = (e) => {
      const r = this.root.getBoundingClientRect();
      const w = this.tip.offsetWidth;
      const h = this.tip.offsetHeight;
      let x = e.clientX - r.left + 16;
      let y = e.clientY - r.top + 16;
      if (x + w > r.width - 12) x = e.clientX - r.left - w - 16;
      if (y + h > r.height - 12) y = e.clientY - r.top - h - 16;
      this.tip.style.transform = `translate(${x}px, ${y}px)`;
    };
    node.addEventListener('pointerenter', (e) => {
      this.tip.replaceChildren(...[content()].flat());
      this.tip.classList.add('show');
      move(e);
    });
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerleave', () => this.tip.classList.remove('show'));
  }

  gameTip(g) {
    const rows = [
      [t('played'), fmtHours(g.playtimeMinutes)],
      [t('lastPlayed'), formatLastPlayed(g.lastPlayed)],
      g.priceCents ? [t('price'), yuan(g.priceCents, 2)] : g.isFree ? [t('price'), t('free')] : null,
      g.priceCents && g.playtimeMinutes >= 60 ? [t('perHour'), yuan(g.priceCents / hours(g.playtimeMinutes), 2)] : null,
      g.reviewPct != null ? [t('reviews'), t('positiveReviews', { percent: g.reviewPct, count: g.reviewCount.toLocaleString(locale()) })] : null,
    ].filter(Boolean);
    return [el('b', { text: g.name }), ...rows.map(([k, v]) => el('div.r', {}, el('span', { text: k }), el('em', { text: v })))];
  }

  // ---- 布局
  build() {
    const st = this.st;
    const head = el(
      'header.d-head',
      {},
      el('div.d-brand', {}, el('i.d-dot'), el('span', { text: 'PLAYER INSIGHTS' }), el('em', { text: t('dashboard') })),
      this.demo ? el('span.d-demo', { text: t('demoData') }) : null,
      this.accountStatus ? el('span.d-key', { text: this.accountStatus }) : null,
      el('div.spacer'),
      el('span.d-key', { text: t('escToShelf') }),
      el(
        'button.d-close',
        { title: t('backToShelf'), onclick: () => this.close() },
        s('svg', { viewBox: '0 0 24 24' }, s('path', { d: 'M6 6l12 12M18 6L6 18' })),
      ),
    );
    if (!st.playedCount) {
      this.scroll.append(head, el('div.d-empty', {}, el('b', { text: t('noPlayHistory') }), el('p', { text: t('playHistoryHelp') })));
      return;
    }
    const grid = el(
      'div.d-grid',
      {},
      this.hero(),
      this.topPanel(),
      this.radarPanel(),
      this.tagsPanel(),
      this.eraPanel(),
      this.devPanel(),
      this.scatterPanel(),
      this.shelfPanel(),
      this.recentPanel(),
    );
    [...grid.children].forEach((c, i) => c.style.setProperty('--i', i));
    this.scroll.append(head, grid, el('footer.d-foot', { text: t('dashboardFooter') }));
  }

  panel(cls, title, sub, ...body) {
    return el(
      `section.d-panel.${cls}`,
      {},
      el('div.d-ph', {}, el('h3', { text: title }), sub ? el('span', { text: sub }) : null),
      ...body,
    );
  }

  // ---------------------------------------------------------------- 顶部：人格 + 指标

  hero() {
    const st = this.st;
    const fav = st.favorite;
    const bg = el('div.d-hero-bg', {}, fav ? artImg(fav, 'hero') : null);
    const p = st.persona;
    const left = el(
      'div.d-hero-l',
      {},
      el('div.d-kicker', { text: t('gamerDna') }),
      el('h2.d-title', { text: p.title }),
      p.second ? el('div.d-title2', {}, el('span', { text: t('also') }), p.second) : null,
      el('div.d-traits', {}, p.traits.map((t) => el('span', { text: t }))),
      fav
        ? el(
            'button.d-fav',
            { onclick: () => this.pick(fav) },
            el('span.lbl', { text: t('favorite') }),
            el('b', { text: fav.name }),
            el('span.v', { text: t('shareOfTotal', { time: fmtHours(fav.playtimeMinutes), share: pct(fav.playtimeMinutes / st.totalMinutes) }) }),
          )
        : null,
    );

    const tile = (label, valueNode, sub, cls = '') =>
      el(`div.d-kpi${cls}`, {}, el('span.k', { text: label }), valueNode, el('span.s', { text: sub }));
    const num = (unit) => el('div.v', {}, el('b'), unit ? el('small', { text: unit }) : null);

    const hNode = num(t('hourUnit'));
    countUp(hNode.firstChild, hours(st.totalMinutes), (v) => Math.round(v).toLocaleString(locale()), 250);
    const days = hours(st.totalMinutes) / 24;

    const cNode = num(t('gameUnit'));
    countUp(cNode.firstChild, st.count, (v) => Math.round(v).toString(), 350);

    const vNode = num('');
    countUp(vNode.firstChild, st.valueCents, (v) => yuan(v), 450);

    const pNode = num(t('perHourUnit'));
    if (st.costPerHour != null) countUp(pNode.firstChild, st.costPerHour, (v) => '¥' + v.toFixed(2), 550);
    else pNode.firstChild.textContent = '—';

    const kpis = el(
      'div.d-kpis',
      {},
      tile(t('totalPlaytime'), hNode, t('daysEquivalent', { count: days >= 10 ? Math.round(days) : days.toFixed(1) }), '.hot'),
      tile(t('library'), cNode, t('playedInstalled', { played: st.playedCount, installed: st.installedCount })),
      tile(t('libraryValue'), vNode, st.pricedCount ? t('gamesPriced', { count: st.pricedCount }) : t('noPrices')),
      tile(
        t('costPerHour'),
        pNode,
        st.bestValue ? t('bestValue', { name: st.bestValue.game.name, price: yuan(st.bestValue.perHour * 100, 2) }) : t('valueHint'),
      ),
    );
    return el('section.d-hero', {}, bg, el('div.d-hero-in', {}, left, kpis));
  }

  // ---------------------------------------------------------------- 时长排行

  topPanel() {
    const st = this.st;
    const max = st.top[0].playtimeMinutes;
    const rows = st.top.map((g, i) => {
      const row = el(
        'button.d-row' + (i === 0 ? '.first' : ''),
        { onclick: () => this.pick(g) },
        el('span.rank', { text: String(i + 1).padStart(2, '0') }),
        el('span.thumb', { style: { background: accent(g, 22) } }, artImg(g, 'cover')),
        el(
          'span.main',
          {},
          el('span.nm', {}, el('b', { text: g.name }), el('i', { text: g.developers?.[0] || '' })),
          el('span.track', {}, el('span.fill', { style: { '--w': (g.playtimeMinutes / max).toFixed(4) } })),
        ),
        el('span.val', {}, el('b', { text: fmtH(g.playtimeMinutes) }), el('i', { text: 'h' })),
        el('span.share', { text: pct(g.playtimeMinutes / st.totalMinutes) }),
      );
      row.style.setProperty('--j', i);
      this.bindTip(row, () => this.gameTip(g));
      return row;
    });
    return this.panel('p-top', t('playtimeRanking'), t('topGames', { count: st.top.length }), el('div.d-rows', {}, rows));
  }

  // ---------------------------------------------------------------- 品味雷达

  radarPanel() {
    const st = this.st;
    const axes = st.radar;
    const W = locale() === 'en-US' ? 460 : 420;
    const H = 360;
    const cx = W / 2;
    const cy = H / 2 + 2;
    const R = 132;
    const maxShare = Math.max(0.2, ...axes.map((a) => a.share));
    const top = Math.min(1, Math.ceil(maxShare * 10) / 10);
    const n = axes.length;
    const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const pt = (i, r) => [cx + Math.cos(ang(i)) * r, cy + Math.sin(ang(i)) * r];

    const rings = [0.25, 0.5, 0.75, 1].map((f) =>
      s('polygon', { class: 'ring', points: axes.map((_, i) => pt(i, R * f).join(',')).join(' ') }),
    );
    const spokes = axes.map((_, i) => {
      const [x, y] = pt(i, R);
      return s('line', { class: 'spoke', x1: cx, y1: cy, x2: x, y2: y });
    });
    const ringLabels = [0.5, 1].map((f) =>
      s('text', { class: 'rl', x: cx + 4, y: cy - R * f - 3 }, `${Math.round(top * f * 100)}%`),
    );
    const shape = axes.map((a, i) => pt(i, (R * a.share) / top));
    const poly = shape.map((p) => p.join(',')).join(' ');
    const best = axes.reduce((b, a) => (a.share > b.share ? a : b), axes[0]);

    const labels = axes.map((a, i) => {
      const [x, y] = pt(i, R + 26);
      const anchor = Math.abs(x - cx) < 8 ? 'middle' : x > cx ? 'start' : 'end';
      return s(
        'text',
        { class: 'al' + (a === best ? ' best' : ''), x, y: y + 4, 'text-anchor': anchor },
        s('tspan', {}, a.name),
        s('tspan', { class: 'ap', dx: 5 }, pct(a.share)),
      );
    });
    const dots = axes.map((a, i) => {
      const [x, y] = shape[i];
      const hit = s('circle', { class: 'hit', cx: x, cy: y, r: 14 });
      const g = s('g', { class: 'rdot' + (a === best ? ' best' : '') }, s('circle', { class: 'dot', cx: x, cy: y, r: 4.5 }), hit);
      this.bindTip(g, () => [
        el('b', { text: `${a.name} · ${a.title}` }),
        el('div.r', {}, el('span', { text: t('playtimeShare') }), el('em', { text: pct(a.share) })),
        el('div.r', {}, el('span', { text: t('relatedGames') }), el('em', { text: t('gameCount', { count: a.games }) })),
      ]);
      return g;
    });

    const svgNode = s(
      'svg',
      { class: 'd-radar', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${t('tasteRadar')}: ${axes.map((a) => `${a.name} ${pct(a.share)}`).join(', ')}` },
      s(
        'defs',
        {},
        s(
          'radialGradient',
          { id: 'rg-fill', cx: '50%', cy: '50%', r: '60%' },
          s('stop', { offset: '0%', 'stop-color': '#8b7bff', 'stop-opacity': '.15' }),
          s('stop', { offset: '100%', 'stop-color': '#5aa9ff', 'stop-opacity': '.55' }),
        ),
        s('filter', { id: 'rg-glow', x: '-30%', y: '-30%', width: '160%', height: '160%' }, s('feGaussianBlur', { stdDeviation: '7' })),
      ),
      rings,
      spokes,
      ringLabels,
      s('polygon', { class: 'shape-glow', points: poly, filter: 'url(#rg-glow)' }),
      s('polygon', { class: 'shape', points: poly }),
      labels,
      dots,
    );

    const meters = el(
      'div.d-meters',
      {},
      this.meter(t('reviewScore'), st.quality != null ? `${Math.round(st.quality)}%` : '—', st.quality != null ? (st.quality - 50) / 50 : 0, t('reviewScoreHelp')),
      this.meter(t('nicheScore'), st.niche != null ? String(st.niche) : '—', st.niche != null ? st.niche / 100 : 0, t('nicheScoreHelp')),
      this.meter(t('averageEra'), st.eraYear != null ? String(Math.round(st.eraYear)) : '—', st.eraYear != null ? (st.eraYear - 2000) / (new Date().getFullYear() - 2000) : 0, t('averageEraHelp')),
    );
    return this.panel('p-radar', t('tasteRadar'), t('weightedByPlaytime'), svgNode, meters);
  }

  meter(label, value, f, help) {
    const m = el(
      'div.d-meter',
      {},
      el('span.k', { text: label }),
      el('b', { text: value }),
      el('span.track', {}, el('span.fill', { style: { '--w': Math.max(0, Math.min(1, f)).toFixed(3) } })),
    );
    this.bindTip(m, () => [el('b', { text: label }), el('div.r', {}, el('span', { text: help }))]);
    return m;
  }

  // ---------------------------------------------------------------- 标签 / 厂商（横条）

  bars(items, { label, value, tip }) {
    const max = items[0] ? items[0].minutes : 1;
    return el(
      'div.d-bars',
      {},
      items.map((it, i) => {
        const row = el(
          'div.d-bar' + (i === 0 ? '.first' : ''),
          {},
          el('span.nm', { text: label(it) }),
          el('span.track', {}, el('span.fill', { style: { '--w': (it.minutes / max).toFixed(4) } })),
          el('span.val', { text: value(it) }),
        );
        row.style.setProperty('--j', i);
        this.bindTip(row, () => tip(it));
        return row;
      }),
    );
  }

  tagsPanel() {
    const tags = this.st.tags;
    const body = tags.length
      ? this.bars(tags, {
          label: (tag) => tag.name,
          value: (tag) => pct(tag.share),
          tip: (tag) => [el('b', { text: tag.name }), el('div.r', {}, el('span', { text: t('taggedPlaytime') }), el('em', { text: fmtHours(tag.minutes) }))],
        })
      : el('p.d-none', { text: t('noStoreTags') });
    return this.panel('p-tags', t('tasteDna'), t('tagShares'), body);
  }

  devPanel() {
    const devs = this.st.developers;
    const body = devs.length
      ? this.bars(devs, {
          label: (d) => d.name,
          value: (d) => fmtH(d.minutes) + 'h',
          tip: (d) => [
            el('b', { text: d.name }),
            el('div.r', {}, el('span', { text: t('played') }), el('em', { text: fmtHours(d.minutes) })),
            el('div.r', {}, el('span', { text: t('developerGames') }), el('em', { text: t('gameCount', { count: d.games }) })),
          ],
        })
      : el('p.d-none', { text: t('noDevelopers') });
    return this.panel('p-dev', t('topDevelopers'), t('byPlaytime'), body);
  }

  // ---------------------------------------------------------------- 年代

  eraPanel() {
    const era = this.st.era;
    if (!era.length) return this.panel('p-era', t('eras'), '', el('p.d-none', { text: t('noReleaseDates') }));
    const max = Math.max(...era.map((e) => e.minutes));
    const peak = era.find((e) => e.minutes === max);
    const cols = era.map((e, i) => {
      const c = el(
        'div.d-col' + (e === peak ? '.peak' : '') + (e.minutes ? '' : '.zero'),
        {},
        el('span.bar', { style: { '--h': (e.minutes / max).toFixed(4) } }),
      );
      c.style.setProperty('--j', i);
      this.bindTip(c, () => [
        el('b', { text: t(e.early ? 'throughYear' : 'releasedIn', { year: e.year }) }),
        el('div.r', {}, el('span', { text: t('played') }), el('em', { text: e.minutes ? fmtHours(e.minutes) : '—' })),
        ...e.games
          .sort((a, b) => b.playtimeMinutes - a.playtimeMinutes)
          .slice(0, 4)
          .map((g) => el('div.r.g', {}, el('span', { text: g.name }), el('em', { text: fmtH(g.playtimeMinutes) + 'h' }))),
      ]);
      return c;
    });
    const first = era[0];
    const last = era[era.length - 1];
    const axis = el(
      'div.d-axis',
      {},
      el('span', { text: first.early ? t('throughYear', { year: first.year }) : String(first.year) }),
      el('span', { text: String(last.year) }),
    );
    const peakNote = el('div.d-note', {}, el('b', { text: peak.early ? t('throughYear', { year: peak.year }) : String(peak.year) }), el('span', { text: t('favoriteEra', { time: fmtHours(peak.minutes) }) }));
    return this.panel('p-era', t('eras'), t('playtimeByYear'), peakNote, el('div.d-cols', {}, cols), axis);
  }

  // ---------------------------------------------------------------- 热度 × 时长

  scatterPanel() {
    const list = this.st.scatter;
    if (list.length < 2) return this.panel('p-scatter', t('popularity'), '', el('p.d-none', { text: t('noStoreReviews') }));
    const W = 640;
    const H = 300;
    const m = { l: 46, r: 18, t: 16, b: 34 };
    const lx = (c) => Math.log10(Math.max(10, c));
    const xs = list.map((g) => lx(g.reviewCount));
    const x0 = Math.min(4, Math.floor(Math.min(...xs)));
    const x1 = Math.ceil(Math.max(...xs, 5));
    const ly = (mins) => Math.log10(Math.max(1, hours(mins)));
    const ys = list.map((g) => ly(g.playtimeMinutes));
    const y1 = Math.ceil(Math.max(...ys, 2));
    const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
    const Y = (v) => H - m.b - (v / y1) * (H - m.t - m.b);

    const grid = [];
    for (let v = x0; v <= x1; v++) {
      grid.push(s('line', { class: 'gl', x1: X(v), x2: X(v), y1: m.t, y2: H - m.b }));
      const lab = v >= 6 ? `${10 ** (v - 6)}M` : v >= 3 ? `${10 ** (v - 3)}K` : String(10 ** v);
      grid.push(s('text', { class: 'tk', x: X(v), y: H - m.b + 18, 'text-anchor': 'middle' }, lab));
    }
    for (let v = 0; v <= y1; v++) {
      grid.push(s('line', { class: 'gl', x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }));
      grid.push(s('text', { class: 'tk', x: m.l - 8, y: Y(v) + 4, 'text-anchor': 'end' }, `${10 ** v}h`));
    }
    // 分界：5 万篇评测、10 小时
    const sx = X(Math.min(x1, Math.max(x0, Math.log10(50000))));
    const sy = Y(Math.min(y1, 1));
    const quads = [
      s('line', { class: 'split', x1: sx, x2: sx, y1: m.t, y2: H - m.b }),
      s('line', { class: 'split', x1: m.l, x2: W - m.r, y1: sy, y2: sy }),
      s('text', { class: 'q', x: m.l + 10, y: m.t + 16 }, t('nicheFavorites')),
      s('text', { class: 'q', x: W - m.r - 10, y: m.t + 16, 'text-anchor': 'end' }, t('popularFavorites')),
      s('text', { class: 'q', x: m.l + 10, y: H - m.b - 10 }, t('nicheSamples')),
      s('text', { class: 'q', x: W - m.r - 10, y: H - m.b - 10, 'text-anchor': 'end' }, t('popularSamples')),
    ];
    const topIds = new Set(this.st.top.slice(0, 3).map((g) => g.appId));
    const sorted = [...list].sort((a, b) => a.playtimeMinutes - b.playtimeMinutes);
    // 前三名标名字：按时长从高到低摆，和已摆的撞了就换到左边，再撞就上下错开
    const placed = [];
    const labelAt = new Map();
    for (const g of [...list].filter((g) => topIds.has(g.appId)).sort((a, b) => b.playtimeMinutes - a.playtimeMinutes)) {
      const x = X(lx(g.reviewCount));
      const y = Y(ly(g.playtimeMinutes));
      const text = g.name.length > 14 ? g.name.slice(0, 13) + '…' : g.name;
      const w = [...text].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 11 : 6.4), 0);
      const tries = [];
      for (const dy of [0, -15, 15, -30, 30]) {
        tries.push({ side: 1, dy }, { side: -1, dy });
      }
      const fits = (t) => {
        const lx0 = t.side > 0 ? x + 11 : x - 11 - w;
        const box = [lx0, y + t.dy - 9, lx0 + w, y + t.dy + 5];
        if (box[0] < m.l || box[2] > W - m.r) return null;
        return placed.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3])) ? null : box;
      };
      for (const t of tries) {
        const box = fits(t);
        if (box) {
          placed.push(box);
          labelAt.set(g.appId, { x: t.side > 0 ? x + 11 : x - 11, y: y + t.dy + 4, anchor: t.side > 0 ? 'start' : 'end', text });
          break;
        }
      }
    }
    const dots = sorted.map((g) => {
      const x = X(lx(g.reviewCount));
      const y = Y(ly(g.playtimeMinutes));
      const hot = topIds.has(g.appId);
      const lab = labelAt.get(g.appId);
      const grp = s(
        'g',
        { class: 'sd' + (hot ? ' hot' : ''), style: 'cursor:pointer' },
        s('circle', { class: 'halo', cx: x, cy: y, r: 9 }),
        s('circle', { class: 'dot', cx: x, cy: y, r: hot ? 6 : 4.5 }),
        s('circle', { class: 'hit', cx: x, cy: y, r: 12 }),
        lab ? s('text', { class: 'dl', x: lab.x, y: lab.y, 'text-anchor': lab.anchor }, lab.text) : null,
      );
      grp.addEventListener('click', () => this.pick(g));
      this.bindTip(grp, () => this.gameTip(g));
      return grp;
    });
    const svgNode = s(
      'svg',
      { class: 'd-scatter', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('reviewsVsTime') },
      grid,
      quads,
      s('text', { class: 'ax', x: W - m.r, y: H - 2, 'text-anchor': 'end' }, t('reviewAxis')),
      dots,
    );
    const niche = list.filter((g) => g.reviewCount < 50000 && g.playtimeMinutes >= 600).length;
    return this.panel(
      'p-scatter',
      t('popularity'),
      niche ? t('nichePlayed', { count: niche }) : t('mainstreamPlayed'),
      svgNode,
    );
  }

  // ---------------------------------------------------------------- 库存

  shelfPanel() {
    const st = this.st;
    const total = st.count || 1;
    const segs = [
      ['deep', t('deepPlay'), t('deepPlayRange'), st.shelf.deep],
      ['tried', t('tried'), t('triedRange'), st.shelf.tried],
      ['backlog', t('backlog'), t('backlogRange'), st.shelf.backlog],
    ];
    const bar = el(
      'div.d-seg',
      {},
      segs.filter((x) => x[3]).map(([k, n, r, c]) => {
        const seg = el(`span.${k}`, { style: { flexGrow: c } });
        this.bindTip(seg, () => [el('b', { text: n }), el('div.r', {}, el('span', { text: r }), el('em', { text: `${t('gameCount', { count: c })} · ${pct(c / total)}` }))]);
        return seg;
      }),
    );
    const legend = el(
      'div.d-legend',
      {},
      segs.map(([k, n, r, c]) => el('div', {}, el(`i.${k}`), el('span', { text: n }), el('b', { text: String(c) }), el('em', { text: r }))),
    );
    const pile = [...st.backlog].sort((a, b) => (b.priceCents || 0) - (a.priceCents || 0)).slice(0, 6);
    const pileNode = pile.length
      ? el(
          'div.d-pile',
          {},
          pile.map((g) => {
            const c = el('button.d-mini', { onclick: () => this.pick(g), style: { background: accent(g, 22) } }, artImg(g, 'cover'));
            this.bindTip(c, () => this.gameTip(g));
            return c;
          }),
        )
      : null;
    const facts = el(
      'div.d-facts',
      {},
      el('div', {}, el('span', { text: t('installed') }), el('b', { text: t('gameCount', { count: st.installedCount }) }), el('em', { text: formatSize(st.diskBytes) })),
      el('div', {}, el('span', { text: t('backlogValue') }), el('b', { text: st.backlogValueCents ? yuan(st.backlogValueCents) : '—' }), el('em', { text: t('barelyPlayed', { count: st.backlog.length }) })),
    );
    return this.panel(
      'p-shelf',
      t('libraryBreakdown'),
      t('playedPercent', { share: pct(st.playedCount / total) }),
      bar,
      legend,
      facts,
      pileNode ? el('div.d-sub', { text: t('backlogByPrice') }) : null,
      pileNode,
      this.valueList(),
    );
  }

  // 最划算：每小时花费最低的几款
  valueList() {
    const list = this.st.bestValues;
    if (!list.length) return null;
    const worst = list[list.length - 1].perHour || 1;
    return el(
      'div.d-value',
      {},
      el('div.d-sub', { text: t('bestValueByHour') }),
      list.map(({ game, perHour }, i) => {
        const row = el(
          'button.d-vrow',
          { onclick: () => this.pick(game) },
          el('span.thumb', { style: { background: accent(game, 22) } }, artImg(game, 'cover')),
          el('span.nm', { text: game.name }),
          el('span.track', {}, el('span.fill', { style: { '--w': Math.max(0.04, perHour / worst).toFixed(4), '--j': i } })),
          el('b', { text: `¥${perHour.toFixed(2)}` }),
        );
        this.bindTip(row, () => this.gameTip(game));
        return row;
      }),
    );
  }

  // ---------------------------------------------------------------- 最近

  recentPanel() {
    const st = this.st;
    const cards = st.recent.map((g, i) => {
      const c = el(
        'button.d-card',
        { onclick: () => this.pick(g) },
        el('span.art', { style: { background: accent(g, 20) } }, artImg(g, 'hero')),
        el('span.shade'),
        el('span.txt', {}, el('b', { text: g.name }), el('span', { text: `${formatLastPlayed(g.lastPlayed)} · ${fmtHours(g.playtimeMinutes)}` })),
      );
      c.style.setProperty('--j', i);
      this.bindTip(c, () => this.gameTip(g));
      return c;
    });
    return this.panel('p-recent', t('recentlyPlayed'), t('active30', { count: st.active30 }), el('div.d-cards', {}, cards));
  }
}
