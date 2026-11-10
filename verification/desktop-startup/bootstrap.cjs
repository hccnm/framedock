const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, ipcMain } = require('electron');

// 只隔离测试目录，业务入口、渲染器与 sidecar 都使用真实构建产物。
const profile = process.env.FRAMEDOCK_E2E_PROFILE;
assert(profile && path.isAbsolute(profile));
assert.equal(os.homedir(), path.join(profile, 'home'));
fs.mkdirSync(path.join(profile, 'app-data'), { recursive: true });
app.setPath('home', os.homedir());
app.setPath('appData', path.join(profile, 'app-data'));
app.on('web-contents-created', (_event, contents) => {
    for (const event of ['did-start-loading', 'did-navigate-in-page']) contents.on(event, () => console.log('[e2e-lifecycle]', event));
    contents.on('ipc-message', (_event, channel) => { if (channel.startsWith('framedock:close-')) console.log('[e2e-lifecycle]', channel); });
});
require(path.resolve(__dirname, '../../desktop/dist/main.js'));
assert.equal(app.getPath('userData'), path.join(profile, 'app-data', 'FrameDock Desktop'));
