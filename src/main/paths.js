// 程序自己的文件放哪：配置、商店信息缓存放 data，图片放 art。
const fs = require('fs');
const os = require('os');
const path = require('path');

function dataDir(name = 'gamelib') {
  const env = process.env;
  if (process.platform === 'win32') {
    return path.join(env.APPDATA || env.LOCALAPPDATA || os.tmpdir(), name);
  }
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library/Application Support', name);
  return path.join(home, '.local/share', name);
}

function artDir(name = 'gamelib') {
  const env = process.env;
  if (process.platform === 'win32') {
    return path.join(env.LOCALAPPDATA || env.APPDATA || os.tmpdir(), name, 'art');
  }
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library/Caches', name, 'art');
  return path.join(home, '.cache', name, 'art');
}

const dataFile = (name) => path.join(dataDir(), name);

// 旧版配置和缓存只在新路径没有对应文件时读取。
function dataFileForRead(name) {
  const file = dataFile(name);
  return fs.existsSync(file) ? file : path.join(dataDir('disc_shelf'), name);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value, pretty = false) {
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, JSON.stringify(value, null, pretty ? 2 : 0));
  } catch {
    // 写不了缓存不影响使用
  }
}

// 用户设置：盒子样式、Web API Key、SteamID、只看已安装。
const DEFAULT_CONFIG = { style: 'disc', apiKey: '', steamId: '', installedOnly: false, language: 'zh-CN' };

async function loadConfig() {
  const j = await readJson(dataFileForRead('config.json'), {});
  return { ...DEFAULT_CONFIG, ...(j && typeof j === 'object' ? j : {}) };
}

let configWrite = Promise.resolve();

function saveConfig(cfg) {
  const clean = {};
  for (const k of Object.keys(DEFAULT_CONFIG)) {
    clean[k] = cfg[k] ?? DEFAULT_CONFIG[k];
  }
  const write = configWrite.then(async () => {
    const file = dataFile('config.json');
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, JSON.stringify(clean, null, 2), 'utf8');
    return clean;
  });
  configWrite = write.catch(() => {});
  return write;
}

module.exports = { dataDir, artDir, dataFile, dataFileForRead, readJson, writeJson, loadConfig, saveConfig };
