import { t as translate } from './i18n.js';
import { armInsertionSound } from './insertion-audio.js';

// 点开一个游戏后的整套动画，用 CSS 3D（perspective + preserve-3d）摆一个真的盒子：
// 1. 合着的盒子从下方转进来；
// 2. 像真的 DVD 盒一样翻开：书脊绕后铰链转 90°，封面绕前铰链转 180°，
//    最后封面、书脊、托盘平铺在一个平面上，相机移到展开后的中心；
// 3. 点光盘 / 卡带：拿起来、转起来 / 插走，同时让 Steam 启动游戏；
// 4. 过一会儿自动合上回到架子。
//
// 场景坐标沿用"x 向右、y 向下、z 朝屏幕里"，交给 CSS 时把 z 取反。
// 托盘底面在 z = D，占 x∈[0,W]、y∈[0,H]；后铰链 A 在 (0,0,D)，书脊宽 D，封面绕前铰链 B 转。
import { el, px, clamp, lerp, ease, easeOutCubic, easeInCubic, easeInOutCubic, tween, sleep } from './util.js';
import { caseFront, caseSpine, lip, insidePanel, discTray, cardTray, cardSlot, disc, cartridge, fitInsert } from './parts.js';

const V = (x, y, z) => ({ x, y, z });
const add = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z);
const mul = (a, k) => V(a.x * k, a.y * k, a.z * k);
const cross = (a, b) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const vlerp = (a, b, t) => V(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
// 绕 y 轴转 a 后的单位向量（从 +x 开始，正角度朝镜头方向转）。
const yawDir = (a) => V(Math.cos(a), 0, -Math.sin(a));

// 光从左上方、镜头这一侧照过来（指向光源的单位向量）。
const LIGHT = (() => {
  const l = V(-0.4, -0.6, -0.7);
  const len = Math.hypot(l.x, l.y, l.z);
  return V(l.x / len, l.y / len, l.z / len);
})();

const UP = V(0, 1, 0);
const RIGHT = V(1, 0, 0);
const BACK = V(0, 0, 1);
// 正面偏左约 14°，从略低的位置看向盒面。两种盒型共用这个默认视角。
const OPEN_YAW = -0.244;
const OPEN_PITCH = -0.079;

// 一块平面：左上角在 o，局部 x 沿 u、y 沿 v，宽 w。mirror 用来摆背面（内容翻过来才是正的）。
function matrix(o, u, v, w, mirror) {
  let U = V(u.x, u.y, -u.z);
  const Vv = V(v.x, v.y, -v.z);
  let O = V(o.x, o.y, -o.z);
  if (mirror) {
    O = add(O, mul(U, w));
    U = mul(U, -1);
  }
  const N = cross(U, Vv);
  const f = (n) => +n.toFixed(5);
  return `matrix3d(${f(U.x)},${f(U.y)},${f(U.z)},0,${f(Vv.x)},${f(Vv.y)},${f(Vv.z)},0,${f(N.x)},${f(N.y)},${f(N.z)},0,${f(O.x)},${f(O.y)},${f(O.z)},1)`;
}

export class CaseOpen {
  constructor(host, { style, game, onLaunch, onClosed }) {
    this.style = style;
    this.game = game;
    this.onLaunch = onLaunch;
    this.onClosed = onClosed;
    this.t = 0; // 开盒进度
    this.lt = 0; // 启动动画进度
    this.hover = 0;
    this.sheen = -Math.PI / 4;
    this.closing = false;
    this.launching = false;
    this.status = null;
    this.sceneFade = 1; // 换到主机画面时，开盒画面淡出
    this.mediaGone = false; // 光盘 / 卡带已经插进主机了

    this.backdrop = el('div.backdrop', { onclick: () => !this.suppressClick && this.close() });
    this.cam = el('div.cam');
    this.stage = el('div.stage', {}, this.cam);
    this.hint = el('div.open-hint');
    this.root = el('div.open-view', {}, this.backdrop, this.stage, this.hint);
    host.append(this.root);

    // 打开以后可以拖着转、滚轮缩放、双击复位。oyaw/opitch 是在默认视角上叠加的角度。
    this.oyaw = 0;
    this.opitch = 0;
    this.zoom = 1;
    this.drag = null;
    this.root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.isOpen || this.launching) return;
      this.drag = { x: e.clientX, y: e.clientY, yaw: this.oyaw, pitch: this.opitch, moved: false };
    });
    this.onPointerMove = (e) => {
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      this.root.classList.add('dragging');
      this.oyaw = d.yaw - dx * 0.006;
      this.opitch = clamp(d.pitch + dy * 0.005, -0.75, 0.95);
      this.frame();
    };
    this.onPointerUp = () => {
      const d = this.drag;
      this.drag = null;
      this.root.classList.remove('dragging');
      if (d?.moved) {
        // 拖完松手别算成点击（不合上、不启动）
        this.suppressClick = true;
        setTimeout(() => (this.suppressClick = false), 0);
      }
    };
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.root.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (!this.isOpen) return;
        this.zoom = clamp(this.zoom * Math.exp(-e.deltaY * 0.0015), 0.6, 2);
        this.frame();
      },
      { passive: false },
    );
    this.root.addEventListener('dblclick', () => this.resetView());

    this.build();
    this.onResize = () => {
      this.build();
      this.frame();
    };
    window.addEventListener('resize', this.onResize);
    this.frame();
    this.anim = tween(2100, (t) => {
      this.t = t;
      this.frame();
    });
    // 盒子开好以后，趁空把主机模型先加载好，点光盘时就不用等
    this.anim.done.then((ok) => ok && setTimeout(() => !this.closing && this.prepareConsole(), 150));
  }

  get isOpen() {
    return this.t >= 1 && !this.closing;
  }

  // 转回默认视角。转了好几圈的话先归到 ±π 以内，免得倒着转好几圈回来。
  resetView(ms = 450) {
    const y0 = Math.atan2(Math.sin(this.oyaw), Math.cos(this.oyaw));
    const p0 = this.opitch;
    const z0 = this.zoom;
    this.viewAnim?.stop();
    this.viewAnim = tween(ms, (p) => {
      const e = easeOutCubic(p);
      this.oyaw = y0 * (1 - e);
      this.opitch = p0 * (1 - e);
      this.zoom = z0 + (1 - z0) * e;
      this.frame();
    });
    return this.viewAnim.done;
  }

  // 盒子尺寸：翻开后（封面 + 书脊 + 托盘）要放得下。
  build() {
    const s = this.style;
    const sw = this.root.clientWidth || window.innerWidth;
    const sh = this.root.clientHeight || window.innerHeight;
    const H = Math.min(sh * 0.74, (sw * 0.72) / (2 * s.aspect + s.depth));
    const W = H * s.aspect;
    const D = H * s.depth;
    Object.assign(this, { H, W, D, sw, sh });
    this.stage.style.perspective = px(H * 2.4);
    this.cam.replaceChildren();
    this.faces = {};

    // 每个面里塞一层"光照"遮罩（放在内容最上面，跟着圆角裁掉），每帧按朝向调深浅。
    const face = (id, w, h, front, back, { lit = true } = {}) => {
      const mk = (content) => {
        if (!content) return null;
        const light = lit ? el('div.light') : null;
        if (light) content.append(light);
        const n = el('div.f', { style: { width: px(w), height: px(h) } }, content);
        n.light = light;
        this.cam.append(n);
        return n;
      };
      this.faces[id] = { w, h, front: mk(front), back: mk(back) };
    };
    const half = D / 2;
    const game = this.game;

    // 桌面上的接触阴影（在盒子背后、托盘底面再往后一点）
    this.groundShadow = el('div.ground-shadow');
    this.groundPad = H * 0.12;
    this.groundX = -W - D - this.groundPad;
    face('ground', 2 * W + D + this.groundPad * 2, H + this.groundPad * 2, el('div.ground', {}, this.groundShadow), null, {
      lit: false,
    });
    // 托盘背面就是盒子的外壳底面：转到背后看时是一块塑料
    const shell = () => el('div.plastic.shell', { style: { width: px(W), height: px(H), '--h': px(H) } }, el('div.gloss'));
    face('tray', W, H, s.isCard ? cardTray(s, H) : discTray(s, game, H), shell());
    face('tray-top', W, half, lip(), lip());
    face('tray-bottom', W, half, lip(0.3), lip(0.3));
    face('tray-right', half, H, lip(), lip(0.3));
    face('tray-left', half, H, lip(0.3), lip());
    face('spine', D, H, caseSpine(s, game, H, D), lip(0.15));
    face('cover', W, H, caseFront(s, game, H), insidePanel(s, game, H));
    face('cover-top', W, half, lip(), lip());
    face('cover-bottom', W, half, lip(0.3), lip(0.3));
    face('cover-edge', half, H, lip(), lip());

    // 光盘或卡带，以及它投在托盘上的影子
    let media;
    if (s.isCard) {
      const slot = cardSlot(W, H);
      this.slot = slot;
      this.mediaShadow = el('div.media-shadow.card');
      face('media-shadow', slot.w, slot.h, el('div.ms-wrap', {}, this.mediaShadow), null, { lit: false });
      media = cartridge(s, game, slot.w);
      face('media', slot.w, slot.h, media.root, el('div.cart-back', {}, el('div.cart-back-pins')), { lit: false });
    } else {
      const d = W * 0.86;
      this.discD = d;
      this.mediaShadow = el('div.media-shadow.disc');
      face('media-shadow', d, d, el('div.ms-wrap', {}, this.mediaShadow), null, { lit: false });
      media = disc(game, d);
      face('media', d, d, media.root, el('div.disc-back'), { lit: false });
    }
    this.media = media;
    const m = this.faces.media.front;
    m.classList.add('media');
    m.addEventListener('mouseenter', () => (this.hover = 1) && this.frame());
    m.addEventListener('mouseleave', () => {
      this.hover = 0;
      this.frame();
    });
    m.addEventListener('mousemove', (e) => {
      const r = m.getBoundingClientRect();
      this.sheen = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
      this.frame();
    });
    m.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.suppressClick) this.launch();
    });
    requestAnimationFrame(() => fitInsert(this.cam));
  }

  // 摆一个面，并按朝向打光：正面朝外的法线是 -(u×v)（场景里 z 朝屏幕里）。
  place(id, o, u, v) {
    const f = this.faces[id];
    const n = cross(u, v);
    const shade = (el, sign) => {
      if (!el?.light) return;
      const lit = Math.max(0, -sign * (n.x * LIGHT.x + n.y * LIGHT.y + n.z * LIGHT.z));
      el.light.style.opacity = (0.5 * (1 - lit) ** 1.6).toFixed(3);
    };
    if (f.front) {
      f.front.style.transform = matrix(o, u, v, f.w, false);
      shade(f.front, 1);
    }
    if (f.back) {
      f.back.style.transform = matrix(o, u, v, f.w, true);
      shade(f.back, -1);
    }
  }

  frame() {
    const { W, H, D, style: s, game } = this;
    const t = this.t;
    const enter = ease(t / 0.36, easeOutCubic);
    const k = ease((t - 0.3) / 0.7, easeInOutCubic); // 翻开进度
    const theta = Math.PI * k;

    // 入场保留转动，展开后停在固定视角；拖动只叠加在这个角度上。
    const target = vlerp(V(W / 2, H / 2, D / 2), V(-D / 2, H / 2 + H * 0.02, D), k);
    const yaw = lerp(lerp(-0.95, -0.28, enter), OPEN_YAW + this.oyaw, k);
    const pitch = lerp(0.06, OPEN_PITCH + this.opitch, k);
    const scale = lerp(0.78, 1, enter) * lerp(1, this.zoom, k);
    this.stage.style.transform = `translateY(${this.sh * 0.65 * (1 - enter)}px) scale(${scale})`;
    this.stage.style.opacity = enter * this.sceneFade;
    this.cam.style.transform = `rotateX(${-pitch}rad) rotateY(${-yaw}rad) translate3d(${-target.x}px, ${-target.y}px, ${target.z}px)`;
    this.backdrop.style.opacity = enter;
    this.backdrop.style.backdropFilter = `blur(${14 * enter}px)`;

    // 盒子
    const half = D / 2;
    const alpha = theta / 2;
    const spineDir = V(-Math.sin(alpha), 0, -Math.cos(alpha));
    const a = V(0, 0, D);
    const b = add(a, mul(spineDir, D));
    const cu = yawDir(theta);
    const inward = cross(cu, UP);

    this.place('tray', a, RIGHT, UP);
    this.place('tray-top', V(0, 0, half), RIGHT, BACK);
    this.place('tray-bottom', V(0, H, half), RIGHT, BACK);
    this.place('tray-right', V(W, 0, half), BACK, UP);
    this.place('tray-left', V(0, 0, half), BACK, UP);
    this.place('spine', a, spineDir, UP);
    this.place('cover', b, cu, UP);
    this.place('cover-top', b, cu, inward);
    this.place('cover-bottom', add(b, mul(UP, H)), cu, inward);
    this.place('cover-edge', add(b, mul(cu, W)), inward, UP);

    // 桌面阴影：跟着盒子在桌上的投影范围走
    const pad = this.groundPad;
    const minX = Math.min(0, b.x, b.x + cu.x * W);
    this.place('ground', V(this.groundX, -pad, D + 1.5), RIGHT, UP);
    Object.assign(this.groundShadow.style, {
      left: px(minX - this.groundX),
      width: px(W - minX),
      top: px(pad),
      height: px(H),
    });

    // 光盘 / 卡带：平时躺在托盘里，点了以后被拿起来。
    const lt = this.lt;
    const rise = ease(lt / 0.3, easeOutCubic);
    const fly = ease((lt - 0.45) / 0.55, easeInCubic);
    const ready = k >= 1 && !this.launching;
    const hover = this.hover && ready ? 1 : 0;
    const mf = this.faces.media.front;
    mf.classList.toggle('ready', ready);
    let mo;
    let z;
    if (s.isCard) {
      const sl = this.slot;
      // 拿起来朝镜头，再往上方插走（上沿往里倒），一路变淡。
      const tilt = 0.75 * fly;
      z = D - 1 - D * 3 * rise - D * 0.8 * hover - H * 0.3 * fly;
      mo = V(sl.x, sl.y - H * 0.75 * fly, z);
      this.place('media', mo, RIGHT, V(0, Math.cos(tilt), Math.sin(tilt)));
      mf.style.opacity = this.mediaGone ? 0 : clamp(1 - fly * 1.1, 0, 1);
      this.media.update({ glow: Math.max(rise, hover * 0.5) });
    } else {
      const d = this.discD;
      const spin = lt * lt * 10 * Math.PI;
      z = D - 1 - D * 2.2 * rise - D * 0.5 * hover - H * 1.1 * fly;
      mo = V(W / 2 - d / 2, H / 2 - d / 2 - H * 0.35 * fly, z);
      this.place('media', mo, RIGHT, UP);
      mf.style.opacity = this.mediaGone ? 0 : clamp(1 - fly, 0, 1);
      this.media.update({ spin, sheen: this.sheen + spin * 0.15, lift: Math.max(rise, hover * 0.3) });
    }
    // 投在托盘上的影子：拿得越高越偏、越虚、越淡（光从左上来，影子落在右下）。
    const h = Math.max(0, D - 1 - z);
    this.place('media-shadow', V(mo.x + h * 0.35, mo.y + h * 0.55, D - 0.5), RIGHT, UP);
    this.mediaShadow.style.filter = `blur(${(1.5 + h * 0.12).toFixed(1)}px)`;
    this.mediaShadow.style.opacity = (0.6 * (1 - fly) * (1 - Math.min(0.65, h / (H * 0.5)))).toFixed(3);

    // 底部提示
    const hint = this.launching
      ? ''
      : translate(game.installed ? 'launchHint' : 'installHint', { media: translate(s.isCard ? 'cartridge' : 'disc') });
    const text = this.status ?? hint;
    if (this.hint.textContent !== text) this.hint.textContent = text;
    this.hint.classList.toggle('status', !!this.status);
    this.hint.style.opacity = this.status ? 1 : 0.55 * k;
  }

  async close() {
    if (this.closing || (this.launching && this.lt < 1)) return;
    this.closing = true;
    this.drag = null;
    if (this.oyaw || this.opitch || this.zoom !== 1) await this.resetView(350);
    this.anim?.stop();
    const from = this.t;
    this.anim = tween(1300, (p) => {
      this.t = from * (1 - p);
      this.frame();
    });
    await this.anim.done;
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.consoleP?.then((st) => st?.destroy());
    this.root.remove();
    this.onClosed();
  }

  // 主机画面（three.js）。第一次用到时才加载；失败返回 null，退回旧动画。
  prepareConsole() {
    this.consoleP ??= import('./console3d.js')
      .then(async ({ ConsoleStage, warmUp }) => {
        await warmUp();
        const st = new ConsoleStage(this.root, { style: this.style, game: this.game });
        this.root.append(this.hint); // 提示字放在最上面
        if (await st.prepare()) return st;
        st.destroy();
        return null;
      })
      .catch((e) => {
        console.error(e);
        return null;
      });
    return this.consoleP;
  }

  async launch() {
    if (this.launching || !this.isOpen) return;
    this.launching = true;
    const playInsertionSound = armInsertionSound(this.style.isCard ? 'card' : 'disc');
    if (this.oyaw || this.opitch || this.zoom !== 1) await this.resetView(350);
    const stageP = this.prepareConsole();
    const setStatus = (ok) => {
      this.status = !ok
        ? translate('launchFailed')
        : this.game.installed
          ? translate('launching', { name: this.game.name })
          : translate('installOpened');
      this.frame();
    };
    let activation;
    const activate = () => {
      if (!activation) {
        playInsertionSound();
        activation = Promise.resolve().then(() => this.onLaunch()).catch(() => false).then(setStatus);
      }
      return activation;
    };

    // 1. 从托盘上拿起来；拿到一半就开始换画面
    const lift = tween(600, (p) => {
      this.lt = p * 0.3;
      this.frame();
    });
    await sleep(300);
    const stage = await stageP;

    if (!stage) {
      // 模型加载不了：光盘转着飞走 / 卡带往上插走（原来的动画）
      await lift.done;
      const rest = tween(1400, (p) => {
        this.lt = 0.3 + p * 0.7;
        this.frame();
      });
      await sleep(200);
      await activate();
      await rest.done;
      await sleep(1300);
      await this.close();
      return;
    }

    // 2. 插入动画马上开始播，同时开盒画面淡出、主机淡入（两边一直在动，没有停顿）
    const playing = stage.play(activate);
    await tween(550, (p) => {
      const e = easeInOutCubic(p);
      this.sceneFade = 1 - e;
      stage.setOpacity(e);
      this.frame();
    }).done;
    await lift.done;
    this.mediaGone = true;
    this.lt = 1;
    this.frame();

    // 3. 插到底时让 Steam 启动，亮着停一会儿
    await playing;
    await activation;
    await sleep(1400);

    // 4. 淡回开盒画面，合上
    await tween(400, (p) => {
      stage.setOpacity(1 - p);
      this.sceneFade = p;
      this.frame();
    }).done;
    await this.close();
  }

}
