import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { finishRun } from './finish-run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const playwright = process.env.PLAYWRIGHT_CORE_PATH;
const { _electron } = await import(playwright ? pathToFileURL(path.resolve(playwright)).href : 'playwright-core');
const output = path.resolve(process.env.FRAMEDOCK_E2E_OUTPUT || path.join(here, 'artifacts'));
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'framedock-desktop-e2e-'));
fs.mkdirSync(path.join(profile, 'home'));
const report = { passed: false, checks: [], runtimeErrors: [], consoleErrors: [], failedRequests: [], systemMessages: [], profile };
const executablePath = path.join(root, 'desktop/node_modules/electron/dist', process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : process.platform === 'win32' ? 'electron.exe' : 'electron');
let app, child, page, connection;
const check = (name, detail = true) => { report.checks.push({ name, detail }); console.log(`PASS ${name}`); };
const capture = name => page.screenshot({ path: path.join(output, `${name}.png`), scale: 'css' });

async function launch() {
  app = await _electron.launch({ executablePath, args: [path.join(here, 'bootstrap.cjs')], env: { ...process.env, HOME: path.join(profile, 'home'), FRAMEDOCK_E2E_PROFILE: profile } });
  child = app.process();
  app.on('console', message => { if (message.text().startsWith('[e2e-')) console.log(message.text()); });
  app.process().stderr?.on('data', chunk => {
    for (const line of String(chunk).split('\n')) if (line.includes('sysctlbyname for kern.hv_vmm_present')) report.systemMessages.push(line.trim());
  });
  page = await app.firstWindow();
  page.on('pageerror', error => report.runtimeErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push({ source: message.location().url.split('?')[0], line: message.location().lineNumber });
  });
  page.on('response', response => { if (response.status() >= 400) report.failedRequests.push({ url: new URL(response.url()).pathname, status: response.status() }); });
  await page.waitForURL('app://framedock/**');
  await page.waitForFunction(() => !!window.canvasDesktop?.storage && document.body.innerText.includes('开始创作'));
  await page.waitForFunction(() => document.querySelectorAll('.fh-logo, .fh-sidebar, aside').length > 0 || document.body.innerText.includes('脑海里的画面'));
  const paths = await app.evaluate(({ app }) => ({ home: app.getPath('home'), userData: app.getPath('userData') }));
  assert.equal(paths.home, path.join(profile, 'home'));
  assert.equal(paths.userData, path.join(profile, 'app-data/FrameDock Desktop'));
  connection = await page.evaluate(async () => {
    const conn = await window.canvasDesktop.getAgentConnection();
    if (!conn) return null;
    const health = await fetch(`${conn.url}/health`);
    const skills = await fetch(`${conn.url}/agent/api/skills`, { headers: { 'x-canvas-agent-token': conn.token } });
    return { url: conn.url, token: conn.token, health: health.status, skills: skills.status };
  });
  assert.equal(connection?.health, 200);
  assert.equal(connection?.skills, 200);
  await page.waitForFunction(() => document.visibilityState === 'visible');
  assert(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.isVisible())));
}

async function close() {
  const url = connection?.url;
  const closed = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  app = null;
  await finishRun(null, child, report, output);
  assert.equal(report.cleanup?.error, undefined, '本轮测试进程组必须清理完成');
  child = null;
  assert(url);
  await assert.rejects(fetch(`${url}/health`));
}

