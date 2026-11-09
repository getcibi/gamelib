// 主界面：顶栏、架子、底部信息、设置、键盘，以及打开盒子。
import { el, formatLastPlayed, formatPlaytime, formatSize } from './util.js';
import { styleById } from './styles.js';
import { Shelf } from './shelf.js';
import { CaseOpen } from './open.js';
import { Dashboard } from './dashboard.js';
import { setLanguage, t } from './i18n.js';

const api = window.gamelib;
const $ = (id) => document.getElementById(id);

const state = {
  cfg: null,
  lib: null,
  shelf: null,
  open: null,
  dash: null,
  focused: 0,
  loading: false,
  savingSettings: false,
};
const style = () => styleById(state.cfg.style);
const visible = () =>
  state.lib ? (state.cfg.installedOnly ? state.lib.games.filter((g) => g.installed) : state.lib.games) : [];

let markReady;
const ready = new Promise((r) => (markReady = r));

// ---------------------------------------------------------------- 读取

function showLoading(p) {
  const box = $('loading');
  box.hidden = false;
  const bar = box.querySelector('i');
  const indeterminate = !p?.total;
  bar.classList.toggle('indeterminate', indeterminate);
  bar.style.width = indeterminate ? '' : `${(p.done / p.total) * 100}%`;
  const message = p?.phase ? t(p.phase) : p?.message || t('starting');
  box.querySelector('p').textContent = p?.total ? `${message}  ${p.done}/${p.total}` : message;
}

async function reload({ showDashboard = false } = {}) {
  if (state.loading || state.savingSettings) return;
  state.loading = true;
  closeOpen(true);
  closeDash(true);
  state.shelf?.destroy();
  state.shelf = null;
  $('top').hidden = true;
  $('info').replaceChildren();
  showLoading({ phase: 'findingSteam' });
  try {
    state.lib = await api.loadLibrary();
  } catch {
    if (state.lib) {
      $('loading').hidden = true;
      $('top').hidden = false;
      buildShelf(state.focused);
      toast(t('refreshFailed'));
    } else {
      showLoading({ phase: 'readFailed' });
    }
    return;
  } finally {
    state.loading = false;
  }
  $('loading').hidden = true;
  $('top').hidden = false;
  buildShelf(0);
  markReady();
  if (showDashboard) {
    toast(syncLabel(state.lib));
    if (state.lib.steamId && !state.lib.demo) openDash();
  }
  // 趁空把插入动画要用的主机模型、着色器先准备好，第一次点光盘就不卡
  setTimeout(() => import('./console3d.js').then((m) => m.warmUp()), 1200);
}

// ---------------------------------------------------------------- 顶栏

function syncLabel(lib) {
  return t({
    synced: 'synced',
    'account-needed': 'accountNeeded',
    denied: 'denied',
    unavailable: 'unavailable',
    error: 'syncError',
    local: lib.steamId ? 'localRecords' : 'chooseAccount',
  }[lib.syncStatus]);
}

const accountLabel = (account) => account.name || t('accountName', { suffix: account.id.slice(-6) });

function renderHeader() {
  const lib = state.lib;
  const installed = lib.games.filter((g) => g.installed).length;
  $('count').textContent = t('shelfCount', { count: visible().length, installed });
  const chip = $('chip');
  chip.hidden = false;
  chip.classList.toggle('warn', lib.demo || !lib.steamId || !['local', 'synced'].includes(lib.syncStatus));
  chip.textContent = lib.demo && lib.syncStatus === 'local' ? t('demoNoSteam') : syncLabel(lib);
  chip.title = chip.textContent;
  chip.onclick = openSettings;
  for (const b of $('filter').children) b.classList.toggle('on', (b.dataset.v === 'installed') === state.cfg.installedOnly);
  for (const b of $('style-seg').children) b.classList.toggle('on', b.dataset.v === state.cfg.style);
}

function setStyle(id) {
  if (state.savingSettings) return;
  if (state.cfg.style === id) return;
  state.cfg.style = id;
  document.body.dataset.style = id;
  api.saveConfig(state.cfg).catch(() => toast(t('saveFailed')));
  if (state.lib) buildShelf(state.focused);
}

function setInstalledOnly(v) {
  if (state.savingSettings) return;
  if (state.cfg.installedOnly === v) return;
  state.cfg.installedOnly = v;
  api.saveConfig(state.cfg).catch(() => toast(t('saveFailed')));
  buildShelf(0);
}

// ---------------------------------------------------------------- 架子 + 信息

function buildShelf(focus) {
  state.shelf?.destroy();
  renderHeader();
  const games = visible();
  if (!games.length) {
    state.shelf = null;
    $('shelf').replaceChildren(el('div.empty', { text: t('noGames') }));
    $('info').replaceChildren();
    return;
  }
  state.focused = Math.min(focus, games.length - 1);
  state.shelf = new Shelf($('shelf'), {
    style: style(),
    games,
    onOpen: openCase,
    onFocus: (i) => {
      state.focused = i;
      renderInfo(games[i]);
    },
  });
  state.shelf.focus = state.focused;
  state.shelf.render(true);
}

