import { _electron } from '/Users/ethanhuang/Desktop/codespace/test/dsh-codex-memory/node_modules/playwright-core/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('verification/naked-sheep-e2e');
const app = await _electron.launch({ executablePath: path.resolve('desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [path.resolve('desktop')] });
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.canvasDesktop?.storage);
  const result = await page.evaluate(async () => {
    const saved = JSON.parse(await window.canvasDesktop.storage.getState('framedock:canvas_store'));
    const folder = saved.state.projectFolders.find(x => x.name === '裸羊逃跑事件');
    const pages = saved.state.projects.filter(x => x.projectFolderId === folder.id);
    if (pages.length !== 1) throw new Error(`Expected one creation page, got ${pages.length}`);
    const p = pages[0];
    return { id: p.id, title: p.title, nodes: p.nodes.length, connections: p.connections.length, viewport: p.viewport, groups: p.nodes.filter(x => x.type === 'group').map(x => x.title) };
  });
  await page.goto(`app://framedock/canvas/${result.id}`);
  await page.waitForSelector('[data-node-id]');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-node-id] img')].some(x => x.complete && x.naturalWidth > 0));
  result.rendered = await page.locator('[data-node-id]').count();
  result.loadedImages = await page.locator('[data-node-id] img').evaluateAll(xs => xs.filter(x => x.complete && x.naturalWidth > 0).length);
  result.brokenImages = await page.locator('[data-node-id] img').evaluateAll(xs => xs.filter(x => x.complete && !x.naturalWidth).length);
  await page.screenshot({ path: path.join(root, 'desktop-merged-canvas.png') });
  await fs.writeFile(path.join(root, 'merged-canvas-check.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await app.close(); }
