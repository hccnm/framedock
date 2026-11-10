import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function finishRun(app, child, report, output) {
  const save = () => fs.writeFileSync(path.join(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
  // 先保留本轮结果，退出卡住也不会留下上一轮的成功报告。
  save();
  if (!child) return;
  report.cleanup = { forced: false };
  if (app && child.exitCode === null && child.signalCode === null) {
    try {
      await Promise.all([
        app.waitForEvent('close', { timeout: 5_000 }),
        app.evaluate(({ BrowserWindow, app }) => {
          const windows = BrowserWindow.getAllWindows();
          if (windows.length) windows.forEach(window => window.close());
          else app.quit();
        }),
      ]);
    } catch (error) {
      report.passed = false;
      report.cleanup = { forced: true, reason: error.message };
      save();
    }
  }
  try {
    // Playwright 的 POSIX 进程组也包含退出后仍可能写缓存的 CLI 探测子进程。
    assert(child.pid && child.spawnargs.includes(path.join(here, 'bootstrap.cjs')), '拒绝终止非本轮测试进程');
    const exited = child.exitCode !== null || child.signalCode !== null;
    let timer;
    const stopped = exited ? Promise.resolve() : new Promise((resolve, reject) => {
      child.once('exit', resolve);
      timer = setTimeout(() => reject(new Error('隔离测试进程未能退出')), 5_000);
    });
    try {
      if (process.platform === 'win32') {
        if (!exited) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { timeout: 5_000, stdio: 'ignore' });
      } else process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    } finally {
      await stopped.finally(() => clearTimeout(timer));
    }
  } catch (error) {
    report.passed = false;
    report.cleanup.error = error.message;
  }
  save();
}
