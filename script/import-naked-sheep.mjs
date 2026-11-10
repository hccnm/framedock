import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createDesktopStorage } from '../desktop/dist/storage-files.js';

// Run only after stopping this session's Electron; no config or source scripts are read/executed.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(process.argv[2] || '/Users/ethanhuang/Desktop/others/fnos/media');
const userData = path.join(os.homedir(), 'Library/Application Support/FrameDock Desktop');
const verification = path.join(repo, 'verification', 'naked-sheep-import');
try {
    const manifest = JSON.parse(await fs.readFile(path.join(verification, 'manifest.json'), 'utf8'));
    if (manifest.merge?.status === 'merged') {
        console.log('裸羊逃跑事件已合并为单创作页，跳过导入以保留现有编辑。');
        process.exit(0);
    }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const projectSource = path.join(source, '01_项目/内容作品/裸羊逃跑事件');
const workflowSource = path.join(source, '04_知识与模板/workflows/WorkFisher_原版API_20261019');
const skillSource = path.join(source, '.agents/skills/fisher-storylens');
const skillName = 'korean-thriller-asset-to-video'; // Exact name declared by this source SKILL.md.
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const id = (kind, name) => `sheep_${kind}_${sha(name).slice(0, 24)}`;
const storage = createDesktopStorage(userData, { available: () => false, encrypt: () => { throw Error('禁止读取配置'); }, decrypt: () => { throw Error('禁止读取配置'); } });
const now = new Date().toISOString();
const processes = execFileSync('ps', ['-axo', 'command'], { encoding: 'utf8' });
assert(!processes.split('\n').some((line) => line.includes('/framedock/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')), '请先停止 Electron');
async function files(root) {
    const result = [];
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        const file = path.join(root, entry.name);
        assert(!entry.isSymbolicLink(), `不跟随链接: ${file}`);
        if (entry.isDirectory()) result.push(...await files(file));
        else if (entry.isFile() && entry.name !== '.DS_Store') result.push(file);
    }
    return result.sort();
}
const workflowNames = ['01_角色_作者原文_API.json', '02_三视图_作者原文_API.json', '03_场景_作者原文_API.json', '04_H3_作者原文_双参考_API.json', '04_H3_作者原文_六参考_API.json', '05_角色含SeedVR2_作者原文_API.json'];
const excludedPaths = ['90_历史版本/', '04_制作过程/production/Fisher资产补充_20261020/', '03_项目素材/首帧/', '03_项目素材/视频片段/'];
const groups = ['重构资产_20261019', '角色设定', '场景设定', '道具设定'];
const images = (await Promise.all(groups.map(async (group) => (await files(path.join(projectSource, '03_项目素材', group))).filter((file) => /\.(png|jpe?g|webp)$/i.test(file))))).flat();
const audios = (await files(path.join(projectSource, '03_项目素材/项目音频'))).filter((file) => /\.(wav|flac|mp3|m4a|ogg)$/i.test(file));
const texts = (await Promise.all(['00_项目说明', '01_需求与脚本'].map((dir) => files(path.join(projectSource, dir))))).flat();
assert([...images, ...audios, ...texts].every((file) => !excludedPaths.some((prefix) => path.relative(projectSource, file).startsWith(prefix))), '禁止导入作废补充图、历史首帧及旧视频');
assert.equal(images.length, 150); assert.equal(audios.length, 14); assert.equal(texts.length, 6);
assert(texts.every((file) => /\.(md|txt)$/i.test(file)), '发现未支持的脚本文档');
const manifestPath = path.join(verification, 'manifest.json');
let previous;
try { previous = JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const original = {};
const states = {};
const backup = path.join(verification, 'backups', now.replaceAll(':', '-'));
await fs.mkdir(backup, { recursive: true });
for (const name of ['canvas', 'asset', 'comfyui']) {
    const key = `framedock:${name}_store`;
    original[name] = await storage.getState(key);
    assert(original[name], `缺少状态 ${name}`);
    states[name] = JSON.parse(original[name]);
    assert.equal(states[name].version, 0, '未知状态版本，拒绝覆盖');
    await fs.writeFile(path.join(backup, `${name}_store.json`), original[name], { mode: 0o600, flag: 'wx' });
}
const canvas = states.canvas.state, assets = states.asset.state.assets, comfy = states.comfyui.state;
assert(Array.isArray(canvas.projects) && Array.isArray(canvas.projectFolders) && Array.isArray(assets) && Array.isArray(comfy.workflows));
const folderId = id('folder', '裸羊逃跑事件');
if (!canvas.projectFolders.some((folder) => folder.id === folderId)) canvas.projectFolders.push({ id: folderId, name: '裸羊逃跑事件', createdAt: now, updatedAt: now });
const pages = new Map();
function page(title) {
    if (!pages.has(title)) {
        const pageId = id('page', title);
        let value = canvas.projects.find((item) => item.id === pageId);
        if (!value) {
            value = { id: pageId, title, projectFolderId: folderId, createdAt: now, updatedAt: now, nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'lines', showImageInfo: true, viewport: { x: 60, y: 80, k: 0.6 } };
            canvas.projects.push(value);
        }
        pages.set(title, value);
    }
    return pages.get(title);
}
function addNode(title, node) {
    const target = page(title);
    if (target.nodes.some((item) => item.id === node.id)) return;
    const n = target.nodes.length;
    target.nodes.push({ ...node, position: { x: (n % 4) * 460, y: Math.floor(n / 4) * 540 } });
}
function addAsset(asset) { if (!assets.some((item) => item.id === asset.id)) assets.push({ ...asset, tags: ['裸羊'], createdAt: now, updatedAt: now }); }
const records = [];
async function record(file, destination, extra = {}) {
    const bytes = await fs.readFile(file);
    const digest = sha(bytes);
    const relative = path.relative(source, file);
    const old = previous?.files.find((item) => item.source === relative);
    assert(!old || old.sha256 === digest, `源文件已变更，拒绝静默替换: ${relative}`);
    records.push({ source: relative, bytes: bytes.length, sha256: digest, ...extra, ...(destination ? { destination } : {}) });
    return bytes;
}
async function copyVerified(file, destination) {
    const bytes = await record(file, destination);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    try { await fs.writeFile(destination, bytes, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    assert.equal(sha(await fs.readFile(destination)), sha(bytes), `副本冲突: ${destination}`);
}
for (const file of [...images, ...audios]) {
    const relative = path.relative(projectSource, file);
    const image = images.includes(file);
    const mediaId = id(image ? 'image' : 'audio', relative);
    const key = `${image ? 'image' : 'audio'}:${mediaId}`;
    const namespace = image ? 'images' : 'media';
    const ext = path.extname(file).toLowerCase();
    const mimeType = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.wav': 'audio/wav', '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' })[ext];
    const bytes = await record(file, null, { namespace, storageKey: key });
    const existing = await storage.getMedia(namespace, key);
    if (existing) { assert.equal(sha(existing.bytes), sha(bytes), `媒体冲突: ${key}`); assert.equal(existing.mimeType, mimeType); }
    else await storage.setMedia(namespace, key, { bytes, mimeType });
    assert.equal(sha((await storage.getMedia(namespace, key)).bytes), sha(bytes), `落盘哈希不符: ${key}`);
    const metadata = { content: `local-media:${mediaId}`, storageKey: key, bytes: bytes.length, mimeType, status: 'success' };
    let width = 400, height = 180, title;
    if (image) {
        const dimensions = execFileSync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' });
        const naturalWidth = Number(dimensions.match(/pixelWidth: (\d+)/)?.[1]);
        const naturalHeight = Number(dimensions.match(/pixelHeight: (\d+)/)?.[1]);
        assert(naturalWidth > 0 && naturalHeight > 0, `无法读取尺寸: ${file}`);
        Object.assign(metadata, { naturalWidth, naturalHeight });
        width = 400 * Math.min(1, naturalWidth / naturalHeight); height = width * naturalHeight / naturalWidth;
        const group = relative.split(path.sep)[1];
        const index = images.filter((item) => path.relative(projectSource, item).split(path.sep)[1] === group).indexOf(file);
        // 24 images per creative page is layout pagination, not an import limit.
        title = `${group} · ${Math.floor(index / 24) + 1}`;
        addAsset({ id: id('asset', relative), kind: 'image', title: path.basename(file, ext), coverUrl: '', source: relative, data: { dataUrl: metadata.content, storageKey: key, width: naturalWidth, height: naturalHeight, bytes: bytes.length, mimeType } });
    } else {
        const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file], { encoding: 'utf8' }));
        assert(Number(probe.format.duration) > 0);
        metadata.durationMs = Number(probe.format.duration) * 1000;
        title = '项目音频';
    }
    addNode(title, { id: mediaId, type: image ? 'image' : 'audio', title: path.basename(file, ext), width, height, metadata });
}
for (const file of texts) {
    const relative = path.relative(projectSource, file);
    const content = (await record(file)).toString('utf8');
    const referenceOnly = relative.startsWith('00_项目说明/') || file.endsWith('裸羊逃跑事件_人物与道具资产.md');
    const title = `${referenceOnly ? '项目参考（含历史记录）· ' : ''}${path.basename(file, path.extname(file))}`;
    addAsset({ id: id('asset', relative), kind: 'text', title, coverUrl: '', source: relative, ...(referenceOnly ? { note: '含旧阶段状态和历史规则，仅供追溯；现行叙事以 Fisher 分镜重写及导演复核为准，不代表正式生成指令。' } : {}), data: { content } });
    if (referenceOnly) {
        const asset = assets.find((item) => item.id === id('asset', relative));
        if (asset.title === path.basename(file, path.extname(file))) Object.assign(asset, { title, note: '含旧阶段状态和历史规则，仅供追溯；现行叙事以 Fisher 分镜重写及导演复核为准，不代表正式生成指令。' });
        const existingNode = page('项目说明与脚本').nodes.find((item) => item.id === id('text', relative));
        if (existingNode?.title === path.basename(file, path.extname(file))) existingNode.title = title;
    }
    addNode('项目说明与脚本', { id: id('text', relative), type: 'text', title, width: 420, height: 480, metadata: { content, status: 'success' } });
    await fs.mkdir(path.join(verification, '导入资料', path.dirname(relative)), { recursive: true });
    const target = path.join(verification, '导入资料', relative);
    try { await fs.writeFile(target, content, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    assert.equal(sha(await fs.readFile(target)), sha(Buffer.from(content)));
}
// Reuse the app's inference without loading its browser-only i18n singleton.
const workflowModule = await fs.readFile(path.join(repo, 'web/src/lib/comfyui/workflow.ts'), 'utf8');
const workflowCode = stripTypeScriptTypes(workflowModule.replace('import i18n from "@/i18n";', 'const i18n = { t: (key: string) => key };'));
const { createWorkflowFields } = await import(`data:text/javascript;base64,${Buffer.from(workflowCode).toString('base64')}`);
for (const name of workflowNames) {
    const workflow = JSON.parse((await record(path.join(workflowSource, name))).toString('utf8'));
    assert(Object.keys(workflow).length && Object.values(workflow).every((node) => node && typeof node.class_type === 'string' && node.class_type && node.inputs && !Array.isArray(node.inputs)), `不是API字典: ${name}`);
    for (const node of Object.values(workflow)) for (const value of Object.values(node.inputs)) if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number') assert(workflow[value[0]], `工作流引用缺失: ${name}/${value[0]}`);
    const workflowId = id('workflow', name);
    if (!comfy.workflows.some((item) => item.id === workflowId)) comfy.workflows.push({ id: workflowId, name: name.replace(/_API\.json$/, ''), description: '裸羊样例项目：作者原版 API 模板，未提交任务；使用前需核对模型及输入文件。', workflow, fields: createWorkflowFields(workflow), createdAt: now, updatedAt: now });
    addNode('ComfyUI 模板', { id: id('comfy', name), type: 'comfyui', title: name.replace(/_API\.json$/, ''), width: 400, height: 360, metadata: { comfyMode: 'custom', comfyWorkflowId: workflowId, comfyRunStatus: 'idle', comfyValues: {} } });
    await copyVerified(path.join(workflowSource, name), path.join(verification, '导入资料/workflows', name));
}
comfy.baseUrl = 'http://192.168.11.2:8188';
const ui = path.join(source, '04_知识与模板/workflows/【Work-Fisher】AI短剧制作全流程.json');
const uiJson = JSON.parse(await fs.readFile(ui, 'utf8'));
assert(Array.isArray(uiJson.nodes) && Array.isArray(uiJson.links), '原始 UI JSON 格式不符');
await copyVerified(ui, path.join(verification, '导入资料/workflows', path.basename(ui)));
const skillFiles = await files(skillSource);
for (const file of skillFiles) await copyVerified(file, path.join(verification, '导入资料/fisher-storylens', path.relative(skillSource, file)));
// Pass the workspace path returned by the app's controlled workspace endpoint; never infer it from config.
if (process.argv[3]) {
    assert(path.isAbsolute(process.argv[3]), '技能工作区必须为实际绝对路径');
    for (const file of skillFiles) await copyVerified(file, path.join(process.argv[3], '.agents/skills', skillName, path.relative(skillSource, file)));
}
const receiptFile = path.join(repo, 'verification/naked-sheep-e2e/comfy-receipt.json');
const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
assert(receipt.status === 'success' && receipt.completed === true);
const generatedFile = path.join(repo, 'verification/naked-sheep-e2e/naked_sheep_character_00001_.png');
const generatedId = id('e2e', receipt.prompt_id);
const generatedKey = `image:${generatedId}`;
const generatedBytes = await record(generatedFile, null, { namespace: 'images', storageKey: generatedKey });
const generatedExisting = await storage.getMedia('images', generatedKey);
if (generatedExisting) assert.equal(sha(generatedExisting.bytes), sha(generatedBytes));
else await storage.setMedia('images', generatedKey, { bytes: generatedBytes, mimeType: 'image/png' });
assert.equal(sha((await storage.getMedia('images', generatedKey)).bytes), sha(generatedBytes));
const generatedContent = `local-media:${generatedId}`;
addAsset({ id: generatedId, kind: 'image', title: '角色生成验收样片（非定稿）', coverUrl: '', source: receipt.prompt_id, note: '已完成的真实 ComfyUI 角色生成，仅用于验收。', data: { dataUrl: generatedContent, storageKey: generatedKey, width: 1024, height: 1680, bytes: generatedBytes.length, mimeType: 'image/png' } });
addNode('E2E生成验收', { id: generatedId, type: 'image', title: '角色生成验收样片（非定稿）', width: 300, height: 492.1875, metadata: { content: generatedContent, storageKey: generatedKey, naturalWidth: 1024, naturalHeight: 1680, bytes: generatedBytes.length, mimeType: 'image/png', status: 'success' } });
addNode('E2E生成验收', { id: id('receipt', receipt.prompt_id), type: 'text', title: '真实生成提示词与回执', width: 420, height: 480, metadata: { content: `${receipt.prompt}\n\nprompt_id: ${receipt.prompt_id}\n状态: success / completed\n本样片仅用于验收，不代表正式定稿。`, status: 'success' } });
addNode('E2E生成验收', { id: id('run-reference', receipt.prompt_id), type: 'comfyui', title: '角色原版模板引用（未再次提交）', width: 400, height: 360, metadata: { comfyMode: 'custom', comfyWorkflowId: id('workflow', workflowNames[0]), comfyRunStatus: 'idle', comfyValues: {} } });
const projectIds = [...pages.values()].map((item) => item.id);
for (const target of pages.values()) {
    assert.equal(new Set(target.nodes.map((node) => node.id)).size, target.nodes.length);
    for (const node of target.nodes) {
        if (node.metadata?.storageKey) assert(await storage.getMedia(node.type === 'image' ? 'images' : 'media', node.metadata.storageKey), `引用缺失: ${node.id}`);
        if (node.type === 'comfyui') assert(comfy.workflows.some((item) => item.id === node.metadata.comfyWorkflowId));
    }
}
for (const name of Object.keys(states)) assert.equal(await storage.getState(`framedock:${name}_store`), original[name], '存储并发变化，拒绝覆盖');
for (const name of Object.keys(states)) {
    const value = JSON.stringify(states[name]);
    if (value !== original[name]) await storage.setState(`framedock:${name}_store`, value);
    assert.deepEqual(JSON.parse(await storage.getState(`framedock:${name}_store`)), states[name]);
}
const manifest = { version: 1, source, userData, folderId, projectIds, importedAt: previous?.importedAt || now, excludedPaths, obsoleteAudit: { removed: 0, reason: '明确作废的无毛暗红补充羊图、首夜43条视频、旧59首帧均未进入导入范围；历史说明仅作参考。' }, ...(process.argv[3] ? { skillWorkspace: process.argv[3], skillName, skillFiles: skillFiles.length } : previous?.skillWorkspace ? { skillWorkspace: previous.skillWorkspace, skillFiles: previous.skillFiles } : {}), counts: { images: images.length, audios: audios.length, texts: texts.length, workflows: workflowNames.length, creativePages: pages.size, assets: images.length + texts.length + 1, generatedSamples: 1 }, files: records };
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ verification, backup, ...manifest.counts, preservedExistingProjects: canvas.projects.length - pages.size, hashAndReferenceChecks: 'passed' }, null, 2));
