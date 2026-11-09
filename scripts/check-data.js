// 检查数据面板要用的数据在这台电脑上能不能拿到：npm run check-data
// 和程序走同一条读取流程（本机 Steam 记录 + 商店接口），不开窗口，最后打印每项数据的覆盖率。
const path = require('path');
const { pathToFileURL } = require('url');
const paths = require('../src/main/paths');
const steam = require('../src/main/steam');

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const line = (label, n, d, note = '') => console.log(`  ${label.padEnd(7, '　')} ${String(n).padStart(5)} / ${d}  ${pct(n, d).padStart(4)}  ${note}`);

(async () => {
  const cfg = await paths.loadConfig();
  let last = '';
  const lib = await steam.loadLibrary(cfg, (p) => {
    const msg = p.total ? `${p.message} ${p.done}/${p.total}` : p.message;
    if (msg !== last) process.stdout.write(`\r${(last = msg).padEnd(60)}`);
  });
  process.stdout.write('\r'.padEnd(62) + '\r');

  const g = lib.games;
  const n = g.length;
  console.log('\n数据来源');
  console.log(`  Steam 目录      ${lib.steamRoot || '没找到（用的是演示数据）'}`);
  console.log(`  SteamID         ${lib.steamId || '—'}`);
  console.log(`  Web API Key     ${lib.usedApiKey ? '已用（完整的已拥有列表 + 时长）' : '没用（只有本机记录里出现过的游戏）'}`);
  console.log(`  游戏数          ${n}`);
  if (!n) return;

  const played = g.filter((x) => x.playtimeMinutes > 0);
  console.log('\n每项数据的覆盖（所有游戏）');
  line('有游玩时长', played.length, n, '本机 localconfig.vdf / Web API');
  line('有上次游玩', g.filter((x) => x.lastPlayed).length, n);
  line('有商店标签', g.filter((x) => x.tagInfo?.length).length, n, '品味雷达 / DNA');
  line('有评测数据', g.filter((x) => x.reviewCount > 0).length, n, '口碑 / 小众 / 散点图');
  line('有价格或免费', g.filter((x) => x.priceCents > 0 || x.isFree).length, n, '库存价值 / 每小时花费');
  line('有发售日期', g.filter((x) => x.releaseDate).length, n, '年代偏好');
  line('有开发商', g.filter((x) => x.developers?.length).length, n, '本命厂商');
  line('已安装', g.filter((x) => x.installed).length, n);

  const noStore = g.filter((x) => !x.tagInfo?.length && !x.reviewCount && !x.releaseDate);
  if (noStore.length) {
    console.log(`\n商店信息完全没拿到的 ${noStore.length} 款（下架 / 锁区 / 网络问题）：`);
    console.log('  ' + noStore.slice(0, 12).map((x) => `${x.name}(${x.appId})`).join('、') + (noStore.length > 12 ? ' …' : ''));
  }

  const { computeStats } = await import(pathToFileURL(path.join(__dirname, '../src/renderer/stats.js')).href);
  const st = computeStats(g);
  console.log('\n面板会显示');
  console.log(`  游戏人格        ${st.persona.title}${st.persona.second ? ' · 兼 ' + st.persona.second : ''}  ${st.persona.traits.join(' / ')}`);
  console.log(`  总时长          ${Math.round(st.totalMinutes / 60)} 小时，玩过 ${st.playedCount} 款`);
  console.log(`  本命游戏        ${st.favorite ? `${st.favorite.name}（${Math.round(st.favorite.playtimeMinutes / 60)} 小时）` : '—'}`);
  console.log(`  库存价值        ¥${Math.round(st.valueCents / 100)}（${st.pricedCount} 款有价格）`);
  console.log(`  每小时花费      ${st.costPerHour != null ? '¥' + st.costPerHour.toFixed(2) : '—'}`);
  console.log(`  口碑 / 小众     ${st.quality != null ? Math.round(st.quality) + '%' : '—'} / ${st.niche ?? '—'}`);
  console.log('');
})().catch((e) => {
  console.error('读取失败：', e);
  process.exit(1);
});
