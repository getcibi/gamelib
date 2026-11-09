// 读本机的 Steam：找安装目录、扫已安装的游戏、玩过的记录、库里出现过的游戏，
// 再用商店接口补中文名、简介、图片。
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { parseVdf, vget, vpath } = require('./vdf');
const store = require('./store');

const exists = (p) => fs.promises.access(p).then(() => true, () => false);
const readText = (p) => fs.promises.readFile(p, 'utf8');
const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};
const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

const TOOL = /Steamworks Common|Proton|Steam Linux Runtime|Redistributable|SteamVR|Wallpaper Engine|Dedicated Server|Soundtrack/i;
const isTool = (id, name) => id === 228980 || id === 7 || id === 753 || TOOL.test(name || '');

// ---------------------------------------------------------------- 找 Steam

function regQuery(key, value) {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', value], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      for (const line of String(stdout).split(/\r?\n/)) {
        const fields = line.trim().match(/^(\S+)\s+REG_(?:SZ|DWORD)\s+(.+)$/);
        if (fields?.[1].toLowerCase() === value.toLowerCase()) return resolve(fields[2].trim());
      }
      resolve(null);
    });
  });
}

async function findSteamRoot() {
  const candidates = [];
  if (process.platform === 'win32') {
    for (const [k, v] of [
      ['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
      ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
      ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'],
    ]) {
      const r = await regQuery(k, v);
      if (r) candidates.push(r);
    }
    candidates.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam');
  } else {
    const home = require('os').homedir();
    if (process.platform === 'darwin') candidates.push(path.join(home, 'Library/Application Support/Steam'));
    else candidates.push(path.join(home, '.steam/steam'), path.join(home, '.local/share/Steam'));
  }
  for (const c of candidates) {
    // 注册表里的 SteamPath 是 c:/program files (x86)/steam 这种正斜杠写法。
    const dir = path.normalize(c);
    if (await exists(path.join(dir, 'steamapps'))) return dir;
  }
  return null;
}

const STEAM_ID_BASE = 76561197960265728n;
const MAX_ACCOUNT_ID = 0xffffffffn;

function steamIdFromAccountId(value) {
  if (!value) return null;
  try {
    const id = BigInt(value);
    return id > 0n && id <= MAX_ACCOUNT_ID ? String(STEAM_ID_BASE + id) : null;
  } catch { return null; }
}

function accountIdFromSteamId(value) {
  if (!/^\d{17}$/.test(value || '')) return null;
  const id = BigInt(value) - STEAM_ID_BASE;
  return id > 0n && id <= MAX_ACCOUNT_ID ? String(id) : null;
}

async function resolveSteamAccount(root, override) {
  const accounts = new Map();
  const recent = [];
  if (root) {
    try {
      const users = vget(parseVdf(await readText(path.join(root, 'config', 'loginusers.vdf'))), 'users');
      for (const [id, user] of Object.entries(users || {})) {
        if (!accountIdFromSteamId(id)) continue;
        accounts.set(id, { id, name: vget(user, 'PersonaName') || '' });
        if (vget(user, 'MostRecent') === '1') recent.push(id);
      }
    } catch {}
    try {
      for (const entry of await fs.promises.readdir(path.join(root, 'userdata'), { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
        const id = steamIdFromAccountId(entry.name);
        if (id && !accounts.has(id) && await exists(path.join(root, 'userdata', entry.name, 'config', 'localconfig.vdf'))) {
          accounts.set(id, { id, name: '' });
        }
      }
    } catch {}
  }
  const active = root && process.platform === 'win32'
    ? steamIdFromAccountId(await regQuery('HKCU\\Software\\Valve\\Steam\\ActiveProcess', 'ActiveUser'))
    : null;
  const automaticSteamId = (accounts.has(active) ? active : null)
    || (recent.length === 1 ? recent[0] : null)
    || (accounts.size === 1 ? accounts.keys().next().value : null);
  const id = override ? (accountIdFromSteamId(override) ? override : null) : automaticSteamId;
  if (id && !accounts.has(id)) accounts.set(id, { id, name: '' });
  return { steamId: id, automaticSteamId, accounts: [...accounts.values()] };
}

// ---------------------------------------------------------------- 已安装

async function scanInstalled(root) {
  const libraries = [root];
  const seenLibs = new Set([norm(root)]);
  try {
    const data = vget(parseVdf(await readText(path.join(root, 'steamapps', 'libraryfolders.vdf'))), 'libraryfolders');
    for (const v of Object.values(data || {})) {
      // 新版每个库是 { "path": ..., "apps": {...} }，旧版直接是路径字符串。
      const p = typeof v === 'object' ? vget(v, 'path') : v;
      if (typeof p === 'string' && /[\\/]/.test(p) && !seenLibs.has(norm(p))) {
        seenLibs.add(norm(p));
        libraries.push(p);
      }
    }
  } catch {}

  const seen = new Set();
  const games = [];
  for (const lib of libraries) {
    const apps = path.join(lib, 'steamapps');
    let files;
    try {
      files = await fs.promises.readdir(apps);
    } catch {
      continue;
    }
    for (const name of files) {
      if (!name.startsWith('appmanifest_') || !name.endsWith('.acf')) continue;
      try {
        const st = vget(parseVdf(await readText(path.join(apps, name))), 'AppState');
        const id = toInt(vget(st, 'appid')) || toInt(name.slice(12, -4));
        const title = vget(st, 'name');
        if (!id || typeof title !== 'string' || isTool(id, title) || seen.has(id)) continue;
        seen.add(id);
        const dir = vget(st, 'installdir');
        games.push({
          appId: id,
          name: title,
          installed: true,
          installDir: typeof dir === 'string' ? path.join(lib, 'steamapps', 'common', dir) : null,
          sizeOnDisk: toInt(vget(st, 'SizeOnDisk')),
          lastPlayed: toInt(vget(st, 'LastPlayed')),
        });
      } catch {}
    }
  }
  return games;
}

// ---------------------------------------------------------------- 玩过的 / 库里的

// 只读当前统计账号的游玩记录，包括已经卸载的游戏。
async function playedFromUserdata(root, steamId) {
  const out = new Map();
  const user = accountIdFromSteamId(steamId);
  if (!user) return out;
  try {
    const cfg = parseVdf(await readText(path.join(root, 'userdata', user, 'config', 'localconfig.vdf')));
    const apps = vpath(cfg, 'UserLocalConfigStore', 'Software', 'Valve', 'Steam', 'apps');
    for (const [k, v] of Object.entries(apps || {})) {
      const id = toInt(k);
      const lastPlayed = toInt(vget(v, 'LastPlayed'));
      const playtimeMinutes = toInt(vget(v, 'Playtime'));
      if (id && (lastPlayed || playtimeMinutes)) out.set(id, { lastPlayed, playtimeMinutes });
    }
  } catch {}
  return out;
}

// Steam 会把库里游戏的封面缓存在 appcache/librarycache：
// 新版是 <AppID>/ 文件夹，旧版是 <AppID>_library_600x900.jpg。
async function libraryCacheIds(root) {
  const out = new Set();
  try {
    for (const name of await fs.promises.readdir(path.join(root, 'appcache', 'librarycache'))) {
      const m = /^(\d+)/.exec(name);
      if (m && +m[1] > 0) out.add(+m[1]);
    }
  } catch {}
  return out;
}

// 只扫已安装的，再用 localconfig 补上次游玩时间（测试在用）。
async function scan(root) {
  const { steamId } = await resolveSteamAccount(root);
  const played = await playedFromUserdata(root, steamId);
  const games = (await scanInstalled(root)).map((g) => {
    const p = played.get(g.appId);
    return {
      ...g,
      lastPlayed: Math.max(g.lastPlayed, p?.lastPlayed || 0),
      playtimeMinutes: p?.playtimeMinutes || 0,
    };
  });
  games.sort((a, b) => b.lastPlayed - a.lastPlayed);
  return games;
}

// ---------------------------------------------------------------- 汇总

// 图片要用到的东西：商店原始信息、Steam 本地图片缓存目录。按 AppID 存。
const artSources = new Map();
const artSource = (appId) => artSources.get(appId);

async function loadLibrary(cfg, onProgress = () => {}, findRoot = findSteamRoot) {
  onProgress({ phase: 'findingSteam', message: '正在找 Steam…' });
  const root = await findRoot();

  const installed = new Map();
  let played = new Map();
  let seenInLibrary = new Set();
  const { steamId, automaticSteamId, accounts } = await resolveSteamAccount(root, (cfg.steamId || '').trim());

  if (root) {
    onProgress({ phase: 'readingLocal', message: '正在读取本机的游戏…' });
    for (const g of await scanInstalled(root)) installed.set(g.appId, g);
    played = await playedFromUserdata(root, steamId);
    seenInLibrary = await libraryCacheIds(root);
  }

  const key = (cfg.apiKey || '').trim();
  let sync = { status: key ? 'account-needed' : 'local', games: null };
  if (key && steamId) {
    onProgress({ phase: 'syncing', message: '正在同步 Steam 游戏库和游玩时长…' });
    sync = await store.ownedGames(key, steamId);
  }
  const owned = sync.games;
  const demo = !root && owned === null;
  if (demo) {
    for (const g of demoGames()) {
      if (g.installed) installed.set(g.appId, g);
      played.set(g.appId, { lastPlayed: g.lastPlayed, playtimeMinutes: g.playtimeMinutes });
      seenInLibrary.add(g.appId);
    }
  }

  const ownedById = new Map((owned || []).map((o) => [o.appId, o]));
  const ids = new Set([
    ...installed.keys(),
    ...played.keys(),
    ...(owned ? ownedById.keys() : seenInLibrary),
  ]);

  const language = cfg.language === 'en' ? 'en' : 'zh-CN';
  const infos = await store.fetchAll([...ids], (done, total) =>
    onProgress({ phase: 'readingStore', message: '正在从 Steam 商店读取游戏信息…', done, total }), language);

  const cacheDir = root ? path.join(root, 'appcache', 'librarycache') : null;
  artSources.clear();
  const games = [];
  for (const id of ids) {
    const info = infos.get(id);
    const local = installed.get(id);
    const own = ownedById.get(id);
    if (isTool(id, local?.name || own?.name || info?.name || '')) continue;
    // 商店明确说不是游戏（软件、DLC、原声带……）就不要。
    if (info && !store.isGame(info)) continue;
    const name = info?.name || local?.name || own?.name || null;
    if (!name) continue;

    const p = played.get(id);
    const last = Math.max(p?.lastPlayed || 0, own?.lastPlayed || 0);
    artSources.set(id, { raw: info || null, libraryCache: cacheDir });
    games.push({
      appId: id,
      name,
      installed: !!local,
      sizeOnDisk: local?.sizeOnDisk || 0,
      lastPlayed: last ? last * 1000 : null,
      playtimeMinutes: own?.playtimeMinutes ?? p?.playtimeMinutes ?? 0,
      inAccountLibrary: !!(own || p),
      ...store.summarize(info, language),
    });
  }

  games.sort((a, b) => {
    const ta = a.lastPlayed || 0;
    const tb = b.lastPlayed || 0;
    if (ta !== tb) return tb - ta;
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });

  return { games, steamRoot: root, steamId, automaticSteamId, accounts, demo, usedApiKey: owned !== null, syncStatus: sync.status };
}

// ---------------------------------------------------------------- 演示数据

// 这台电脑没装 Steam 时用：真实的 AppID，名字、简介、图片都从商店接口取。
function demoGames() {
  const now = Math.floor(Date.now() / 1000);
  const ago = (days, hours = 0) => now - days * 86400 - hours * 3600;
  const GB = 1024 ** 3;
  return [
    { appId: 1245620, name: 'ELDEN RING', installed: true, sizeOnDisk: 49 * GB, lastPlayed: ago(0, 3), playtimeMinutes: 9320 },
    { appId: 2358720, name: 'Black Myth: Wukong', installed: true, sizeOnDisk: 130 * GB, lastPlayed: ago(1), playtimeMinutes: 4210 },
    { appId: 367520, name: 'Hollow Knight', installed: true, sizeOnDisk: 9 * GB, lastPlayed: ago(3), playtimeMinutes: 3100 },
    { appId: 1145360, name: 'Hades', installed: true, sizeOnDisk: 15 * GB, lastPlayed: ago(6), playtimeMinutes: 2650 },
    { appId: 1086940, name: "Baldur's Gate 3", installed: true, sizeOnDisk: 128 * GB, lastPlayed: ago(9), playtimeMinutes: 6900 },
    { appId: 1091500, name: 'Cyberpunk 2077', installed: false, lastPlayed: ago(12), playtimeMinutes: 5400 },
    { appId: 413150, name: 'Stardew Valley', installed: true, sizeOnDisk: GB / 2, lastPlayed: ago(20), playtimeMinutes: 7700 },
    { appId: 292030, name: 'The Witcher 3: Wild Hunt', installed: false, lastPlayed: ago(41), playtimeMinutes: 8800 },
    { appId: 814380, name: 'Sekiro™: Shadows Die Twice', installed: true, sizeOnDisk: 25 * GB, lastPlayed: ago(66), playtimeMinutes: 4100 },
    { appId: 1174180, name: 'Red Dead Redemption 2', installed: false, lastPlayed: ago(90), playtimeMinutes: 3300 },
    { appId: 489830, name: 'The Elder Scrolls V: Skyrim Special Edition', installed: false, lastPlayed: ago(150), playtimeMinutes: 12000 },
    { appId: 105600, name: 'Terraria', installed: true, sizeOnDisk: GB / 2, lastPlayed: ago(210), playtimeMinutes: 2200 },
    { appId: 620, name: 'Portal 2', installed: false, lastPlayed: 0, playtimeMinutes: 900 },
  ];
}

const launchUri = (appId, installed) => (installed ? `steam://rungameid/${appId}` : `steam://install/${appId}`);

module.exports = {
  findSteamRoot,
  scanInstalled,
  scan,
  loadLibrary,
  artSource,
  launchUri,
  isTool,
};
