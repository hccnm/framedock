import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { test } from 'node:test';
const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const source = ts.transpileModule(await readFile(new URL('../src/security.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function setup() {
    const app = new EventEmitter(), handlers = {}, exports = {};
    const session = { setPermissionRequestHandler: handler => { handlers.request = handler; }, setPermissionCheckHandler: handler => { handlers.check = handler; } };
    vm.runInNewContext(source, { exports, URL, require: () => ({ app, shell: { openExternal() {} } }) });
    exports.applyAppSecurity();
    const create = (url = 'app://framedock/canvas/test') => {
        const contents = Object.assign(new EventEmitter(), { session, getURL: () => url, isDestroyed: () => false, setWindowOpenHandler() {} });
        app.emit('web-contents-created', {}, contents);
        return contents;
    };
    const contents = create();
    const details = { isMainFrame: true, requestingUrl: contents.getURL() };
    const request = (permission = 'fullscreen', target = contents, frame = details) => { let allowed; handlers.request(target, permission, value => { allowed = value; }, frame); return allowed; };
    const trust = (origin = 'app://framedock') => exports.applyWindowSecurity({ webContents: contents }, origin);
    return { contents, handlers, request, trust, create, details };
}

test('应用主页面视频可通过权限检查与请求进入全屏', () => {
    const s = setup();
    assert.equal(s.request(), false);
    s.trust();
    assert.equal(s.request(), true);
    assert.equal(s.handlers.check(s.contents, 'fullscreen', 'app://framedock', s.details), true);
    s.create('devtools://devtools/');
    assert.equal(s.request(), true, '共享 session 创建其他 webContents 后仍可全屏');
});

test('只允许登记的应用主页面全屏，其余来源与设备权限继续拒绝', () => {
    const s = setup(); s.trust();
    for (const permission of ['media', 'geolocation', 'notifications', 'display-capture', 'automatic-fullscreen']) assert.equal(s.request(permission), false);
    assert.equal(s.request('fullscreen', s.contents, { ...s.details, isMainFrame: false }), false);
    assert.equal(s.request('fullscreen', s.contents, { ...s.details, requestingUrl: 'https://example.com' }), false);
    assert.equal(s.request('fullscreen', s.create()), false);
    s.contents.getURL = () => 'https://example.com';
    assert.equal(s.request(), false);
});

test('开发服务器只允许明确配置的协议、主机与端口', () => {
    const s = setup(); s.contents.getURL = () => 'http://127.0.0.1:4189/canvas/test'; s.trust('http://127.0.0.1:4189');
    assert.equal(s.request('fullscreen', s.contents, { isMainFrame: true, requestingUrl: s.contents.getURL() }), true);
    assert.equal(s.request('fullscreen', s.contents, { isMainFrame: true, requestingUrl: 'http://127.0.0.1:4190/canvas/test' }), false);
});
