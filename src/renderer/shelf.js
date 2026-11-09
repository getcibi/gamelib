// 架子：所有盒子侧边朝外排成一排，选中的那个抽出来、让出位置露出封面。
// 用斜投影（和 Wenku8 书架同一套思路）：侧边正对观众，正面朝右上方往里退，
// 正面上一点 (x, y) 画到 (spine + x·DX, y + x·DY)。
import { el, px, clamp, easeOutCubic, tween } from './util.js';
import { caseFront, caseSpine } from './parts.js';

const DX = 0.66;
const DY = -0.3;
const RADIUS = 1.5;

// 选中的盒子周围多大范围跟着动。
function weight(d) {
  const a = Math.abs(d);
  if (a >= RADIUS) return 0;
  const v = Math.cos((a / RADIUS) * (Math.PI / 2));
  return v * v;
}

// 0→1 的平滑过渡；选中盒子右边的都往右让出一个封面的位置。
function gapShare(d) {
  if (d <= 0) return 0;
  if (d >= 1) return 1;
  return d * d * (3 - 2 * d);
}

export class Shelf {
  constructor(root, { style, games, onOpen, onFocus }) {
    this.root = root;
    this.style = style;
    this.games = games;
    this.onOpen = onOpen;
    this.onFocus = onFocus;
    this.focus = 0;
    this.reported = -1;
    this.nodes = new Map(); // index → { node, caseH }
    this.anim = null;

    root.replaceChildren();
    this.floor = el('div.floor');
    this.layer = el('div.cases');
    root.append(this.floor, this.layer);

    this.ro = new ResizeObserver(() => this.render(true));
    this.ro.observe(root);
    this.bindInput();
    this.render(true);
  }

  destroy() {
    this.ro.disconnect();
    this.anim?.stop();
    this.unbind?.();
    this.root.replaceChildren();
  }

  get count() {
    return this.games.length;
  }

  get focusedIndex() {
    return clamp(Math.round(this.focus), 0, Math.max(0, this.count - 1));
  }

  goTo(index) {
    if (!this.count) return;
    const target = clamp(index, 0, this.count - 1);
    const from = this.focus;
    const dist = Math.abs(target - from);
    if (dist < 1e-3) return;
    this.anim?.stop();
    this.anim = tween(clamp(300 + 90 * Math.sqrt(dist), 300, 900), (t) => {
      this.focus = from + (target - from) * easeOutCubic(t);
      this.render();
    });
  }

  step(delta) {
    this.goTo(this.focusedIndex + delta);
  }

  setRaw(v) {
    this.anim?.stop();
    // 两头可以稍微拉过头一点，松手弹回来。
    this.focus = clamp(v, -0.45, this.count - 0.55);
    this.render();
  }

  snap(velocity = 0) {
    this.goTo(Math.round(this.focus - (velocity / this.pitch) * 0.22));
  }

