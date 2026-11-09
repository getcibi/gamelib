import { t } from './i18n.js';

// 印刷品上的小元素：EAN-13 条形码、分级标、功能图标。
import { el, svg } from './util.js';

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

// 号码用 200 开头（店内自编码段），后面是补到 9 位的 AppID，最后一位校验码。
export function eanDigits(appId) {
  const base = '200' + String(appId).padStart(9, '0').slice(-9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 ? 3 : 1);
  return base + ((10 - (sum % 10)) % 10);
}

// 宽 103 个模块（左边留 8 个空白），高 36 个模块。返回 SVG。
export function barcode(appId) {
  const d = eanDigits(appId);
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (PARITY[d[0]][i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  bits += '101';
  const left = 8;
  const barH = 36 * 0.78;
  let rects = '';
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== '1') continue;
    const guard = i < 3 || (i >= 45 && i < 50) || i >= 92;
    rects += `<rect x="${left + i}" y="0" width="1.02" height="${guard ? barH + 4 : barH}"/>`;
  }
  const ty = barH + 7.2;
  const text = (s, x) => `<text x="${x}" y="${ty}" text-anchor="middle">${s}</text>`;
  return svg(`<svg class="ean" viewBox="0 0 103 36" preserveAspectRatio="xMinYMin meet">
    <g fill="#1b1a19">${rects}</g>
    <g class="ean-digits" fill="#1b1a19">${text(d[0], 3.5)}${text(d.slice(1, 7), left + 3 + 21)}${text(d.slice(7), left + 50 + 21)}</g>
  </svg>`);
}

// 分级标：黑框方块，大号年龄 + 小字。尺寸用 CSS 变量 --s 控制。
export function ratingMark(rating, size) {
  return el(
    'div.rating',
    { style: { '--s': `${size}px` } },
    el('div.rating-age', { text: `${rating}+` }),
    el('div.rating-note', { text: t('ageRating') }),
  );
}

// 功能图标（自己画的简单线稿）。
const ICONS = {
  person: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.6-3.8 3.6-6 7.5-6s6.9 2.2 7.5 6"/>',
  group: '<circle cx="8.5" cy="9" r="3"/><circle cx="16" cy="8" r="2.6"/><path d="M2.8 19.5c.5-3.3 2.8-5.2 5.7-5.2s5.2 1.9 5.7 5.2"/><path d="M14.6 13.6c3.2-.4 5.8 1.4 6.4 4.6"/>',
  coop: '<circle cx="7.5" cy="8.5" r="2.8"/><circle cx="16.5" cy="8.5" r="2.8"/><path d="M2.5 19c.4-3 2.5-4.8 5-4.8 1.6 0 3 .7 4 2 1-1.3 2.4-2 4-2 2.5 0 4.6 1.8 5 4.8"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="3.8" ry="8.5"/><path d="M3.5 12h17M5 7.5h14M5 16.5h14"/>',
  pad: '<path d="M7 7.5h10a4.5 4.5 0 0 1 4.3 3.3l1 4.4a2.6 2.6 0 0 1-4.4 2.3L15.6 15H8.4L6.1 17.5a2.6 2.6 0 0 1-4.4-2.3l1-4.4A4.5 4.5 0 0 1 7 7.5z"/><path d="M7.5 9.8v3.4M5.8 11.5h3.4"/><circle cx="16" cy="10.6" r=".9"/><circle cx="17.8" cy="12.5" r=".9"/>',
  padHalf: '<path d="M7 7.5h10a4.5 4.5 0 0 1 4.3 3.3l1 4.4a2.6 2.6 0 0 1-4.4 2.3L15.6 15H8.4L6.1 17.5a2.6 2.6 0 0 1-4.4-2.3l1-4.4A4.5 4.5 0 0 1 7 7.5z" stroke-dasharray="2.2 1.6"/><path d="M7.5 9.8v3.4M5.8 11.5h3.4"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H4.8c0 2.6 1.4 4.2 3.6 4.4M16 6h3.2c0 2.6-1.4 4.2-3.6 4.4"/><path d="M12 13v3.5M8.5 20h7M9.5 20c0-2 1.1-3.5 2.5-3.5s2.5 1.5 2.5 3.5"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6-1.3A4.7 4.7 0 0 0 7 18.5z"/><path d="M12 11v5M9.8 14l2.2 2.2 2.2-2.2"/>',
};

const DEFS = [
  [2, 'p', 'person', 'singlePlayer'],
  [1, 'p', 'group', 'multiplayer'],
  [9, 'p', 'coop', 'coop'],
  [38, 'p', 'globe', 'onlineCoop'],
  [28, 'c', 'pad', 'fullController'],
  [18, 'c', 'padHalf', 'partialController'],
  [22, 'f', 'trophy', 'achievements'],
  [23, 'f', 'cloud', 'cloudSaves'],
];

export function featureMarks(game, size, max = 5) {
  const lists = { p: game.players || [], c: game.controllers || [], f: game.features || [] };
  const items = DEFS.filter(([id, kind]) => lists[kind].includes(id)).slice(0, max);
  return el(
    'div.features',
    { style: { '--s': `${size}px` } },
    items.map(([, , icon, label]) =>
      el(
        'div.feature',
        {},
        svg(`<svg class="feature-icon" viewBox="0 0 24 24" fill="none" stroke="#1b1a19" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</svg>`),
        el('div.feature-label', { text: t(label) }),
      ),
    ),
  );
}
