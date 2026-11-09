import { t } from './i18n.js';

// 盒子的各个部件，都是普通 DOM：架子和 3D 开盒共用。
// 尺寸都按盒子高度 H（px）算，CSS 里用 --h 变量。
import { el, svg, px, artImg, accent, coverArt, formatDate } from './util.js';
import { barcode, ratingMark, featureMarks } from './print.js';
import { CARD_ASPECT } from './styles.js';

const rimOf = (H) => H * 0.016;

// ---------------------------------------------------------------- 外面

// 盒子正面：塑料壳 + 封面插页（色带 + 封面图）。
export function caseFront(style, game, H) {
  const W = H * style.aspect;
  return el(
    'div.case-front.plastic',
    { style: { width: px(W), height: px(H), '--h': px(H) } },
    el(
      'div.case-window',
      {},
      el('div.band', {}, el('b', { text: style.bandLeft }), el('span', { text: style.bandRight })),
      coverArt(game),
    ),
    el('div.gloss'),
  );
}

// 书脊：顶部色带 + 竖排游戏名 + 主题色条。
export function caseSpine(style, game, H, D) {
  return el(
    'div.case-spine.plastic',
    { style: { width: px(D), height: px(H), '--h': px(H), '--w': px(D) } },
    el(
      'div.spine-in',
      {},
      el('div.spine-band', {}, el('b', { text: style.bandLeft })),
      el(
        'div.spine-body',
        {},
        el('div.spine-title', {}, el('span', { text: game.name })),
        el('div.spine-accent', { style: { background: accent(game) } }),
        el('div.spine-foot'),
      ),
    ),
    el('div.gloss.soft'),
  );
}

// 盒子的边沿（3D 里的窄条面）；shade 0~1 越大越暗。
export function lip(shade = 0) {
  const d = el('div.lip');
  if (shade) d.style.setProperty('--shade', shade);
  return d;
}

// ---------------------------------------------------------------- 里面：印刷插页

// 封面内侧那张印刷插页：上半张印大图 + logo，下面是排版好的文字、截图小样、
// 功能图标、分级标、条形码和版权小字。整张纸有颗粒和网点。
export function printedInsert(style, game, w) {
  const devs = game.developers || [];
  const pubs = game.publishers || [];
  const meta = [
    devs[0] && t('developer', { name: devs[0] }),
    pubs[0] && t('publisher', { name: pubs[0] }),
    game.releaseDate && t('release', { date: formatDate(game.releaseDate) }),
  ].filter(Boolean);
  const shots = Math.min(3, game.screenshotCount || 0);
  const year = game.releaseDate ? new Date(game.releaseDate).getFullYear() : new Date().getFullYear();
  const u = w / 100;

  return el(
    'div.insert.paper',
    { style: { '--u': px(u) } },
    el(
      'div.ins-hero',
      {},
      el('div.printed', { style: { background: accent(game, 20) } }, artImg(game, 'hero', { cls: 'hero' })),
      el('div.ins-logo', {}, artImg(game, 'logo', { cls: 'logo' })),
    ),
    el('div.ins-rule'),
    el(
      'div.ins-body',
      {},
      el('div.ins-title', { text: game.name }),
      meta.length ? el('div.ins-meta', { text: meta.join('　　') }) : null,
      el('div.ins-desc', { text: game.description || t('noDescription') }),
      game.tags?.length ? el('div.ins-tags', {}, game.tags.map((t) => el('span', { text: t }))) : null,
      shots
        ? el(
            'div.ins-shots',
            {},
            [0, 1, 2].map((i) =>
              i < shots ? el('div.ins-shot.printed', {}, artImg(game, 'ss', { index: i })) : el('div.ins-shot.empty'),
            ),
          )
        : null,
      el('div.ins-spacer'),
      el(
        'div.ins-foot',
        {},
        el('div.ins-feat', {}, featureMarks(game, u * 6, style.isCard ? 3 : 4)),
        game.ageRating ? ratingMark(game.ageRating, u * 9.5) : null,
        el('div.ins-ean', {}, barcode(game.appId)),
      ),
      el('div.ins-legal', {
        text: `© ${year} ${pubs[0] || game.name}. ${t('insertCredit')} APP ${game.appId}`,
      }),
    ),
    el('div.grain'),
  );
}

