// 插入动画：点光盘 / 卡带后，主机（PS5 / Switch 模型）出现在画面里，
// 光盘竖过来推进光驱口、卡带从上方插进卡槽，然后主机亮起来。
// 用 three.js 画在一张透明的 canvas 上，盖在开盒画面上面。
import * as THREE from './vendor/three/build/three.module.js';
import { RoomEnvironment } from './vendor/three/examples/jsm/environments/RoomEnvironment.js';
import { loadModel } from './models.js';
import { artUrl, clamp, lerp, ease, easeOutCubic, easeInOutCubic, tween } from './util.js';

const DISC_R = 0.06; // 光盘半径 6cm
const CARD = { w: 0.021, h: 0.031, d: 0.0033 }; // 卡带 21 × 31 × 3.3 mm

// 先在后台线程解码好再交出去：大图（hero 宽 3840）第一次画到画布上时，
// 不解码的话浏览器会在主线程上同步解码，卡一两百毫秒。
async function loadImage(src) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.src = src;
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

const hue = (game) => (game.appId * 47) % 360;

// 按 cover 方式把图片画进一个矩形
function drawCover(ctx, img, x, y, w, h, alignY = 0.5) {
  const s = Math.max(w / img.width, h / img.height);
  const iw = img.width * s;
  const ih = img.height * s;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) * alignY, iw, ih);
}

function canvasTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------- 光盘

async function discLabel(game) {
  const S = 1024;
  const c = Object.assign(document.createElement('canvas'), { width: S, height: S });
  const ctx = c.getContext('2d');
  const R = S / 2;
  ctx.fillStyle = `hsl(${hue(game)} 55% 22%)`;
  ctx.fillRect(0, 0, S, S);
  const cover = await loadImage(artUrl(game, 'cover'));
  if (cover) {
    drawCover(ctx, cover, 0, 0, S, S, 0.35);
  }
  // 中心往外压暗一点，像印刷的边
  const v = ctx.createRadialGradient(R, R, R * 0.3, R, R, R);
  v.addColorStop(0, 'rgba(0,0,0,.35)');
  v.addColorStop(0.15, 'rgba(0,0,0,0)');
  v.addColorStop(0.8, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,.5)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, S, S);
  // 银色反光圈 0.22~0.30
  const ring = ctx.createConicGradient(0, R, R);
  ['#dadfe6', '#7f8691', '#f6f8fa', '#747b86', '#e4e7eb', '#959ba5', '#dadfe6'].forEach((col, i, a) =>
    ring.addColorStop(i / (a.length - 1), col),
  );
  ctx.beginPath();
  ctx.arc(R, R, R * 0.3, 0, Math.PI * 2);
  ctx.arc(R, R, R * 0.22, 0, Math.PI * 2, true);
  ctx.fillStyle = ring;
  ctx.fill();
  // PC 标
  ctx.fillStyle = '#fff';
  ctx.fillRect(R * 0.38, R - R * 0.05, R * 0.18, R * 0.1);
  ctx.fillStyle = '#1b1a19';
  ctx.font = `italic 900 ${R * 0.075}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('PC', R * 0.47, R + R * 0.005);
  // 沿外圈一圈小字
  const text = `PC GAME DISC  ·  ${game.name.toUpperCase()}  ·  APP ${game.appId}  ·  `;
  ctx.font = `700 ${R * 0.045}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  let a = -Math.PI / 2;
  for (const ch of text) {
    const w = ctx.measureText(ch).width / (R * 0.915);
    if (a + w > Math.PI * 1.5) break;
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(a + w / 2 + Math.PI / 2);
    ctx.fillText(ch, 0, -R * 0.915);
    ctx.restore();
    a += w;
  }
  return canvasTexture(c);
}

