import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const base = 'http://192.168.11.2:8188';
const receiptPath = path.join(root, 'comfy-receipt.json');
const source = '/Users/ethanhuang/Desktop/others/fnos/media/04_知识与模板/workflows/WorkFisher_原版API_20261019/01_角色_作者原文_API.json';
const prompt = '最高画质，杰作，超精细，干净棚拍光线，一位中国农村中年男性，亚洲面孔，东亚五官，45岁，朴实克制的农民，身形清瘦，哑光皮肤质感，日晒肤色，无油光，不泛油，黑色短发夹少量白发，双眼都睁开，对称双眼，神情平静，穿八十年代中国农村素色深蓝粗布上衣，灰黑长裤，旧黑布鞋，标准站立姿势，双手自然垂放，全身可见，从头到脚都在画面内，正常透视，50mm标准镜头，干净浅灰色棚拍背景，柔和均匀漫射光，正常身材比例，光影层次感，电影质感，艺术氛围，高级的氛围感，梦幻，';
let receipt;
try { receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!receipt) {
  const workflow = JSON.parse(await fs.readFile(source, 'utf8'));
  workflow['248'].inputs.text = prompt;
  workflow['241'].inputs.filename_prefix = 'FrameDock_E2E/naked_sheep_character';
  await fs.writeFile(path.join(root, 'submitted-workflow.json'), JSON.stringify(workflow, null, 2));
  await fs.writeFile(receiptPath, JSON.stringify({ status: 'submitting', source, prompt }, null, 2), { flag: 'wx' });
  const response = await fetch(`${base}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: 'framedock-naked-sheep-e2e' }) });
  const data = await response.json();
  receipt = { status: response.ok && data.prompt_id ? 'queued' : 'rejected', source, prompt, ...data };
  await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  if (!response.ok || !data.prompt_id) throw new Error(JSON.stringify(data));
}
if (!receipt.prompt_id) throw new Error('已有提交记录但没有 prompt_id；为避免重复生成，停止自动提交。');
const response = await fetch(`${base}/history/${encodeURIComponent(receipt.prompt_id)}`);
if (!response.ok) throw new Error(`History HTTP ${response.status}`);
const history = await response.json();
const run = history[receipt.prompt_id];
if (!run) { console.log(JSON.stringify({ prompt_id: receipt.prompt_id, status: receipt.status })); process.exit(0); }
await fs.writeFile(path.join(root, 'comfy-history.json'), JSON.stringify(history, null, 2));
const files = [];
for (const output of Object.values(run.outputs || {})) {
  for (const image of output.images || []) {
    const params = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output' });
    const media = await fetch(`${base}/view?${params}`);
    if (!media.ok) throw new Error(`Output HTTP ${media.status}`);
    const destination = path.join(root, path.basename(image.filename));
    await fs.writeFile(destination, Buffer.from(await media.arrayBuffer()));
    files.push(destination);
  }
}
receipt = { ...receipt, status: run.status?.status_str || 'finished', completed: run.status?.completed, files };
await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ prompt_id: receipt.prompt_id, status: receipt.status, completed: receipt.completed, files }));