try {
  await launch();
  check('独立数据目录冷启动，真实窗口可见，preload 正常');
  check('真实 Agent 健康检查与鉴权技能接口均返回 200');
  await capture('01-cold-start');
  await page.locator('a.fh-nav[href="/projects"]').click();
  await page.getByRole('heading', { name: '项目库', exact: true }).waitFor();
  await page.getByRole('button', { name: '新建项目', exact: true }).first().click();
  await page.getByLabel('项目名称', { exact: true }).fill('桌面 E2E 项目');
  await page.getByRole('checkbox').uncheck();
  await page.getByRole('button', { name: /^创\s*建$/ }).click();
  await page.getByRole('heading', { name: '桌面 E2E 项目', exact: true }).waitFor();
  const projectUrl = page.url();
  await page.getByRole('button', { name: '新建创作页', exact: true }).first().click();
  await page.getByLabel('创作页名称', { exact: true }).fill('冷启动与恢复');
  await page.getByRole('button', { name: /^创\s*建$/ }).click();
  await page.waitForURL('app://framedock/canvas/**');
  const canvasUrl = page.url();
  await page.locator('[data-canvas-bottom-toolbar]').getByRole('button', { name: '文本', exact: true }).click();
  const node = page.locator('[data-node-id]');
  await node.waitFor();
  await node.locator(':scope > div.relative').first().dblclick();
  await node.locator(':scope > div.relative').first().locator('textarea').fill('真实 Electron 端到端：文本编辑与重启恢复。');
  await node.locator(':scope > div.relative').first().locator('textarea').press('Escape');
  await node.getByText('真实 Electron 端到端：文本编辑与重启恢复。', { exact: true }).waitFor();
  check('通过界面新建项目、创作页并编辑文本');
  await capture('02-text-edited');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64;
    const context = canvas.getContext('2d'); context.fillStyle = '#376bb7'; context.fillRect(0, 0, 96, 64);
    context.fillStyle = '#ffffff'; context.fillText('E2E', 32, 36);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type="file"][accept^="image/"]').setInputFiles({ name: 'e2e.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForFunction(() => document.querySelectorAll('[data-node-id]').length === 2 && [...document.querySelectorAll('[data-node-id] img')].some(img => img.complete && img.naturalWidth === 96));
  check('通过文件输入导入真实 PNG，画布图片解码成功');
  await capture('03-image-imported');
  // 等待既有异步自动保存真正落盘，再验收已保存内容的刷新恢复。
  const deadline = Date.now() + 30_000;
  let persisted = false;
  while (Date.now() < deadline) {
    persisted = await page.evaluate(async () => {
      const value = await window.canvasDesktop.storage.getState('framedock:canvas_store');
      return !!value && JSON.parse(value).state.projects.some(project => project.nodes.length === 2 && project.nodes.some(node => node.metadata?.content === '真实 Electron 端到端：文本编辑与重启恢复。'));
    });
    if (persisted) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(persisted, true, '文本与图片必须真实落盘后才能刷新');
  check('自动保存通过真实桌面存储桥落盘');
  await page.reload();
  await page.locator('[data-node-id]').getByText('真实 Electron 端到端：文本编辑与重启恢复。', { exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-node-id] img')].some(img => img.complete && img.naturalWidth === 96));
  check('刷新后文本、图片及创作页状态恢复');
  const textNodeId = await page.locator('[data-node-id]').filter({ hasText: '真实 Electron 端到端：文本编辑与重启恢复。' }).getAttribute('data-node-id');
  assert(textNodeId);
  const textBody = page.locator(`[data-node-id="${textNodeId}"] > div.relative`).first();
  await textBody.dblclick({ position: { x: 24, y: 24 } });
  await textBody.locator('textarea').fill('真实 Electron 端到端：退出前追加，重启后保留。');
  await textBody.locator('textarea').press('Escape');
  const firstToken = connection.token;
  await close();
  check('正常关闭桌面实例，sidecar 随之退出');
  await launch();
  assert.notEqual(connection.token, firstToken);
  await page.locator('a.fh-nav[href="/projects"]').click();
  await page.getByRole('button', { name: '打开桌面 E2E 项目', exact: true }).click();
  assert.equal(page.url(), projectUrl);
  await page.getByRole('button', { name: '打开冷启动与恢复', exact: true }).click();
  assert.equal(page.url(), canvasUrl);
  await page.locator('[data-node-id]').getByText('真实 Electron 端到端：退出前追加，重启后保留。', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-node-id]').length === 2 && [...document.querySelectorAll('[data-node-id] img')].some(img => img.complete && img.naturalWidth === 96));
  check('退出前最新编辑与图片在重启后恢复，Agent 令牌轮换');
  await capture('04-restarted-canvas');
  await page.getByRole('button', { name: '项目库', exact: true }).click();
  await page.locator('a.fh-nav[href="/skills"]').click();
  await page.getByText('3D动画短片', { exact: true }).first().waitFor();
  check('真实技能页面加载随包技能');
  await capture('05-skills');
  await close();
  assert.deepEqual(report.runtimeErrors, []);
  assert.deepEqual(report.consoleErrors, []);
  assert.deepEqual(report.failedRequests, []);
  report.passed = true;
} catch (error) {
  report.failure = error.message;
  if (page && !page.isClosed()) { report.failurePage = await page.locator('body').innerText().catch(() => 'unavailable'); await capture('failure').catch(() => {}); }
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await finishRun(app, child, report, output);
  if (!report.cleanup?.error && (!child || child.exitCode !== null || child.signalCode !== null)) {
    fs.rmSync(profile, { recursive: true, force: true });
    report.profileRemoved = true;
  }
  if (!report.passed) process.exitCode = 1;
  fs.writeFileSync(path.join(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`证据目录：${output}`);
}
