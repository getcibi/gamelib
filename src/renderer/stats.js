import { t } from './i18n.js';

// 数据面板的统计：只做计算，不碰 DOM（测试里直接 import）。
// 输入是 loadLibrary 给的 games，时长按分钟、时间按毫秒。

const HOUR = 60;

// 品味雷达的八个方向，各由几个 Steam 标签 ID 组成（ID 不随语言变）。
export const AXES = [
  { key: 'hard', nameKey: 'axisHard', ids: [29482, 4026, 1716, 3959], titleKey: 'personaHard' },
  { key: 'action', nameKey: 'axisAction', ids: [19, 4231, 4106, 1774, 1663, 1697], titleKey: 'personaAction' },
  { key: 'explore', nameKey: 'axisExplore', ids: [1695, 3834, 1628, 3810], titleKey: 'personaExplore' },
  { key: 'story', nameKey: 'axisStory', ids: [1742, 4166, 4604], titleKey: 'personaStory' },
  { key: 'mind', nameKey: 'axisMind', ids: [9, 1708, 4325, 1664], titleKey: 'personaMind' },
  { key: 'social', nameKey: 'axisSocial', ids: [3859, 1685, 3843, 7368, 128, 6730, 3878], titleKey: 'personaSocial' },
  { key: 'indie', nameKey: 'axisIndie', ids: [492, 3964, 3871, 1625], titleKey: 'personaIndie' },
  { key: 'chill', nameKey: 'axisChill', ids: [597, 599, 1643, 1702, 4136], titleKey: 'personaChill' },
];

// 标签按商店给的顺序（权重从高到低）分时长。
const TAG_WEIGHTS = [1, 0.85, 0.72, 0.6, 0.5, 0.42];

const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 按时长加权的平均值，只算 pick 有值的游戏。
function weighted(games, pick) {
  let w = 0;
  let s = 0;
  for (const g of games) {
    const v = pick(g);
    if (v == null || !Number.isFinite(v)) continue;
    s += v * g.playtimeMinutes;
    w += g.playtimeMinutes;
  }
  return w ? s / w : null;
}