function renderInfo(game) {
  const info = $('info');
  const meta = [
    game.developers?.[0],
    t('lastPlayedLabel', { time: formatLastPlayed(game.lastPlayed) }),
    t('playtimeLabel', { time: formatPlaytime(game.playtimeMinutes) }),
    game.installed ? formatSize(game.sizeOnDisk) : t('notInstalled'),
  ].filter(Boolean);
  const block = el(
    'div.info-in',
    {},
    el('div.info-name', { text: game.name }),
    el('div.info-meta', { text: meta.join('   ·   ') }),
    el('div.info-hint', { text: t('shelfHint') }),
  );
  info.replaceChildren(block);
}

// ---------------------------------------------------------------- 开盒

function openCase(game) {
  if (state.open) return;
  state.open = new CaseOpen(document.body, {
    style: style(),
    game,
    onLaunch: () => launch(game),
    onClosed: () => (state.open = null),
  });
}

function closeOpen(immediate) {
  if (!state.open) return;
  if (immediate) {
    state.open.root.remove();
    state.open = null;
  } else {
    state.open.close();
  }
}

async function launch(game) {
  const uri = game.installed ? `steam://rungameid/${game.appId}` : `steam://install/${game.appId}`;
  if (state.lib.demo) {
    toast(t('demoLaunch', { uri }));
    return true;
  }
  return api.launch(game.appId, game.installed);
}

let toastTimer = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
}

// ---------------------------------------------------------------- 数据面板

// 面板按账号统计，不受游戏架的「只看已安装」影响。
function openDash() {
  if (state.dash || !state.lib || state.open || state.loading || state.savingSettings) return;
  const lib = state.lib;
  if (!lib.demo && !lib.steamId) {
    openSettings();
    return;
  }
  const account = lib.accounts.find((item) => item.id === lib.steamId);
  const dashboard = new Dashboard(document.body, {
    games: lib.demo ? lib.games : lib.games.filter((game) => game.inAccountLibrary),
    demo: lib.demo,
    accountStatus: account ? `${accountLabel(account)} · ${syncLabel(lib)}` : '',
    onPick: (game) => {
      // 点了一款游戏：回到架子上并选中它
      if (state.cfg.installedOnly && !game.installed) setInstalledOnly(false);
      const i = visible().indexOf(game);
      if (i >= 0) state.shelf?.goTo(i);
    },
    onClose: () => {
      if (state.dash === dashboard) state.dash = null;
    },
  });
  state.dash = dashboard;
}

function closeDash(immediate) {
  if (!state.dash) return;
  if (immediate) {
    state.dash.root.remove();
    state.dash = null;
  } else {
    state.dash.close();
  }
}

// ---------------------------------------------------------------- 设置

function applyLanguage(value) {
  document.documentElement.lang = setLanguage(value);
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-title]')) node.title = t(node.dataset.i18nTitle);
}

function openSettings() {
  if (state.loading || state.savingSettings) return;
  const dlg = $('settings');
  if (dlg.open) return;
  const key = $('f-key');
  const select = $('f-account');
  const id = $('f-id');
  key.value = state.cfg.apiKey || '';
  key.type = 'password';
  $('f-language').value = state.cfg.language;
  const accounts = state.lib?.accounts || [];
  const selected = state.cfg.steamId;
  select.replaceChildren(
    el('option', { value: '', text: t('autoAccount') }),
    ...accounts.map((account) => el('option', { value: account.id, text: accountLabel(account) })),
    el('option', { value: 'manual', text: t('manualAccount') }),
  );
  select.value = selected && !accounts.some((account) => account.id === selected) ? 'manual' : selected || '';
  id.value = select.value === 'manual' ? selected : '';
  updateManualAccount();
  $('f-where').textContent = t('keyStorage');
  dlg.returnValue = '';
  dlg.showModal();
}

function updateManualAccount() {
  const selection = $('f-account').value;
  const manual = selection === 'manual';
  $('f-id-row').hidden = !manual;
  $('f-id').disabled = !manual;
  $('f-id').required = manual;
  $('f-id-help').textContent = selection || state.lib?.automaticSteamId
    ? t('accountHelp')
    : t('chooseAccountHelp');
}

