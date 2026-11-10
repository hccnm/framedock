import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDesktopStorage } from '../desktop/dist/storage-files.js';

// Only canvas state is read/written; Electron must remain stopped throughout the merge.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repo, 'verification/naked-sheep-import/manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const storage = createDesktopStorage(path.join(os.homedir(), 'Library/Application Support/FrameDock Desktop'), { available: () => false, encrypt: () => { throw Error('禁止读取配置'); }, decrypt: () => { throw Error('禁止读取配置'); } });
const key = 'framedock:canvas_store';
const sha = (value) => createHash('sha256').update(value).digest('hex');
function stopped() {
    assert(!execFileSync('ps', ['-axo', 'command'], { encoding: 'utf8' }).split('\n').some((line) => line.includes('/framedock/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')), '请先停止本项目 Electron');
}
stopped();
const original = await storage.getState(key);
assert(original, '缺少画布状态');
const state = JSON.parse(original);
assert.equal(state.version, 0, '未知画布版本，拒绝覆盖');
const canvas = state.state;
if (manifest.merge?.status === 'merged') {
    assert.equal(manifest.projectIds.length, 1);
    assert(canvas.projects.some((page) => page.id === manifest.merge.targetId), '合并页缺失，拒绝重新导入');
    console.log('已合并，未修改画布或清单');
    process.exit(0);
}
assert.equal(manifest.projectIds.length, 12, '预期原始 12 页');
const pageIds = new Set(manifest.projectIds);
const pages = manifest.projectIds.map((id) => canvas.projects.find((page) => page.id === id));
assert(pages.every((page) => page?.projectFolderId === manifest.folderId), '导入页缺失或已移出项目，拒绝覆盖');
const now = new Date().toISOString();
const backup = path.join(repo, 'verification/naked-sheep-import/backups', `merge-${now.replaceAll(':', '-')}`);
await fs.mkdir(backup, { recursive: true });
await fs.writeFile(path.join(backup, 'canvas_store.json'), original, { mode: 0o600, flag: 'wx' });
await fs.writeFile(path.join(backup, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' });
const beforeNodes = pages.flatMap((page) => page.nodes);
const beforeConnections = pages.flatMap((page) => page.connections);
function unique(items) {
    const result = new Map();
    for (const item of items) {
        if (result.has(item.id)) assert.deepEqual(result.get(item.id), item, `重复 ID 内容冲突: ${item.id}`);
        else result.set(item.id, item);
    }
    return [...result.values()];
}
const nodes = structuredClone(unique(beforeNodes));
const connections = unique(beforeConnections);
const originalNodes = new Map(nodes.map((node) => [node.id, structuredClone(node)]));
const sections = [
    ['角色资产', 6], ['角色三视图', 3], ['基础场景', 3], ['道具资产', 4],
    ['重构资产 · S01 堂屋', 7], ['重构资产 · S02 院坝', 7], ['重构资产 · S03 村道', 4], ['重构资产 · S04 卧房', 4],
    ['项目音频', 4], ['项目说明与脚本', 3], ['ComfyUI 工作流', 3], ['E2E 生成验收（非定稿）', 3], ['用户新增与已有分组', 4],
].map(([title, columns]) => ({ title, columns, members: [], groups: [] }));
const sourceByKey = new Map(manifest.files.filter((file) => file.storageKey).map((file) => [file.storageKey, file.source]));
for (const node of nodes) {
    const source = sourceByKey.get(node.metadata?.storageKey) || '';
    assert(!manifest.excludedPaths.some((prefix) => source.includes(`/裸羊逃跑事件/${prefix}`)), `作废来源: ${node.id}`);
    if (node.type === 'group' || node.metadata?.groupId) continue;
    let index = 12;
    if (source.includes('/角色设定/')) index = 0;
    else if (source.includes('/重构资产_20261019/三视图/')) index = 1;
    else if (source.includes('/场景设定/')) index = 2;
    else if (source.includes('/道具设定/')) index = 3;
    else if (source.includes('/重构资产_20261019/')) {
        const scene = source.match(/\/重构资产_20261019\/S0([1-4])\//);
        assert(scene, `未知重构场景: ${source}`);
        index = 3 + Number(scene[1]);
    } else if (node.id.startsWith('sheep_audio_')) index = 8;
    else if (node.id.startsWith('sheep_text_')) index = 9;
    else if (node.id.startsWith('sheep_comfy_')) index = 10;
    else if (/^sheep_(e2e|receipt|run-reference)_/.test(node.id)) index = 11;
    sections[index].members.push(node);
}
// Existing user groups move as intact units, retaining every membership and relative position.
const grouped = nodes.filter((node) => node.type === 'group');
for (const node of nodes.filter((node) => node.metadata?.groupId)) assert(grouped.some((group) => group.id === node.metadata.groupId), `原分组缺失: ${node.id}`);
assert(grouped.every((group) => !group.metadata?.groupId), '现有嵌套分组需人工处理，拒绝覆盖');
for (const group of grouped) sections[12].groups.push([group, ...nodes.filter((node) => node.metadata?.groupId === group.id)]);
const addedGroups = [];
function layout(section, x, y) {
    if (!section.members.length && !section.groups.length) return { width: 0, height: 0 };
    const id = `sheep_merge_group_${sha(section.title).slice(0, 24)}`;
    assert(!originalNodes.has(id), '分组 ID 冲突');
    let left = x + 40, top = y + 100, rowHeight = 0, right = left;
    const units = [...section.members.map((node) => [node]), ...section.groups];
    units.forEach((unit, index) => {
        if (index && index % section.columns === 0) { left = x + 40; top += rowHeight + 90; rowHeight = 0; }
        const minX = Math.min(...unit.map((node) => node.position.x));
        const minY = Math.min(...unit.map((node) => node.position.y));
        const width = Math.max(...unit.map((node) => node.position.x + node.width)) - minX;
        const height = Math.max(...unit.map((node) => node.position.y + node.height)) - minY;
        assert(width > 0 && height > 0 && Number.isFinite(width + height), '节点尺寸异常');
        for (const node of unit) node.position = { x: node.position.x - minX + left, y: node.position.y - minY + top };
        if (unit.length === 1 && unit[0].type !== 'group') unit[0].metadata = { ...unit[0].metadata, groupId: id };
        left += width + 60; right = Math.max(right, left - 60); rowHeight = Math.max(rowHeight, height);
    });
    const width = right - x + 40, height = top + rowHeight - y + 40;
    // Existing groups have no parent: the final section is a spatial area, not nested membership.
    if (section.members.length) addedGroups.push({ id, type: 'group', title: `${section.title} · ${section.members.length}`, position: { x, y }, width, height, metadata: {} });
    return { width, height };
}
let y = 0, totalWidth = 0;
for (const row of [sections.slice(0, 4), sections.slice(4, 8), sections.slice(8, 12), sections.slice(12)]) {
    let x = 0, height = 0;
    for (const section of row) {
        const bounds = layout(section, x, y);
        if (bounds.width) { x += bounds.width + 180; height = Math.max(height, bounds.height); }
    }
    totalWidth = Math.max(totalWidth, x ? x - 180 : 0);
    if (height) y += height + 220;
}
const totalHeight = y - 220;
// Overview leaves room for the app sidebar; no application zoom bounds are changed.
const zoom = Math.min(1, 980 / totalWidth, 730 / totalHeight);
assert(zoom >= 0.05, '概览低于现有最小缩放，需调整布局');
const target = { ...pages[0], title: '裸羊逃跑事件 · 资产与分镜', updatedAt: now, nodes: [...addedGroups, ...nodes], connections, chatSessions: unique(pages.flatMap((page) => page.chatSessions || [])), activeChatId: pages[0].activeChatId || pages.find((page) => page.activeChatId)?.activeChatId || null, viewport: { x: 60, y: 60, k: zoom } };
for (const node of nodes) {
    const old = originalNodes.get(node.id);
    const { position: oldPosition, metadata: oldMetadata, ...oldRest } = old;
    const { position, metadata, ...rest } = node;
    assert.deepEqual(rest, oldRest, `节点内容变化: ${node.id}`);
    if (oldMetadata?.groupId || node.type === 'group') assert.deepEqual(metadata, oldMetadata);
    else { const { groupId, ...unchanged } = metadata; assert.deepEqual(unchanged, oldMetadata || {}); }
}
const targetIds = new Set(target.nodes.map((node) => node.id));
assert.equal(targetIds.size, target.nodes.length);
assert.deepEqual(new Set(nodes.map((node) => node.id)), new Set(beforeNodes.map((node) => node.id)));
assert.deepEqual(new Set(connections.map((connection) => connection.id)), new Set(beforeConnections.map((connection) => connection.id)));
for (const connection of connections) assert(targetIds.has(connection.fromNodeId) && targetIds.has(connection.toNodeId), `连线端点缺失: ${connection.id}`);
const media = new Map();
function collect(value) {
    if (!value || typeof value !== 'object') return;
    for (const [field, item] of Object.entries(value)) {
        if (field === 'storageKey' && typeof item === 'string') media.set(item, item.startsWith('image:') ? 'images' : 'media');
        else collect(item);
    }
}
collect(pages);
for (const [mediaKey, namespace] of media) assert(await storage.getMedia(namespace, mediaKey), `媒体引用缺失: ${mediaKey}`);
canvas.projects = canvas.projects.filter((page) => !pageIds.has(page.id) || page.id === target.id).map((page) => page.id === target.id ? target : page);
assert.deepEqual(canvas.projects.filter((page) => !pageIds.has(page.id)), JSON.parse(original).state.projects.filter((page) => !pageIds.has(page.id)));
manifest.merge = { status: 'merged', targetId: target.id, mergedAt: now, backup, sourcePages: pages.map(({ nodes, connections, ...page }) => ({ ...page, nodeIds: nodes.map((node) => node.id), connectionIds: connections.map((connection) => connection.id) })), originalNodeCount: nodes.length, originalConnectionCount: connections.length, addedGroups: addedGroups.map(({ id, title }) => ({ id, title })), mediaReferences: media.size, bounds: { width: totalWidth, height: totalHeight }, checks: 'node/connection IDs, metadata, media references and unrelated projects preserved' };
manifest.projectIds = [target.id];
manifest.counts.creativePages = 1;
const merged = JSON.stringify(state);
stopped();
assert.equal(await storage.getState(key), original, '画布并发变化，拒绝覆盖');
await storage.setState(key, merged);
assert.equal(await storage.getState(key), merged, '画布写入校验失败');
const temporary = `${manifestPath}.merge.tmp`;
await fs.writeFile(temporary, JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' });
await fs.rename(temporary, manifestPath);
console.log(JSON.stringify({ targetId: target.id, title: target.title, originalNodes: nodes.length, groups: addedGroups.length, connections: connections.length, mediaReferences: media.size, viewport: target.viewport, bounds: manifest.merge.bounds, backup }, null, 2));
