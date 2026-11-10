import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { finishRun } from './finish-run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const { _electron } = await import(process.env.PLAYWRIGHT_CORE_PATH ? pathToFileURL(path.resolve(process.env.PLAYWRIGHT_CORE_PATH)).href : 'playwright-core');

test('退出被阻塞时先写失败报告，再终止隔离实例及 sidecar', { timeout: 30_000 }, async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'framedock-cleanup-e2e-'));
  fs.mkdirSync(path.join(profile, 'home'));
  const output = path.resolve(process.env.FRAMEDOCK_E2E_OUTPUT || path.join(here, 'artifacts'), 'cleanup');
  fs.mkdirSync(output, { recursive: true });
  let app, child;
  try {
    app = await _electron.launch({ executablePath: path.join(root, 'desktop/node_modules/electron/dist', process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : process.platform === 'win32' ? 'electron.exe' : 'electron'), args: [path.join(here, 'bootstrap.cjs')], env: { ...process.env, HOME: path.join(profile, 'home'), FRAMEDOCK_E2E_PROFILE: profile } });
    child = app.process();
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.canvasDesktop?.storage && document.body.innerText.includes('脑海里的画面'));
    const url = await page.evaluate(async () => (await window.canvasDesktop.getAgentConnection()).url);
    // 只在隔离测试窗口注入退出阻塞，覆盖真实故障的清理路径。
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].on('close', event => event.preventDefault()));
    const report = { passed: false, failure: '回归测试注入的退出阻塞', profile };
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true }));
    const finishing = finishRun(app, child, report, output);
    assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'results.json'), 'utf8')).failure, report.failure, '等待退出前必须覆盖旧成功报告');
    await finishing;
    const saved = JSON.parse(fs.readFileSync(path.join(output, 'results.json'), 'utf8'));
    assert.equal(saved.passed, false);
    assert.equal(saved.cleanup.forced, true);
    assert.equal(saved.cleanup.error, undefined);
    assert(child.exitCode !== null || child.signalCode !== null);
    await assert.rejects(fetch(`${url}/health`));
    fs.rmSync(profile, { recursive: true, force: true });
    saved.profileRemoved = true;
    fs.writeFileSync(path.join(output, 'results.json'), `${JSON.stringify(saved, null, 2)}\n`);
    app = null;
  } finally {
    if (app) {
      const report = { passed: false, failure: '清理回归未通过' };
      await finishRun(app, child, report, output);
      if (!report.cleanup?.error && (child.exitCode !== null || child.signalCode !== null)) fs.rmSync(profile, { recursive: true, force: true });
    }
  }
});