$('f-account').addEventListener('change', updateManualAccount);
$('settings-cancel').addEventListener('click', () => $('settings').close());
$('settings').querySelector('form').addEventListener('submit', (event) => {
  const key = $('f-key').value.trim();
  const accountChanged = state.cfg.steamId && !$('f-account').value;
  if (key && (key !== state.cfg.apiKey || accountChanged) && !$('f-account').value && !state.lib?.automaticSteamId) {
    event.preventDefault();
    $('f-account').focus();
  }
});
$('settings').addEventListener('close', async () => {
  if ($('settings').returnValue !== 'save') return;
  const account = $('f-account').value;
  const cfg = {
    ...state.cfg,
    apiKey: $('f-key').value.trim(),
    steamId: account === 'manual' ? $('f-id').value.trim() : account,
    language: $('f-language').value,
  };
  const languageOnly = cfg.language !== state.cfg.language
    && cfg.apiKey === state.cfg.apiKey && cfg.steamId === state.cfg.steamId;
  state.savingSettings = true;
  try {
    await api.saveConfig(cfg);
    state.cfg = cfg;
    applyLanguage(cfg.language);
  } catch {
    toast(t('saveFailed'));
    return;
  } finally {
    state.savingSettings = false;
  }
  await reload({ showDashboard: !!cfg.apiKey && !languageOnly });
});
$('f-key-eye').addEventListener('click', () => {
  const k = $('f-key');
  k.type = k.type === 'password' ? 'text' : 'password';
});
$('apikey-link').addEventListener('click', () => api.openApiKeyPage());
$('settings-btn').addEventListener('click', openSettings);
$('dash-btn').addEventListener('click', openDash);
$('reload-btn').addEventListener('click', () => reload());
$('filter').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setInstalledOnly(b.dataset.v === 'installed');
});
$('style-seg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setStyle(b.dataset.v);
});

// ---------------------------------------------------------------- 键盘

window.addEventListener('keydown', (e) => {
  if ($('settings').open) return;
  const k = e.key;
  if (state.dash) {
    if (k === 'Escape' || k === 'd' || k === 'D') {
      state.dash.close();
      e.preventDefault();
    }
    return;
  }
  if ((k === 'd' || k === 'D') && !state.open && !e.metaKey && !e.ctrlKey) {
    openDash();
    e.preventDefault();
    return;
  }
  if (state.open) {
    if (k === 'Escape') state.open.close();
    else if (k === 'Enter' || k === ' ') state.open.launch();
    else return;
    e.preventDefault();
    return;
  }
  const shelf = state.shelf;
  if (!shelf) return;
  if (k === 'ArrowLeft') shelf.step(-1);
  else if (k === 'ArrowRight') shelf.step(1);
  else if (k === 'Home') shelf.goTo(0);
  else if (k === 'End') shelf.goTo(shelf.count - 1);
  else if (k === 'Enter' || k === ' ') openCase(visible()[shelf.focusedIndex]);
  else return;
  e.preventDefault();
});

api.onProgress(showLoading);

// 调试截图脚本用
window.__debug = {
  ready,
  setStyle,
  goTo: (i) => state.shelf?.goTo(i),
  open: () => state.shelf && openCase(visible()[state.shelf.focusedIndex]),
  launch: () => state.open?.launch(),
  scrub: (v) => state.shelf?.setRaw(v),
  rotate: (yaw, pitch) => {
    if (!state.open) return;
    state.open.oyaw = yaw;
    state.open.opitch = pitch;
    state.open.frame();
  },
  resetView: () => state.open?.resetView(0),
  dashboard: () => openDash(),
  dashScroll: (y) => state.dash?.scroll.scrollTo(0, y),
  // 量帧耗时：ms 毫秒里每一帧的间隔，返回统计和最慢的几帧（相对开始的时间）
  measure: (ms) =>
    new Promise((resolve) => {
      const t0 = performance.now();
      let last = t0;
      const gaps = [];
      const step = (now) => {
        gaps.push([Math.round(now - t0), +(now - last).toFixed(1)]);
        last = now;
        if (now - t0 < ms) requestAnimationFrame(step);
        else {
          const d = gaps.map((g) => g[1]).sort((a, b) => a - b);
          resolve({
            frames: gaps.length,
            p50: d[Math.floor(d.length / 2)],
            p95: d[Math.floor(d.length * 0.95)],
            max: d[d.length - 1],
            over33: gaps.filter((g) => g[1] > 33).length,
            worst: [...gaps].sort((a, b) => b[1] - a[1]).slice(0, 8),
          });
        }
      };
      requestAnimationFrame(step);
    }),
  // 单独看插入动画的某一帧
  consoleFrame: async (styleId, lt) => {
    const { ConsoleStage } = await import('./console3d.js');
    const game = visible()[state.shelf?.focusedIndex ?? 0];
    const key = `${styleId}/${game.appId}`;
    if (window.__stageKey !== key) {
      window.__stage?.destroy();
      const host = document.getElementById('debug-stage') || document.body.appendChild(el('div', { id: 'debug-stage', style: { position: 'fixed', inset: '0', zIndex: 80, background: '#0b1020' } }));
      window.__stage = new ConsoleStage(host, { style: styleById(styleId), game });
      window.__stageKey = key;
      if (!(await window.__stage.prepare())) return 'failed';
      window.__stage.setOpacity(1);
    }
    window.__stage.setTime(lt);
    return 'ok';
  },
};

(async () => {
  state.cfg = await api.getConfig();
  state.cfg.language = state.cfg.language === 'en' ? 'en' : 'zh-CN';
  applyLanguage(state.cfg.language);
  document.body.dataset.style = state.cfg.style;
  reload();
})();
