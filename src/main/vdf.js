// Valve KeyValues 文本格式（libraryfolders.vdf、appmanifest_*.acf、
// localconfig.vdf 都是这种）的最小解析器。
// 结构就是 "键" "值" 或 "键" { ... } 的嵌套；结果是普通对象，值是字符串或下一层对象。

const OPEN = Symbol('{');
const CLOSE = Symbol('}');

function parseVdf(src) {
  let i = 0;
  const n = src.length;

  function token() {
    while (i < n) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '﻿') {
        i++;
      } else if (c === '/' && src[i + 1] === '/') {
        while (i < n && src[i] !== '\n') i++;
      } else {
        break;
      }
    }
    if (i >= n) return null;
    const c = src[i];
    if (c === '{') { i++; return OPEN; }
    if (c === '}') { i++; return CLOSE; }
    if (c === '"') {
      i++;
      let out = '';
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < n) {
          const e = src[i + 1];
          out += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          i += 2;
        } else {
          out += src[i++];
        }
      }
      i++;
      return out;
    }
    const start = i;
    while (i < n && !' \t\r\n{}"'.includes(src[i])) i++;
    return src.slice(start, i);
  }

  function block() {
    const m = {};
    for (;;) {
      const key = token();
      if (key === null || key === CLOSE) return m;
      if (typeof key !== 'string') continue;
      const value = token();
      if (value === OPEN) m[key] = block();
      else if (typeof value === 'string') m[key] = value;
      else return m;
    }
  }

  return block();
}

// Steam 的键大小写不统一（AppState / appstate），统一不区分大小写地取。
function vget(map, key) {
  if (!map || typeof map !== 'object') return undefined;
  if (map[key] !== undefined) return map[key];
  const k = key.toLowerCase();
  for (const [kk, v] of Object.entries(map)) {
    if (kk.toLowerCase() === k) return v;
  }
  return undefined;
}

// 一路往下取：vpath(cfg, 'UserLocalConfigStore', 'Software', 'Valve')
function vpath(map, ...keys) {
  let cur = map;
  for (const k of keys) cur = vget(cur, k);
  return cur;
}

module.exports = { parseVdf, vget, vpath };