async function makeDisc(game) {
  const g = new THREE.Group();
  const T = 0.0012;
  const label = new THREE.Mesh(
    new THREE.RingGeometry(DISC_R * 0.22, DISC_R, 128, 1),
    new THREE.MeshStandardMaterial({ map: await discLabel(game), roughness: 0.42, metalness: 0.05 }),
  );
  label.position.z = T / 2;
  // 背面数据面：银色，带一点彩虹
  const back = new THREE.Mesh(
    new THREE.RingGeometry(DISC_R * 0.22, DISC_R, 128, 1),
    new THREE.MeshPhysicalMaterial({
      color: 0xd6dae2,
      metalness: 1,
      roughness: 0.12,
      iridescence: 1,
      iridescenceIOR: 1.6,
      iridescenceThicknessRange: [200, 800],
    }),
  );
  back.position.z = -T / 2;
  back.rotation.y = Math.PI;
  // 透明中心
  const hub = new THREE.Mesh(
    new THREE.RingGeometry(DISC_R * 0.075, DISC_R * 0.22, 64, 1),
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.1, side: THREE.DoubleSide }),
  );
  const edge = new THREE.Mesh(
    new THREE.CylinderGeometry(DISC_R, DISC_R, T, 128, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xcfd4dc, metalness: 1, roughness: 0.25 }),
  );
  edge.rotation.x = Math.PI / 2;
  for (const m of [label, back, edge]) m.castShadow = true;
  g.add(label, back, hub, edge);
  return g;
}

// ---------------------------------------------------------------- 卡带

