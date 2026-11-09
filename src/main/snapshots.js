// 调试用：设了 GAMELIB_SNAP=<目录> 就自己点一遍界面，每一步存一张 PNG，然后退出。
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const debugValue = (name) => process.env[`GAMELIB_${name}`] ?? process.env[`DISC_SHELF_${name}`];

async function run(win, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const snap = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG());
  };
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await js('window.__debug.ready');
  // GAMELIB_PERF=1：打开盒子、等它开好，点光盘 / 卡带，量 4.5 秒里的帧耗时
  if (debugValue('PERF')) {
    const out = {};
    for (const st of ['disc', 'card']) {
      await js(`__debug.setStyle('${st}')`);
      await sleep(1500);
      await js('__debug.goTo(2)');
      await sleep(1000);
      out[st + '_open'] = await js('(async () => { const m = __debug.measure(2400); void __debug.open(); return m; })()');
      await sleep(1500);
      out[st + '_launch'] = await js('(async () => { const m = __debug.measure(4500); void __debug.launch(); return m; })()');
      await sleep(4000);
    }
    fs.writeFileSync(path.join(dir, 'perf.json'), JSON.stringify(out, null, 1));
    app.quit();
    return;
  }
  // GAMELIB_CONSOLE=1：只截插入动画的几帧
  const consoleFrames = debugValue('CONSOLE');
  if (consoleFrames) {
    await js('__debug.goTo(2)');
    await sleep(1200);
    for (const st of ['disc', 'card']) {
      for (const lt of consoleFrames === '1' ? [0.15, 0.45, 0.62, 0.75, 1] : consoleFrames.split(',').map(Number)) {
        const r = await js(`__debug.consoleFrame('${st}', ${lt})`);
        await sleep(lt === 0.15 ? 1500 : 150);
        await js(`__debug.consoleFrame('${st}', ${lt})`);
        await snap(`console_${st}_${String(lt).replace('.', '')}_${r}`);
      }
    }
    app.quit();
    return;
  }
  // GAMELIB_DASH=1：打开数据面板，从上到下截几张
  if (debugValue('DASH')) {
    await sleep(1500);
    await snap('dash_0_shelf');
    await js('__debug.dashboard()');
    await sleep(500);
    await snap('dash_1_entering');
    await sleep(2600);
    await snap('dash_2_top');
    for (const [i, y] of [[3, 560], [4, 1100], [5, 1700]]) {
      await js(`__debug.dashScroll(${y})`);
      await sleep(400);
      await snap(`dash_${i}_scroll${y}`);
    }
    app.quit();
    return;
  }
  const only = debugValue('SNAP_STYLES');
  for (const style of only ? only.split(',') : ['disc', 'card']) {
    await js(`__debug.setStyle('${style}')`);
    await sleep(2500);
    await snap(`${style}_1_shelf`);
    await js('__debug.goTo(2)');
    await sleep(1300);
    await snap(`${style}_2_shelf_moved`);
    await js('__debug.scrub(2.45)');
    await sleep(150);
    await snap(`${style}_2b_scrub_a`);
    await js('__debug.scrub(2.55)');
    await sleep(150);
    await snap(`${style}_2c_scrub_b`);
    await js('__debug.goTo(2)');
    await sleep(800);
    await js('void __debug.open()');
    await sleep(450);
    await snap(`${style}_3_entering`);
    await sleep(700);
    await snap(`${style}_4_opening`);
    await sleep(450);
    await snap(`${style}_5_opening`);
    await sleep(1500);
    await snap(`${style}_6_open`);
    await js('__debug.rotate(1.1, 0.35)');
    await sleep(200);
    await snap(`${style}_6b_rotated`);
    await js('__debug.rotate(2.9, 0.2)');
    await sleep(200);
    await snap(`${style}_6c_back`);
    await js('void __debug.resetView()');
    await sleep(300);
    await js('void __debug.launch()');
    await sleep(550);
    await snap(`${style}_7_lift`);
    for (const [ms, name] of [[700, '8_console'], [1300, '9_insert'], [900, '10_inserted'], [700, '11_power']]) {
      await sleep(ms);
      await snap(`${style}_${name}`);
    }
    await sleep(4000);
  }
  app.quit();
}

module.exports = { run };
