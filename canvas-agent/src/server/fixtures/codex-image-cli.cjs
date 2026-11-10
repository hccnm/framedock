#!/usr/bin/env node
const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4XcAAAAASUVORK5CYII=';
let cwd;
let turn = 0;
const mode = process.env.CODEX_IMAGE_FIXTURE;
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
    const { id, method, params } = JSON.parse(line);
    const result = (value) => send({ id, result: value });
    if (method === 'initialize') return result({});
    if (method === 'modelProvider/capabilities/read') return result({ imageGeneration: mode !== 'unsupported' });
    if (method === 'config/read') return result({ config: { mcp_servers: { 'test-external': { command: 'unused' } } } });
    if (method === 'thread/start') {
        cwd = params.cwd;
        assert.equal(params.ephemeral, true);
        assert.equal(params.sandbox, 'workspace-write');
        assert.equal(params.config.mcp_servers['test-external'].enabled, false);
        assert.equal(params.config.features.shell_tool, false);
        return result({ thread: { id: 'image-thread', cwd } });
    }
    if (method === 'turn/start') {
        const turnId = `image-turn${turn++ ? `-${turn}` : ''}`;
        const images = params.input.filter(x => x.type === 'localImage');
        assert.equal(images.length, 2);
        assert.ok(images.every(x => fs.readFileSync(x.path).toString('base64') === png));
        assert.ok(params.input[0].text.includes('reference-1.png'));
        const emit = (method, item) => send({ method, params: { threadId: 'image-thread', turnId, item } });
        send({ method: 'turn/started', params: { threadId: 'image-thread', turn: { id: turnId } } });
        if (mode === 'wait') return result({ turn: { id: turnId } });
        if (mode === 'no-output') emit('item/completed', { type: 'agentMessage', id: 'text', text: '当前账号没有生图权限' });
        else {
            const savedPath = path.join(cwd, 'output.png');
            fs.writeFileSync(savedPath, Buffer.from(png, 'base64'));
            const item = { type: 'imageGeneration', id: 'image-1', status: 'completed', savedPath, result: png, inputImages: images, transparentBackground: mode !== 'wrong-background' && params.input[0].text.includes('transparent_background 必须设为 true') };
            emit('item/completed', item);
            emit('item/completed', item);
            send({ method: 'item/completed', params: { threadId: 'other-thread', turnId: 'other-turn', item: { ...item, id: 'wrong' } } });
        }
        send({ method: 'turn/completed', params: { threadId: 'image-thread', turn: { id: turnId, status: 'completed', items: [] } } });
        return result({ turn: { id: turnId } });
    }
});