function topBy(map, n) {
  return [...map.entries()]
    .map(([name, minutes]) => ({ name, minutes }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, n);
}

export function computeStats(games, now = Date.now()) {
  const all = games || [];
  const played = all.filter((g) => g.playtimeMinutes > 0).sort((a, b) => b.playtimeMinutes - a.playtimeMinutes);
  const totalMinutes = sum(played, (g) => g.playtimeMinutes);

  // ---- 钱
  const priced = all.filter((g) => g.priceCents > 0);
  const valueCents = sum(priced, (g) => g.priceCents);
  const playedPriced = played.filter((g) => g.priceCents > 0);
  const playedPricedMinutes = sum(playedPriced, (g) => g.playtimeMinutes);
  const costPerHour = playedPricedMinutes ? sum(playedPriced, (g) => g.priceCents) / 100 / (playedPricedMinutes / HOUR) : null;
  const bestValue = playedPriced
    .filter((g) => g.playtimeMinutes >= HOUR)
    .map((g) => ({ game: g, perHour: g.priceCents / 100 / (g.playtimeMinutes / HOUR) }))
    .sort((a, b) => a.perHour - b.perHour);
  const bestValues = bestValue.slice(0, 4);

  // ---- 库存
  const backlog = all.filter((g) => g.playtimeMinutes < HOUR);
  const installed = all.filter((g) => g.installed);
  const diskBytes = sum(installed, (g) => g.sizeOnDisk || 0);
  const shelf = {
    deep: all.filter((g) => g.playtimeMinutes >= 20 * HOUR).length,
    tried: all.filter((g) => g.playtimeMinutes >= HOUR && g.playtimeMinutes < 20 * HOUR).length,
    backlog: backlog.length,
  };
  const backlogValueCents = sum(backlog, (g) => g.priceCents || 0);

  // ---- 品味：标签
  const tagMinutes = new Map();
  for (const g of played) {
    const tags = g.tagInfo || [];
    const ws = tags.map((_, i) => TAG_WEIGHTS[i] ?? 0.35);
    const wsum = sum(ws, (w) => w) || 1;
    tags.forEach((t, i) => tagMinutes.set(t.name, (tagMinutes.get(t.name) || 0) + (g.playtimeMinutes * ws[i]) / wsum));
  }
  const tags = topBy(tagMinutes, 10);
  const taggedMinutes = sum(played.filter((g) => g.tagInfo?.length), (g) => g.playtimeMinutes);
  for (const t of tags) t.share = taggedMinutes ? t.minutes / taggedMinutes : 0;

  // ---- 品味：雷达。每个方向 = 带这类标签的游戏占总时长的比例。
  const radar = AXES.map((a) => {
    const set = new Set(a.ids);
    const m = sum(played.filter((g) => (g.tagInfo || []).some((t) => set.has(t.id))), (g) => g.playtimeMinutes);
    const games = played.filter((g) => (g.tagInfo || []).some((t) => set.has(t.id))).length;
    return { key: a.key, name: t(a.nameKey), title: t(a.titleKey), share: taggedMinutes ? m / taggedMinutes : 0, games };
  });

  // ---- 口碑、热度、年代
  const quality = weighted(played, (g) => g.reviewPct);
  // 小众指数：评测数 100 条 → 100，100 万条 → 0（对数），按时长平均。
  const nicheRaw = weighted(played, (g) => (g.reviewCount > 0 ? clamp(((6 - Math.log10(g.reviewCount)) / 4) * 100, 0, 100) : null));
  const niche = nicheRaw == null ? null : Math.round(nicheRaw);
  const eraYear = weighted(played, (g) => (g.releaseDate ? new Date(g.releaseDate).getFullYear() + new Date(g.releaseDate).getMonth() / 12 : null));

  const years = new Map();
  for (const g of played) {
    if (!g.releaseDate) continue;
    const y = new Date(g.releaseDate).getFullYear();
    const e = years.get(y) || { year: y, minutes: 0, games: [] };
    e.minutes += g.playtimeMinutes;
    e.games.push(g);
    years.set(y, e);
  }
  const yearList = [...years.values()].sort((a, b) => a.year - b.year);
  let era = [];
  if (yearList.length) {
    // 连续的年份轴，最多 24 年，再早的并成"更早"
    const last = yearList[yearList.length - 1].year;
    const first = Math.max(yearList[0].year, last - 23);
    const early = yearList.filter((y) => y.year < first);
    if (early.length) {
      era.push({ year: first - 1, early: true, minutes: sum(early, (y) => y.minutes), games: early.flatMap((y) => y.games) });
    }
    for (let y = first; y <= last; y++) era.push(years.get(y) || { year: y, minutes: 0, games: [] });
  }

  // ---- 厂商
  const devMinutes = new Map();
  const devGames = new Map();
  for (const g of played) {
    const d = g.developers?.[0];
    if (!d) continue;
    const name = d.replace(/,?\s*(Inc|Ltd|LLC|Co|Corp|GmbH|S\.A)\.?$/i, '').trim();
    devMinutes.set(name, (devMinutes.get(name) || 0) + g.playtimeMinutes);
    devGames.set(name, (devGames.get(name) || 0) + 1);
  }
  const developers = topBy(devMinutes, 10).map((d) => ({ ...d, games: devGames.get(d.name) }));

  // ---- 最近
  const recent = all
    .filter((g) => g.lastPlayed)
    .sort((a, b) => b.lastPlayed - a.lastPlayed)
    .slice(0, 6);
  const active30 = all.filter((g) => g.lastPlayed && now - g.lastPlayed < 30 * 86400e3).length;

  // ---- 称号：雷达最强的两个方向 + 口味修饰
  const ranked = [...radar].sort((a, b) => b.share - a.share).filter((a) => a.share > 0);
  const persona = {
    title: ranked[0]?.title || t('personaNew'),
    second: ranked[1]?.title || null,
    traits: [],
  };
  if (quality != null && quality >= 90) persona.traits.push(t('traitAcclaimed'));
  if (niche != null && niche >= 45) persona.traits.push(t('traitNiche'));
  else if (niche != null && niche <= 20) persona.traits.push(t('traitBlockbusters'));
  if (eraYear != null && now && new Date(now).getFullYear() - eraYear >= 8) persona.traits.push(t('traitNostalgic'));
  else if (eraYear != null && new Date(now).getFullYear() - eraYear <= 2.5) persona.traits.push(t('traitFresh'));
  if (played[0] && totalMinutes && played[0].playtimeMinutes / totalMinutes >= 0.3) persona.traits.push(t('traitDedicated'));
  else if (played.length >= 8 && played[0] && played[0].playtimeMinutes / totalMinutes < 0.15) persona.traits.push(t('traitVariety'));

  return {
    count: all.length,
    playedCount: played.length,
    totalMinutes,
    top: played.slice(0, 10),
    favorite: played[0] || null,
    valueCents,
    pricedCount: priced.length,
    costPerHour,
    bestValue: bestValues[0] || null,
    bestValues,
    backlog,
    backlogValueCents,
    shelf,
    installedCount: installed.length,
    diskBytes,
    tags,
    radar,
    quality,
    niche,
    eraYear,
    era,
    developers,
    recent,
    active30,
    persona,
    scatter: played.filter((g) => g.reviewCount > 0),
  };
}