async function cardLabel(game) {
  const W = 420;
  const H = 620;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = c.getContext('2d');
  const body = ctx.createLinearGradient(0, 0, W, H);
  body.addColorStop(0, '#4a4b50');
  body.addColorStop(0.5, '#2a2b2f');
  body.addColorStop(1, '#1d1e21');
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, W, H);
  // 顶部防滑纹
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  for (let i = 0; i < 4; i++) ctx.fillRect(W * 0.14, H * (0.045 + i * 0.028), W * 0.56, H * 0.009);
  // 标签
  const lx = W * 0.08;
  const ly = H * 0.19;
  const lw = W * 0.84;
  const lh = H * 0.75;
  ctx.fillStyle = '#f3efe6';
  ctx.fillRect(lx, ly, lw, lh);
  ctx.fillStyle = '#d9141e';
  ctx.fillRect(lx, ly, lw, lw * 0.13);
  ctx.fillStyle = '#fff';
  ctx.font = `italic 900 ${lw * 0.09}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText('PC', lx + lw * 0.06, ly + lw * 0.065);
  const imgY = ly + lw * 0.13;
  const imgH = lh - lw * 0.13 - lw * 0.2;
  const cover = await loadImage(artUrl(game, 'cover'));
  if (cover) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(lx, imgY, lw, imgH);
    ctx.clip();
    drawCover(ctx, cover, lx, imgY, lw, imgH, 0);
    ctx.restore();
  } else {
    ctx.fillStyle = `hsl(${hue(game)} 55% 30%)`;
    ctx.fillRect(lx, imgY, lw, imgH);
  }
  ctx.fillStyle = '#1b1a19';
  ctx.font = `800 ${lw * 0.075}px system-ui, sans-serif`;
  let name = game.name;
  while (ctx.measureText(name).width > lw * 0.88 && name.length > 2) name = name.slice(0, -2);
  if (name !== game.name) name += '…';
  ctx.fillText(name, lx + lw * 0.06, imgY + imgH + lw * 0.1);
  return canvasTexture(c);
}

async function makeCard(game) {
  const dark = new THREE.MeshStandardMaterial({ color: 0x232428, roughness: 0.55 });
  const front = new THREE.MeshStandardMaterial({ map: await cardLabel(game), roughness: 0.5 });
  // BoxGeometry 的面顺序：+x -x +y -y +z -z
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(CARD.w, CARD.h, CARD.d), [dark, dark, dark, dark, front, dark]);
  mesh.castShadow = true;
  const g = new THREE.Group();
  g.add(mesh);
  return g;
}

// ---------------------------------------------------------------- 主机

// 把模型摆正：底面落在 y=0，x、z 居中，缩放成真实尺寸（米）。
function fit(obj, { height, width }) {
  const holder = new THREE.Group();
  holder.add(obj);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const s = height ? height / size.y : width / size.x;
  obj.scale.multiplyScalar(s);
  holder.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(obj);
  const c = b2.getCenter(new THREE.Vector3());
  obj.position.sub(new THREE.Vector3(c.x, b2.min.y, c.z));
  holder.updateMatrixWorld(true);
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return holder;
}

// 摆正后的主机模型只算一次（光驱缝的位置要扫顶点），之后每次开盒克隆一份。
const protos = new Map();

function getProto(kind) {
  if (!protos.has(kind)) protos.set(kind, kind === 'ps5' ? buildPS5() : buildSwitch());
  return protos.get(kind);
}

async function buildPS5() {
  const ps5 = fit(await loadModel('ps5'), { height: 0.39 });
  ps5.updateMatrixWorld(true);
  // 光驱口：右侧白面板正面那条竖着的黑缝，是模型里 Object_7 的一个四边形，
  // 摆正后四个角大约是 x 21.3/28.9mm、y 39.6~160.2mm（正好一张光盘的直径）、z 105.9/104.8mm。
  // 面板正面往里斜了约 8°，所以光盘的朝向和推进方向都按这个斜面来。
  const front = new THREE.Box3().setFromObject(ps5).max.z;
  const corners = [];
  const v = new THREE.Vector3();
  ps5.traverse((o) => {
    if (!o.isMesh || o.name !== 'Object_7') return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (v.x > 0.02 && v.y > 0.03 && v.y < 0.2 && v.z > front - 0.03) corners.push(v.clone());
    }
  });
  const box = corners.length >= 4 ? new THREE.Box3().setFromPoints(corners) : null;
  const lo = box ? box.min : new THREE.Vector3(0.0213, 0.0396, 0.1048);
  const hi = box ? box.max : new THREE.Vector3(0.0289, 0.1602, 0.1059);
  // 缝的宽度方向（沿面板斜面）：从左边那条边走到右边那条边
  const midX = (lo.x + hi.x) / 2;
  const avg = (list, fallback) =>
    list.length ? list.reduce((a, c) => a.add(c), new THREE.Vector3()).multiplyScalar(1 / list.length) : fallback;
  const a = avg(corners.filter((c) => c.x < midX), new THREE.Vector3(lo.x, 0, hi.z));
  const b = avg(corners.filter((c) => c.x >= midX), new THREE.Vector3(hi.x, 0, lo.z));
  const across = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
  // 面板朝外的法线（水平面里和 across 垂直、朝 +z 的那个）
  const out = new THREE.Vector3(-across.z, 0, across.x);
  if (out.z < 0) out.negate();
  // 灯条：开机后亮起来的蓝光（模型里半透明蓝色那一块）
  const glow = [];
  ps5.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (/Glossy_Blue/.test(m.name)) {
        m.emissive = new THREE.Color(0x2f7bff);
        m.emissiveIntensity = 0;
        glow.push(m);
      }
    }
  });
  return {
    root: ps5,
    // yaw：光盘绕 y 转多少，盘面就和缝在同一个平面里（盘面法线 = across）
    slot: { x: midX, y: (lo.y + hi.y) / 2, z: (a.z + b.z) / 2, out, yaw: Math.atan2(-across.x, -across.z) },
    glow,
  };
}

async function buildSwitch() {
  // FBX 是横着的掌机（含左右手柄），宽 23.9cm；屏幕朝 +z。
  const sw = fit(await loadModel('switch'), { width: 0.239 });
  sw.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(sw);
  const size = box.getSize(new THREE.Vector3());
  // 卡槽：顶边、偏右
  const slot = { x: 0.045, y: box.max.y, z: (box.min.z + box.max.z) / 2 };
  const mark = new THREE.Mesh(
    new THREE.BoxGeometry(CARD.w + 0.004, 0.002, CARD.d + 0.002),
    new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.4 }),
  );
  mark.position.set(slot.x, slot.y - 0.0008, slot.z);
  sw.add(mark);
  return {
    root: sw,
    slot,
    screen: { y: (box.min.y + box.max.y) / 2, z: box.max.z - size.z * 0.12 },
  };
}

// 每次开盒：克隆主机，加上这款游戏自己的东西（Switch 屏幕上的大图）
async function makeConsole(kind, game, disposables) {
  const proto = await getProto(kind);
  const root = proto.root.clone(true);
  if (kind === 'ps5') {
    return {
      root,
      slot: proto.slot,
      setPower: (p, stage) => {
        proto.glow.forEach((m) => (m.emissiveIntensity = 3.5 * p));
        stage.power.intensity = 0.6 * p;
      },
    };
  }
  const hero = await loadImage(artUrl(game, 'hero'));
  const sc = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
  const ctx = sc.getContext('2d');
  ctx.fillStyle = `hsl(${hue(game)} 45% 18%)`;
  ctx.fillRect(0, 0, 1280, 720);
  if (hero) drawCover(ctx, hero, 0, 0, 1280, 720, 0.5);
  const tex = canvasTexture(sc);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, toneMapped: false });
  const geo = new THREE.PlaneGeometry(0.137, 0.077);
  disposables.push(tex, mat, geo);
  const screen = new THREE.Mesh(geo, mat);
  screen.position.set(0, proto.screen.y, proto.screen.z);
  root.add(screen);
  return { root, slot: proto.slot, setPower: (p) => (mat.opacity = p) };
}

// ---------------------------------------------------------------- 共用的渲染器

// WebGL 上下文、环境光只建一次，所有开盒共用（每次新建会卡一下）。
let shared = null;

function getShared() {
  if (shared) return shared;
  const canvas = document.createElement('canvas');
  canvas.className = 'console-stage';
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.05;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  const pmrem = new THREE.PMREMGenerator(r);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  shared = { canvas, renderer: r, env };
  return shared;
}

// 空闲时再干活，不跟动画抢帧
const idle = () =>
  new Promise((resolve) => (window.requestIdleCallback ? requestIdleCallback(() => resolve(), { timeout: 400 }) : setTimeout(resolve, 16)));

let warm = null;

// 程序启动后找空闲做一次：建渲染器、解析两个模型、用假光盘 / 假卡带把着色器都编译好。
// 之后开盒只剩"拼这款游戏的贴图"这点活。
export function warmUp() {
  warm ??= (async () => {
    await idle();
    getShared();
    for (const kind of ['ps5', 'switch']) {
      await idle();
      await getProto(kind);
    }
    const dummy = { appId: 0, name: ' ' };
    for (const isCard of [false, true]) {
      await idle();
      const st = new ConsoleStage(null, { style: { isCard }, game: dummy });
      if (await st.prepare()) st.setTime(0.9);
      st.destroy();
    }
  })().catch((e) => console.error('预热主机模型失败', e));
  return warm;
}

// ---------------------------------------------------------------- 舞台

export class ConsoleStage {
  constructor(host, { style, game }) {
    this.style = style;
    this.game = game;
    this.host = host;
    const { canvas, renderer, env } = getShared();
    this.canvas = canvas;
    this.renderer = renderer;
    this.disposables = [];
    if (host) {
      canvas.style.opacity = 0;
      host.append(canvas);
    }

    // 灯光配置两台主机完全一样（PS5 的蓝光在 Switch 里亮度为 0），着色器才能复用
    const scene = new THREE.Scene();
    scene.environment = env;
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-0.6, 1.2, 0.9);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -0.4, right: 0.4, top: 0.4, bottom: -0.4, near: 0.1, far: 4 });
    key.shadow.radius = 6;
    key.shadow.bias = -0.0004;
    this.power = new THREE.PointLight(0x3d8bff, 0, 0.6, 1.5);
    this.power.position.set(0, 0.3, 0.02);
    scene.add(key, new THREE.HemisphereLight(0xbcd2ff, 0x202030, 0.5), this.power);
    const floorGeo = new THREE.PlaneGeometry(4, 4);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.45 });
    this.disposables.push(floorGeo, floorMat);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.01, 10);
    this.lt = 0;
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.console) this.render();
  }

  // 拼这款游戏的主机和光盘 / 卡带，分几段在空闲时做。失败返回 false，调用方退回旧动画。
  async prepare() {
    try {
      const isCard = this.style.isCard;
      this.console = await makeConsole(isCard ? 'switch' : 'ps5', this.game, this.disposables);
      await idle();
      this.media = isCard ? await makeCard(this.game) : await makeDisc(this.game);
      this.media.traverse((o) => {
        if (!o.isMesh) return;
        this.disposables.push(o.geometry);
        for (const m of [].concat(o.material)) this.disposables.push(m, ...(m.map ? [m.map] : []));
      });
      this.scene.add(this.console.root, this.media);
      // 贴图先传到显卡，第一帧就不用临时上传
      for (const d of this.disposables) {
        if (d.isTexture) {
          await idle();
          this.renderer.initTexture(d);
        }
      }
      await idle();
      this.setTime(0);
      return true;
    } catch (e) {
      console.error('主机模型加载失败', e);
      return false;
    }
  }

  // 动画进度 0~1：飞进来 → 对准 → 插进去 → 亮起来
  setTime(lt) {
    this.lt = lt;
    const isCard = this.style.isCard;
    const s = this.console.slot;
    const fly = ease(lt / 0.32, easeOutCubic);
    const align = ease((lt - 0.3) / 0.26, easeInOutCubic);
    const push = ease((lt - 0.58) / 0.24, easeInOutCubic);
    const power = ease((lt - 0.8) / 0.2, easeOutCubic);
    // 开头镜头从远一点推进来，主机像是浮现出来的
    const intro = 1 - ease(lt / 0.45, easeOutCubic);
    const m = this.media;
    const cam = this.camera;

    if (isCard) {
      // Switch 立着，卡带从左边飞来，停在卡槽正上方，然后往下插
      const above = new THREE.Vector3(s.x, s.y + CARD.h / 2 + 0.035, s.z);
      // 从画面中间、离镜头很近的地方出发，接上刚从盒子里拿起来的那张卡
      const start = new THREE.Vector3(0.0, 0.15, 0.3);
      const hover = new THREE.Vector3(s.x - 0.05, s.y + 0.06, s.z + 0.07);
      const inside = new THREE.Vector3(s.x, s.y - CARD.h / 2 + 0.003, s.z);
      m.position.copy(start.clone().lerp(hover, fly).lerp(above, align).lerp(inside, push));
      m.rotation.set(0, lerp(-0.2, 0, fly) * (1 - align), lerp(0.08, 0, fly) * (1 - align));
      cam.position.set(lerp(0.05, 0.14, lt), 0.2 + 0.05 * intro, 0.42 + 0.16 * intro);
      cam.lookAt(0.02, 0.075, 0);
    } else {
      // PS5 竖放，光盘从左边飞来、正面朝镜头，转成和光驱缝同一个平面，推进去
      // 从画面中间、离镜头很近的地方出发，接上刚从盒子里拿起来的那张光盘
      const start = new THREE.Vector3(-0.3, 0.3, 0.62);
      const hover = new THREE.Vector3(s.x - 0.06, s.y + 0.12, s.z + 0.2);
      const at = new THREE.Vector3(s.x, s.y, s.z);
      const before = at.clone().addScaledVector(s.out, DISC_R + 0.03);
      const inside = at.clone().addScaledVector(s.out, -(DISC_R + 0.01));
      m.position.copy(start.clone().lerp(hover, fly).lerp(before, align).lerp(inside, push));
      m.rotation.set(0, lerp(-0.5, s.yaw, align), lt * 6 * (1 - push));
      cam.position.set(lerp(-0.6, -0.5, lt) - 0.12 * intro, lerp(0.42, 0.36, lt) + 0.08 * intro, lerp(1.02, 0.95, lt) + 0.35 * intro);
      cam.lookAt(-0.02, 0.17, 0.03);
    }
    this.console.setPower(power, this);
    this.render();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  // 播一遍插入动画；插到底时回调 onInserted（这时让 Steam 启动）
  async play(onInserted, duration = 2800) {
    let fired = false;
    await tween(duration, (t) => {
      this.setTime(t);
      if (!fired && t >= 0.8) {
        fired = true;
        onInserted?.();
      }
    }).done;
    if (!fired) onInserted?.();
  }

  setOpacity(v) {
    this.canvas.style.opacity = v;
  }

  // 只收拾这次自己建的东西；渲染器、主机模型留着下次用
  destroy() {
    window.removeEventListener('resize', this.onResize);
    if (this.console) this.console.setPower(0, this);
    if (this.host && this.canvas.parentNode === this.host) {
      this.canvas.remove();
      this.canvas.style.opacity = 0;
    }
    for (const d of this.disposables) d.dispose?.();
    this.disposables = [];
    this.scene.clear();
  }
}
