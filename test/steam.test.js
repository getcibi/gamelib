const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseVdf, vget } = require('../src/main/vdf');
const steam = require('../src/main/steam');
const store = require('../src/main/store');

test('解析 VDF：嵌套、转义、注释、大小写', () => {
  const v = parseVdf(`
// comment
"AppState"
{
  "appid"   "570"
  "name"    "Dota \\"2\\""
  "UserConfig" { "language" "schinese" }
}`);
  assert.strictEqual(vget(v, 'appstate').appid, '570');
  assert.strictEqual(v.AppState.name, 'Dota "2"');
  assert.strictEqual(vget(vget(v, 'AppState'), 'userconfig').language, 'schinese');
});

test('解析 VDF：不带引号的值和缺右括号', () => {
  const v = parseVdf('"a" { b c "d" { "e" "1"');
  assert.strictEqual(v.a.b, 'c');
  assert.strictEqual(v.a.d.e, '1');
});

test('扫描两个游戏库、过滤工具、用 localconfig 补上次游玩时间', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'steam_'));
  const root = path.join(tmp, 'Steam');
  const lib2 = path.join(tmp, 'D', 'SteamLibrary');
  const put = (p, text) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  };
  const q = (s) => s.replace(/\\/g, '\\\\');
  put(path.join(root, 'steamapps/libraryfolders.vdf'),
    `"libraryfolders" { "0" { "path" "${q(root)}" } "1" { "path" "${q(lib2)}" } }`);
  put(path.join(root, 'steamapps/appmanifest_367520.acf'),
    '"AppState" { "appid" "367520" "name" "Hollow Knight" "installdir" "Hollow Knight" "SizeOnDisk" "100" }');
  put(path.join(root, 'steamapps/appmanifest_228980.acf'),
    '"AppState" { "appid" "228980" "name" "Steamworks Common Redistributables" }');
  put(path.join(lib2, 'steamapps/appmanifest_1245620.acf'),
    '"AppState" { "appid" "1245620" "name" "ELDEN RING" "installdir" "ELDEN RING" "LastPlayed" "1700000000" }');
  put(path.join(root, 'userdata/123/config/localconfig.vdf'),
    '"UserLocalConfigStore" { "Software" { "Valve" { "Steam" { "apps" { "367520" { "LastPlayed" "1800000000" "Playtime" "42" } } } } } }');

  const games = await steam.scan(root);
  assert.deepStrictEqual(games.map((g) => g.name), ['Hollow Knight', 'ELDEN RING']);
  assert.strictEqual(games[0].lastPlayed, 1800000000);
  assert.strictEqual(games[0].playtimeMinutes, 42);
  assert.strictEqual(games[1].installDir, path.join(lib2, 'steamapps/common/ELDEN RING'));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('启动地址：装了就启动，没装就安装', () => {
  assert.strictEqual(steam.launchUri(620, true), 'steam://rungameid/620');
  assert.strictEqual(steam.launchUri(620, false), 'steam://install/620');
});

test('保存 Key 后同步选定账号，保留其本地游玩记录并隔离其他账号', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gamelib_account_'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.after(() => store.setFetch(globalThis.fetch));
  const put = (file, text) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  };
  const account = '76561197960265851';
  const other = '76561197960266184';
  const records = (apps) => `"UserLocalConfigStore" { "Software" { "Valve" { "Steam" { "apps" { ${apps} } } } } }`;
  put('config/loginusers.vdf', `"users" { "${other}" { "PersonaName" "Other" } "${account}" { "PersonaName" "Selected" } }`);
  put('userdata/123/config/localconfig.vdf', records('"100" { "Playtime" "60" } "200" { "Playtime" "45" }'));
  put('userdata/456/config/localconfig.vdf', records('"100" { "Playtime" "900" } "300" { "Playtime" "600" }'));
  put('steamapps/appmanifest_300.acf', '"AppState" { "appid" "300" "name" "Other game" "LastPlayed" "1700000000" }');
  t.mock.method(store, 'fetchAll', async (ids) =>
    new Map(ids.map(id => [id, { type: 0, name: `Game ${id}` }])));
  const load = (cfg) => steam.loadLibrary(cfg, () => {}, async () => root);
  let requests = 0;
  store.setFetch(async (url) => {
    requests++;
    assert.equal(new URL(url).searchParams.get('steamid'), account);
    return Response.json({ response: { games: [{ appid: 100, playtime_forever: 90 }, { appid: 400, playtime_forever: 0 }] } });
  });

  const unresolved = await load({ apiKey: 'test' });
  assert.equal(unresolved.syncStatus, 'account-needed');
  assert.equal(requests, 0);
  const synced = await load({ apiKey: 'test', steamId: account });
  assert.equal(synced.syncStatus, 'synced');
  assert.equal(requests, 1);
  const dashboard = synced.games.filter(g => g.inAccountLibrary);
  assert.deepEqual(dashboard.map(g => [g.appId, g.playtimeMinutes]), [[100, 90], [200, 45], [400, 0]]);
  const unrelated = synced.games.find(g => g.appId === 300);
  assert.equal(unrelated.playtimeMinutes, 0);
  assert.equal(unrelated.lastPlayed, null);

  store.setFetch(async () => new Response(null, { status: 403 }));
  const fallback = await load({ apiKey: 'test', steamId: account });
  assert.equal(fallback.syncStatus, 'denied');
  assert.equal(fallback.games.find(g => g.appId === 100).playtimeMinutes, 60);
});
