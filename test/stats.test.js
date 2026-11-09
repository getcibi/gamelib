const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '../src/renderer/stats.js')).href);
const H = 60;
const DAY = 86400e3;
const NOW = Date.UTC(2026, 10, 9);

const games = [
  { appId: 1, name: '魂', playtimeMinutes: 100 * H, lastPlayed: NOW - DAY, priceCents: 29800, reviewCount: 900000, reviewPct: 93, releaseDate: Date.UTC(2022, 1, 1), developers: ['FromSoftware, Inc.'], tagInfo: [{ id: 29482, name: '类魂系列' }, { id: 1695, name: '开放世界' }] },
  { appId: 2, name: '独', playtimeMinutes: 20 * H, lastPlayed: NOW - 40 * DAY, priceCents: 5800, reviewCount: 3000, reviewPct: 97, releaseDate: Date.UTC(2017, 1, 1), developers: ['Team Cherry'], tagInfo: [{ id: 492, name: '独立' }], installed: true, sizeOnDisk: 9 * 1024 ** 3 },
  { appId: 3, name: '没玩', playtimeMinutes: 10, lastPlayed: null, priceCents: 10000, tagInfo: [] },
  { appId: 4, name: '免费', playtimeMinutes: 0, isFree: true, priceCents: null },
];

test('数据面板统计：时长、价值、库存', async () => {
  const { computeStats } = await load();
  const st = computeStats(games, NOW);
  assert.strictEqual(st.count, 4);
  assert.strictEqual(st.playedCount, 3);
  assert.strictEqual(st.totalMinutes, 120 * H + 10);
  assert.strictEqual(st.favorite.appId, 1);
  assert.strictEqual(st.valueCents, 29800 + 5800 + 10000);
  assert.strictEqual(st.shelf.deep, 2);
  assert.strictEqual(st.shelf.backlog, 2);
  assert.strictEqual(st.backlogValueCents, 10000);
  assert.strictEqual(st.bestValue.game.appId, 2); // ¥58 / 20h = ¥2.90/h，比 ¥298 / 100h 便宜
});

test('数据面板统计：口味', async () => {
  const { computeStats } = await load();
  const st = computeStats(games, NOW);
  const hard = st.radar.find((a) => a.key === 'hard');
  const indie = st.radar.find((a) => a.key === 'indie');
  assert.ok(Math.abs(hard.share - 100 / 120) < 1e-9);
  assert.ok(Math.abs(indie.share - 20 / 120) < 1e-9);
  assert.strictEqual(st.persona.title, '受苦美学家');
  assert.strictEqual(st.developers[0].name, 'FromSoftware');
  assert.strictEqual(st.tags[0].name, '类魂系列');
  assert.ok(st.quality > 93 && st.quality < 97);
  assert.ok(st.niche >= 0 && st.niche <= 100);
  assert.strictEqual(st.era[0].year, 2017);
  assert.strictEqual(st.era.at(-1).year, 2022);
  assert.strictEqual(st.active30, 1);
});

test('数据面板统计：空库不出错', async () => {
  const { computeStats } = await load();
  const st = computeStats([], NOW);
  assert.strictEqual(st.playedCount, 0);
  assert.strictEqual(st.costPerHour, null);
  assert.strictEqual(st.persona.title, '新晋玩家');
});
