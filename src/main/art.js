// 找游戏图片：Steam 本地缓存 → 自己的缓存 → 商店给的图片地址 → 老的固定地址。
// 界面里用 art://game/<AppID>/<cover|hero|logo|ss>/<第几张> 来要图。
const fs = require('fs');
const path = require('path');
const { artDir } = require('./paths');
const store = require('./store');
const { artSource } = require('./steam');

const KINDS = ['cover', 'hero', 'logo', 'ss'];
const memo = new Map();

function cacheName(id, kind, i) {
  if (kind === 'logo') return `${id}_logo.png`;
  if (kind === 'ss') return `${id}_ss${i}.jpg`;
  return `${id}_${kind}.jpg`;
}

function urls(id, kind, i) {
  const old = 'https://cdn.cloudflare.steamstatic.com/steam/apps';
  const raw = artSource(id)?.raw;
  let list = [];
  if (kind === 'cover') {
    list = [
      store.assetUrl(raw, 'library_capsule_2x'),
      store.assetUrl(raw, 'library_capsule'),
      `${old}/${id}/library_600x900_2x.jpg`,
      `${old}/${id}/library_600x900.jpg`,
    ];
  } else if (kind === 'hero') {
    list = [store.assetUrl(raw, 'library_hero'), `${old}/${id}/library_hero.jpg`];
  } else if (kind === 'logo') {
    list = [store.assetFile(raw, 'logo_schinese.png'), store.assetFile(raw, 'logo.png'), `${old}/${id}/logo.png`];
  } else if (kind === 'ss') {
    const s = store.screenshots(raw)[i];
    if (s) list = [store.ASSET_BASE + s.replace('.jpg', '.600x338.jpg'), store.ASSET_BASE + s];
  }
  return list.filter(Boolean);
}

// Steam 客户端自己缓存的图：
// 旧版 librarycache/<id>_library_600x900.jpg；
// 新版 librarycache/<id>/(<hash>/)library_600x900.jpg。
const STEAM_KEYS = { cover: ['library_600x900', 'library_capsule'], hero: ['library_hero'], logo: ['logo'] };

async function fromSteamCache(id, kind) {
  const base = artSource(id)?.libraryCache;
  const keys = STEAM_KEYS[kind];
  if (!base || !keys) return null;
  for (const key of keys) {
    for (const ext of ['jpg', 'png']) {
      const f = path.join(base, `${id}_${key}.${ext}`);
      if (await fs.promises.access(f).then(() => true, () => false)) return f;
    }
  }
  let entries;
  try {
    entries = await fs.promises.readdir(path.join(base, String(id)), { recursive: true });
  } catch {
    return null;
  }
  for (const key of keys) {
    let hit = null;
    for (const rel of entries) {
      const n = path.basename(rel).toLowerCase();
      if (!n.startsWith(key) || n.includes('blur') || !/\.(jpg|png)$/.test(n)) continue;
      if (!hit || n.includes('2x')) hit = rel;
    }
    if (hit) return path.join(base, String(id), hit);
  }
  return null;
}

async function download(url, target) {
  const part = target + '.part';
  try {
    const r = await store.doFetch(url, 60000);
    if (!r.ok) return false;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 512) return false;
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(part, buf);
    await fs.promises.rename(part, target);
    return true;
  } catch {
    await fs.promises.rm(part, { force: true }).catch(() => {});
    return false;
  }
}

// 同时最多下 6 张；后请求的先下（刚滑到眼前的那几张优先）。
let active = 0;
const waiting = [];
function acquire() {
  if (active < 6) {
    active++;
    return Promise.resolve();
  }
  return new Promise((res) => waiting.push(res));
}
function release() {
  if (waiting.length) waiting.pop()();
  else active--;
}

async function doResolve(id, kind, i) {
  if (kind !== 'ss') {
    const local = await fromSteamCache(id, kind);
    if (local) return local;
  }
  const name = cacheName(id, kind, i);
  const file = path.join(artDir(), name);
  for (const candidate of [file, path.join(artDir('disc_shelf'), name)]) {
    try {
      if ((await fs.promises.stat(candidate)).size > 0) return candidate;
    } catch {}
  }
  const list = urls(id, kind, i);
  if (!list.length) return null;
  await acquire();
  try {
    for (const u of list) if (await download(u, file)) return file;
  } finally {
    release();
  }
  return null;
}

function resolve(id, kind, i = 0) {
  if (!id || !KINDS.includes(kind)) return Promise.resolve(null);
  const key = cacheName(id, kind, i);
  if (!memo.has(key)) {
    const p = doResolve(id, kind, i);
    memo.set(key, p);
    // 没取到的下次重新读取时再试
    p.then((f) => f || memo.delete(key));
  }
  return memo.get(key);
}

function clearMemo() {
  memo.clear();
}

module.exports = { resolve, clearMemo };
