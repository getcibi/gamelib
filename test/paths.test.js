const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const paths = require('../src/main/paths');

test('gamelib 读取旧版设置，保存后优先使用新路径', async (t) => {
  const legacy = path.join(paths.dataDir('disc_shelf'), 'config.json');
  const current = paths.dataFile('config.json');
  const saved = new Map([[legacy, JSON.stringify({ apiKey: 'example-key', language: 'en' })]]);
  t.mock.method(fs, 'existsSync', (file) => saved.has(file));
  t.mock.method(fs.promises, 'readFile', async (file) => {
    if (!saved.has(file)) throw new Error('Missing fixture file');
    return saved.get(file);
  });
  t.mock.method(fs.promises, 'mkdir', async () => {});
  t.mock.method(fs.promises, 'writeFile', async (file, value) => saved.set(file, value));

  const config = await paths.loadConfig();
  assert.equal(config.apiKey, 'example-key');
  assert.equal(config.language, 'en');
  assert.equal(saved.has(current), false);

  await paths.saveConfig({ ...config, apiKey: '' });
  assert.equal(JSON.parse(saved.get(current)).apiKey, '');
  assert.equal(JSON.parse(saved.get(legacy)).apiKey, 'example-key');
  assert.equal((await paths.loadConfig()).apiKey, '');
});
