import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { finishRun } from './finish-run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const { _electron } = await import(process.env.PLAYWRIGHT_CORE_PATH ? pathToFileURL(path.resolve(process.env.PLAYWRIGHT_CORE_PATH)).href : 'playwright-core');
const output = path.resolve(process.env.FRAMEDOCK_E2E_OUTPUT || path.join(here, 'artifacts'));
fs.mkdirSync(output, { recursive: true });
const executablePath = path.join(root, 'desktop/node_modules/electron/dist', process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : process.platform === 'win32' ? 'electron.exe' : 'electron');

for (const scenario of ['route', 'blocked', 'reload']) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'framedock-close-e2e-'));
  fs.mkdirSync(path.join(profile, 'home'));
  const scenarioOutput = path.join(output, `lifecycle-${scenario}`);
  fs.mkdirSync(scenarioOutput, { recursive: true });
  const report = { passed: false, scenario, events: [], profile };
  let app, child;
  try {
    app = await _electron.launch({ executablePath, args: [path.join(here, 'bootstrap.cjs')], env: { ...process.env, HOME: path.join(profile, 'home'), FRAMEDOCK_E2E_PROFILE: profile } });
    child = app.process();
    app.on('console', message => { if (message.text().startsWith('[e2e-lifecycle]')) report.events.push(message.text()); });
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.canvasDesktop?.storage && document.body.innerText.includes('脑海里的画面'));
    await page.locator('a.fh-nav[href="/projects"]').click();
    await page.getByRole('heading', { name: '项目库', exact: true }).waitFor();
    if (scenario === 'blocked') {
      const original = page.url();
      await app.evaluate(({ BrowserWindow }) => {
        globalThis.__e2eBlockedNavigation = new Promise(resolve => {
          BrowserWindow.getAllWindows()[0].webContents.once('will-navigate', event => resolve(event.defaultPrevented));
        });
      });
      await page.evaluate(() => { window.location.href = 'https://framedock-e2e.invalid/blocked'; });
      assert.equal(await app.evaluate(() => globalThis.__e2eBlockedNavigation), true, '外部跳转必须被现有安全策略拦截');
      assert.equal(page.url(), original);
      report.blockedNavigation = true;
    }
    if (scenario === 'reload') {
      const readyCount = report.events.filter(event => event.includes('framedock:close-ready')).length;
      await page.reload();
      await page.getByRole('heading', { name: '项目库', exact: true }).waitFor();
      assert(report.events.filter(event => event.includes('framedock:close-ready')).length > readyCount, '重载后必须重新建立保存握手');
    }
    const closed = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    assert(report.events.some(event => event.includes('framedock:close-result')), '关闭窗口必须收到真实保存结果');
    report.passed = true;
    app = null;
    console.log(`PASS ${scenario}：保存握手完成，窗口正常退出`);
  } catch (error) {
    report.failure = error.message;
    process.exitCode = 1;
    console.error(`FAIL ${scenario}：${error.message}`);
  } finally {
    await finishRun(app, child, report, scenarioOutput);
    if (report.cleanup?.error || (child && child.exitCode === null && child.signalCode === null)) process.exitCode = 1;
    else {
      fs.rmSync(profile, { recursive: true, force: true });
      report.profileRemoved = true;
    }
    fs.writeFileSync(path.join(scenarioOutput, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
    if (!report.passed) process.exitCode = 1;
  }
}
