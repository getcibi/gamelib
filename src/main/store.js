// Steam 商店信息（IStoreBrowseService/GetItems，不用 Key）和标签名，带本地缓存。
const fs = require('fs');
const { dataFile, dataFileForRead, readJson, writeJson } = require('./paths');

const ASSET_BASE = 'https://shared.steamstatic.com/store_item_assets/';
const TTL = 14 * 24 * 3600 * 1000;
// 缓存格式版本：请求的字段变了就加一，旧条目会重新去问（v2 起带评测和价格）。
const CACHE_V = 2;

// 主进程里换成 Electron 的 net.fetch（走系统代理）；测试里用 Node 自带的。
let fetchFn = (...a) => fetch(...a);
function setFetch(f) {
  fetchFn = f;
}
const doFetch = (url, ms) => fetchFn(url, { signal: AbortSignal.timeout(ms) });

async function getJson(url, ms = 40000) {
  try {
    const r = await doFetch(url, ms);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 一条商店信息

const isGame = (raw) => raw?.type === 0;

function cleanText(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s*\r?\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const names = (list) => (Array.isArray(list) ? list.map((e) => e?.name).filter((x) => typeof x === 'string') : []);
const nums = (list) => (Array.isArray(list) ? list.filter((x) => typeof x === 'number') : []);

function screenshots(raw) {
  const list = raw?.screenshots?.all_ages_screenshots;
  return Array.isArray(list) ? list.map((e) => e?.filename).filter((x) => typeof x === 'string') : [];
}

function ageRating(raw) {
  const r = raw?.game_rating;
  if (typeof r?.rating === 'string' && /^\d+$/.test(r.rating)) return r.rating;
  const age = Number(r?.required_age) || 0;
  return age > 0 ? String(age) : null;
}

// 商店图片地址，key 是 assets 里的字段名，比如 library_capsule_2x。
function assetUrl(raw, key) {
  const a = raw?.assets;
  if (!a?.asset_url_format || !a[key]) return null;
  return ASSET_BASE + a.asset_url_format.replace('${FILENAME}', a[key]);
}

// 用商店的路径格式拼任意文件名（logo.png 不在 assets 字段里）。
function assetFile(raw, filename) {
  const fmt = raw?.assets?.asset_url_format;
  return fmt ? ASSET_BASE + fmt.replace('${FILENAME}', filename) : null;
}

// 给界面用的精简字段。
function summarize(raw, language = 'zh-CN') {
  if (!raw) return {};
  const tagNames = tagNamesByLanguage.get(language) || {};
  const b = raw.basic_info || {};
  const rel = raw.release || {};
  const t = rel.steam_release_date || rel.original_release_date;
  const cats = raw.categories || {};
  return {
    description: cleanText(b.short_description),
    developers: names(b.developers),
    publishers: names(b.publishers),
    releaseDate: t ? t * 1000 : null,
    tags: nums(raw.tagids).map((id) => tagNames[id]).filter(Boolean).slice(0, 4),
    ageRating: ageRating(raw),
    players: nums(cats.supported_player_categoryids),
    features: nums(cats.feature_categoryids),
    controllers: nums(cats.controller_categoryids),
    screenshotCount: screenshots(raw).length,
    // 数据面板用
    tagInfo: nums(raw.tagids)
      .map((id) => ({ id, name: tagNames[id] }))
      .filter((t) => t.name),
    priceCents: price(raw),
    isFree: raw.is_free === true,
    reviewCount: Number(raw.reviews?.summary_filtered?.review_count) || 0,
    reviewPct: num(raw.reviews?.summary_filtered?.percent_positive),
    reviewLabel: raw.reviews?.summary_filtered?.review_score_label || null,
  };
}

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// 当前商店售价（分），免费或买不到时是 null。
function price(raw) {
  const c = num(raw?.best_purchase_option?.final_price_in_cents);
  return c && c > 0 ? c : null;
}

// ---------------------------------------------------------------- 批量拉取

const tagNamesByLanguage = new Map();
const storeLanguage = (language) => language === 'en' ? 'english' : 'schinese';
const cacheNameFor = (name, language) => `${name}${language === 'en' ? '.en' : ''}.json`;

async function getItems(ids, language) {
  const input = {
    ids: ids.map((appid) => ({ appid })),
    context: { language: storeLanguage(language), country_code: 'CN', steam_realm: 1 },
    data_request: {
      include_assets: true,
      include_basic_info: true,
      include_release: true,
      include_tag_count: 6,
      include_screenshots: true,
      include_ratings: true,
      include_reviews: true,
    },
  };
  const url =
    'https://api.steampowered.com/IStoreBrowseService/GetItems/v1?input_json=' +
    encodeURIComponent(JSON.stringify(input));
  const j = await getJson(url);
  const list = j?.response?.store_items;
  if (!Array.isArray(list)) return null;
  const out = new Map();
  for (const e of list) {
    if (e?.success === 1 && typeof e.appid === 'number') out.set(e.appid, e);
  }
  return out;
}

async function loadTags(language) {
  const name = cacheNameFor('tags', language);
  const file = dataFileForRead(name);
  try {
    const st = await fs.promises.stat(file);
    if (Date.now() - st.mtimeMs < 30 * 24 * 3600 * 1000) {
      return readJson(file, {});
    }
  } catch {}
  const j = await getJson('https://api.steampowered.com/IStoreService/GetTagList/v1/?language=' + storeLanguage(language));
  const tags = j?.response?.tags;
  if (!Array.isArray(tags)) {
    return readJson(file, {});
  }
  const tagNames = {};
  for (const t of tags) if (typeof t?.tagid === 'number') tagNames[t.tagid] = String(t.name);
  await writeJson(dataFile(name), tagNames);
  return tagNames;
}

// 拿这些游戏的商店信息：缓存里有且没过期就直接用，其余 50 个一批去问，同时最多 3 批。
async function fetchAll(ids, progress, language = 'zh-CN') {
  const name = cacheNameFor('store_cache', language);
  const cache = await readJson(dataFileForRead(name), {});
  const now = Date.now();
  const infos = new Map();
  const missing = [];
  for (const id of new Set(ids)) {
    const e = cache[id];
    if (e && e.v === CACHE_V && now - (e.at || 0) < TTL) {
      if (e.item) infos.set(id, e.item);
    } else {
      missing.push(id);
    }
  }

  const tagsTask = loadTags(language);
  const fallbackCache = language === 'en' && missing.length ? await readJson(dataFileForRead('store_cache.json'), {}) : {};
  let done = 0;
  progress?.(0, missing.length);
  const batches = [];
  for (let i = 0; i < missing.length; i += 50) batches.push(missing.slice(i, i + 50));
  let next = 0;
  async function worker() {
    while (next < batches.length) {
      const batch = batches[next++];
      const items = await getItems(batch, language);
      if (items) {
        for (const id of batch) {
          const item = items.get(id);
          cache[id] = item ? { v: CACHE_V, at: now, item } : { v: CACHE_V, at: now };
          if (item) infos.set(id, item);
        }
      } else {
        // 没连上：用旧缓存顶一下
        for (const id of batch) {
          const item = cache[id]?.item || fallbackCache[id]?.item;
          if (item) infos.set(id, item);
        }
      }
      done += batch.length;
      progress?.(done, missing.length);
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  tagNamesByLanguage.set(language, await tagsTask);
  if (missing.length) await writeJson(dataFile(name), cache);
  return infos;
}

// 用 Web API Key 拿完整的已拥有游戏列表。
async function ownedGames(key, steamId) {
  const q = new URLSearchParams({
    key,
    steamid: steamId,
    include_appinfo: '1',
    include_played_free_games: '1',
    format: 'json',
  });
  let response;
  try {
    const r = await doFetch('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?' + q, 15000);
    if (!r.ok) return { status: [401, 403].includes(r.status) ? 'denied' : 'error', games: null };
    response = (await r.json())?.response;
  } catch {
    return { status: 'error', games: null };
  }
  const games = response?.games ?? (response?.game_count === 0 ? [] : null);
  if (!Array.isArray(games)) return { status: 'unavailable', games: null };
  return {
    status: 'synced',
    games: games.filter((g) => typeof g?.appid === 'number').map((g) => ({
      appId: g.appid,
      name: g.name || '',
      playtimeMinutes: num(g.playtime_forever),
      lastPlayed: g.rtime_last_played || 0,
    })),
  };
}

module.exports = {
  ASSET_BASE,
  setFetch,
  doFetch,
  isGame,
  summarize,
  screenshots,
  assetUrl,
  assetFile,
  fetchAll,
  ownedGames,
};