// 插页进了 DOM 以后再算简介能放几行，放不下就省略号。
export function fitInsert(root) {
  for (const d of root.querySelectorAll('.ins-desc')) {
    d.style.webkitLineClamp = 'unset';
    const lh = parseFloat(getComputedStyle(d).lineHeight) || 16;
    d.style.webkitLineClamp = String(Math.max(1, Math.floor(d.clientHeight / lh)));
  }
}

// 封面内侧整面：塑料壳 → 透明套膜里夹着印刷插页 → 套膜高光 + 卡扣。
export function insidePanel(style, game, H) {
  const W = H * style.aspect;
  const rim = rimOf(H);
  return el(
    'div.inside.plastic',
    { style: { width: px(W), height: px(H), '--h': px(H) } },
    el('div.case-window', {}, printedInsert(style, game, W - rim * 2), el('div.sleeve')),
    el('div.clip', { style: { top: px(H * 0.12 - H * 0.028) } }),
    el('div.clip', { style: { top: px(H * 0.88 - H * 0.028) } }),
    el('div.gloss.faint'),
  );
}

// ---------------------------------------------------------------- 托盘

// 光盘盒右边：透明托盘下面透出插页背面的印刷（截图双色调），
// 托盘上压出放光盘的圆槽、两侧取盘的指槽、中间的花瓣卡扣。
export function discTray(style, game, H) {
  const W = H * style.aspect;
  const rim = rimOf(H);
  const iw = W - rim * 2;
  const ih = H - rim * 2;
  const back =
    (game.screenshotCount || 0) > 1 ? artImg(game, 'ss', { index: 1 }) : artImg(game, 'hero');
  return el(
    'div.tray.plastic',
    { style: { width: px(W), height: px(H), '--h': px(H) } },
    el(
      'div.case-window',
      {},
      el('div.printed.duotone', {}, back),
      el('div.tray-small', { text: `${game.name}  ·  APP ${game.appId}` }),
      el('div.tray-tint'),
      svg(discMold(iw, ih)),
    ),
    svg(hub(W * 0.2, W / 2 - W * 0.1, H / 2 - W * 0.1)),
    el('div.gloss.faint'),
  );
}

function discMold(w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const R = w * 0.45;
  const nr = w * 0.06;
  const ins = w * 0.035;
  const notch = (dx) => {
    const x = cx + dx * R;
    // 半个椭圆，朝外
    const sweep = dx < 0 ? 0 : 1;
    return `<path d="M ${x} ${cy - nr} A ${nr} ${nr} 0 0 ${sweep} ${x} ${cy + nr} Z" fill="rgba(0,0,0,.28)" stroke="rgba(255,255,255,.25)" stroke-width="1.2"/>`;
  };
  return `<svg class="mold" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="rgba(0,0,0,.12)"/>
    <path d="M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="2"/>
    <path d="M ${cx + R} ${cy} A ${R} ${R} 0 0 1 ${cx - R} ${cy}" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="1.5"/>
    ${notch(-1)}${notch(1)}
    <rect x="${ins}" y="${ins}" width="${w - ins * 2}" height="${h - ins * 2}" rx="${ins}" fill="none" stroke="rgba(255,255,255,.1)"/>
  </svg>`;
}

// 中间卡住光盘的花瓣形卡扣。
function hub(size, left, top) {
  const r = size / 2;
  let petals = '';
  for (let i = 0; i < 8; i++) {
    petals += `<rect x="${-r * 0.15}" y="${-r * 0.55 - r * 0.275}" width="${r * 0.3}" height="${r * 0.55}" rx="${r * 0.12}" transform="rotate(${i * 45})"/>`;
  }
  return `<svg class="hub" style="left:${left}px;top:${top}px" width="${size}" height="${size}" viewBox="${-r} ${-r} ${size} ${size}">
    <defs><radialGradient id="hubg"><stop offset="0" stop-color="var(--plastic-l)"/><stop offset="1" stop-color="var(--plastic-d)"/></radialGradient></defs>
    <circle r="${r * 0.95}" fill="url(#hubg)"/>
    <g fill="var(--plastic-l)" fill-opacity=".9" stroke="rgba(0,0,0,.3)" stroke-width=".8">${petals}</g>
    <circle r="${r * 0.28}" fill="var(--plastic-d)" stroke="rgba(255,255,255,.3)"/>
  </svg>`;
}

// 卡带槽在托盘里的位置。
export function cardSlot(W, H) {
  const w = W * 0.3;
  const h = w / CARD_ASPECT;
  return { x: W / 2 - w / 2, y: H * 0.3 - h / 2, w, h };
}