  bindInput() {
    const r = this.root;
    let timer = 0;
    const onWheel = (e) => {
      e.preventDefault();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      this.setRaw(this.focus + (d / this.pitch) * 0.5);
      clearTimeout(timer);
      timer = setTimeout(() => this.snap(), 140);
    };
    let drag = null;
    const onDown = (e) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, focus: this.focus, moved: false, samples: [[performance.now(), e.clientX]] };
      this.anim?.stop();
    };
    const onMove = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 4) drag.moved = true;
      if (!drag.moved) return;
      drag.samples.push([performance.now(), e.clientX]);
      if (drag.samples.length > 6) drag.samples.shift();
      this.setRaw(drag.focus - dx / this.pitch);
    };
    const onUp = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (!d.moved) return;
      const [t0, x0] = d.samples[0];
      const [t1, x1] = d.samples[d.samples.length - 1];
      const v = t1 > t0 ? ((x1 - x0) / (t1 - t0)) * 1000 : 0;
      this.snap(v);
      // 拖完别触发点击
      this.suppressClick = true;
      setTimeout(() => (this.suppressClick = false), 0);
    };
    r.addEventListener('wheel', onWheel, { passive: false });
    r.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    this.unbind = () => {
      r.removeEventListener('wheel', onWheel);
      r.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }

  // 一个盒子：侧边 + 斜着的正面 + 顶面。
  buildCase(i, caseH) {
    const style = this.style;
    const game = this.games[i];
    const spine = caseH * style.depth;
    const front = caseH * style.aspect;
    const coverX = front * DX;
    const rise = -front * DY;
    const node = el(
      'div.sc',
      { style: { width: px(spine + coverX), height: px(caseH + rise), '--h': px(caseH) } },
      el('div.sc-shadow', { style: { left: px(spine * 0.1), top: px(rise + caseH - caseH * 0.012), width: px(spine * 1.6), height: px(caseH * 0.012) } }),
      el(
        'div.sc-front',
        { style: { width: px(front), height: px(caseH), transform: `matrix(${DX}, ${DY}, 0, 1, ${spine}, ${rise})` } },
        caseFront(style, game, caseH),
        el('div.sc-dim'),
      ),
      el('div.sc-top', { style: { width: px(spine), height: px(front), transform: `matrix(1, 0, ${DX}, ${DY}, 0, ${rise})` } }),
      el('div.sc-side', { style: { top: px(rise) } }, caseSpine(style, game, caseH, spine)),
      el('div.sc-glow', { style: { top: px(rise), width: px(spine), height: px(caseH) } }),
    );
    node.addEventListener('click', () => {
      if (this.suppressClick) return;
      if (i === this.focusedIndex) this.onOpen(game);
      else this.goTo(i);
    });
    return node;
  }

  render(force = false) {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    if (!w || !h) return;
    const style = this.style;
    const caseH = clamp(h * 0.66, 170, 400);
    const spine = caseH * style.depth;
    const front = caseH * style.aspect;
    const coverX = front * DX;
    const rise = -front * DY;
    const pitch = spine + caseH * 0.028;
    const gap = coverX + caseH * 0.06;
    const foot = spine + coverX;
    this.pitch = pitch;

    // 尺寸变了就全部重建
    if (force || this.caseH !== caseH) {
      this.caseH = caseH;
      for (const { node } of this.nodes.values()) node.remove();
      this.nodes.clear();
    }

    // 选中那个盒子的落脚点放在屏幕正中；地面线在下方。
    const xFocus = w / 2 - foot / 2;
    const floorY = h * 0.5 + caseH * 0.5 + rise * 0.3;
    this.floor.style.top = px(floorY);

    const focused = this.focusedIndex;
    const keep = new Set();
    // 只看屏幕附近的：从选中位置往两边找
    const lo = Math.max(0, Math.floor(this.focus - (xFocus + 40) / pitch) - 2);
    const hi = Math.min(this.count - 1, Math.ceil(this.focus + (w - xFocus + 40) / pitch) + 2);
    for (let i = lo; i <= hi; i++) {
      const d = i - this.focus;
      let x = xFocus + d * pitch + gap * gapShare(d);
      if (x + foot < -40 || x > w + 40) continue;
      const wgt = weight(d);
      const dist = Math.min(Math.abs(d), 14);
      // 越远越往下沉一点，整排是一道弧。
      let y = floorY - caseH - rise + dist * dist * caseH * 0.0011 + dist * caseH * 0.004;
      // 选中的往前（左下）抽出来一点，再抬高一点。
      const pull = caseH * 0.07 * wgt;
      x -= pull * DX;
      y += pull * -DY - caseH * 0.06 * wgt;

      let entry = this.nodes.get(i);
      if (!entry) {
        entry = { node: this.buildCase(i, caseH) };
        this.nodes.set(i, entry);
        this.layer.append(entry.node);
      }
      const n = entry.node;
      n.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      // 一律从左往右叠：右边盒子的侧边压住左边盒子往里退的正面。
      // 不给选中的特殊照顾，不然滑到一半选中项一换，前后关系会突然翻过来。
      n.style.zIndex = i;
      n.style.setProperty('--w', wgt.toFixed(3));
      n.classList.toggle('focused', i === focused);
      keep.add(i);
    }
    for (const [i, { node }] of this.nodes) {
      if (!keep.has(i)) {
        node.remove();
        this.nodes.delete(i);
      }
    }

    if (focused !== this.reported) {
      this.reported = focused;
      this.onFocus?.(focused);
    }
  }
}