// 卡带盒右边：不透明的红色塑料，上方是卡带槽，下面压着浮雕字。
export function cardTray(style, H) {
  const W = H * style.aspect;
  const s = cardSlot(W, H);
  const g = W * 0.025;
  let lines = '';
  for (let x = W * 0.06; x < W * 0.94; x += W * 0.03) {
    lines += `<line x1="${x}" y1="${H * 0.72}" x2="${x}" y2="${H * 0.94}"/>`;
  }
  return el(
    'div.tray.card-tray.plastic',
    { style: { width: px(W), height: px(H), '--h': px(H) } },
    svg(`<svg class="mold" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs><linearGradient id="slotEdge" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="rgba(0,0,0,.45)"/><stop offset="1" stop-color="rgba(255,255,255,.35)"/>
      </linearGradient></defs>
      <rect x="${s.x - g}" y="${s.y - g}" width="${s.w + g * 2}" height="${s.h + g * 2}" rx="${W * 0.03}"
        fill="var(--plastic-d)" fill-opacity=".55" stroke="url(#slotEdge)" stroke-width="1.5"/>
      <g fill="var(--plastic-l)" fill-opacity=".85">
        <rect x="${s.x - W * 0.012}" y="${s.y + s.h / 2 - H * 0.015}" width="${W * 0.02}" height="${H * 0.03}" rx="2"/>
        <rect x="${s.x + s.w - W * 0.008}" y="${s.y + s.h / 2 - H * 0.015}" width="${W * 0.02}" height="${H * 0.03}" rx="2"/>
      </g>
      <g stroke="rgba(255,255,255,.05)">${lines}</g>
    </svg>`),
    el('div.emboss', { text: 'GAME CARD' }),
    el('div.gloss.faint'),
  );
}

// ---------------------------------------------------------------- 光盘

// 光盘：印着封面图的盘面、银色反光圈、透明中心、彩虹反光。
// update({spin, sheen, lift})：盘面转角、高光方向（跟鼠标走）、拿起来的程度。
export function disc(game, d) {
  const label = el(
    'div.disc-label',
    {},
    el('div.printed', {}, coverArt(game)),
    el('div.disc-vignette'),
    el('div.disc-pc', { text: 'PC' }),
    game.ageRating ? el('div.disc-rating', {}, ratingMark(game.ageRating, d * 0.065)) : null,
    svg(arcText(
      `PC GAME DISC  ·  ${game.name.toUpperCase()}  ·  © ${game.releaseDate ? new Date(game.releaseDate).getFullYear() : ''} ${(game.publishers || [])[0] || ''}  ·  APP ${game.appId}  ·  `,
    )),
  );
  const root = el(
    'div.disc',
    { style: { width: px(d), height: px(d), '--d': px(d) } },
    el('div.disc-shadow'),
    label,
    el('div.disc-hub'),
    el('div.disc-mirror'),
    el('div.disc-rainbow'),
    el('div.disc-gloss'),
    el('div.disc-rim'),
  );
  return {
    root,
    update({ spin = 0, sheen = -Math.PI / 4, lift = 0 }) {
      label.style.transform = `rotate(${spin}rad)`;
      root.style.setProperty('--sheen', `${sheen}rad`);
      root.style.setProperty('--rainbow', `${sheen * 2 + spin * 0.5}rad`);
      root.style.setProperty('--lift', lift);
    },
  };
}

function arcText(text) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const r = 45.75;
  return `<svg class="disc-arc" viewBox="0 0 100 100">
    <defs><path id="arc" d="M 50 ${50 - r} A ${r} ${r} 0 1 1 49.99 ${50 - r}"/></defs>
    <text><textPath href="#arc">${esc}</textPath></text>
  </svg>`;
}

// ---------------------------------------------------------------- 卡带

// 游戏卡带：深灰塑料机身，右上角切角，顶部防滑纹，正面贴着印刷标签。
export function cartridge(style, game, w) {
  const h = w / CARD_ASPECT;
  const root = el(
    'div.cart',
    { style: { width: px(w), height: px(h), '--w': px(w) } },
    el('div.cart-shadow'),
    el(
      'div.cart-body',
      {},
      el('div.cart-grip'),
      el(
        'div.cart-label',
        {},
        el('div.cart-strip', { text: style.bandLeft }),
        el('div.printed', {}, coverArt(game)),
        el('div.cart-name', { text: game.name }),
      ),
      el('div.cart-gloss'),
    ),
  );
  return {
    root,
    update({ glow = 0 }) {
      root.style.setProperty('--cglow', glow);
    },
  };
}
