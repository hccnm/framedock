// Isolated native Electron smoke test; no sidecar, credentials or real generation requests.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, protocol, ipcMain } = require('electron');
const root = path.resolve(__dirname, '../..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'framedock-progress-'));
app.setName('FrameDock Progress Verification');
app.setPath('userData', profile);
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const node = { id: 'progress-node', type: 'comfyui', title: '运行中测试', position: { x: 100, y: 100 }, width: 340, height: 240, metadata: { comfyMode: 'custom', comfyRunStatus: 'running', comfyPromptId: 'progress-prompt', comfyWorkflowId: 'progress-workflow' } };
const now = new Date().toISOString();
const directory = path.join(profile, 'storage/state');
fs.mkdirSync(directory, { recursive: true });
const seed = (name, state) => fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify({ state, version: 0 }));
seed('canvas_store', { projects: [{ id: 'progress-project', name: '运行中测试', title: '运行中测试', nodes: [node], connections: [], viewport: { x: 0, y: 0, k: 1 }, chatSessions: [], createdAt: now, updatedAt: now }], projectFolders: [], deletedProjects: [] });
seed('comfyui_store', { baseUrl: 'http://comfy.test', pollIntervalSeconds: 1, workflows: [{ id: 'progress-workflow', name: '状态测试', fields: [], workflow: {}, createdAt: now, updatedAt: now }], presetWorkflowIds: { text: '', edit: '', enhance: '' } });
let window, queueCalls = 0, historyCalls = 0;
const timeout = setTimeout(() => { console.error('native verification timeout'); window?.destroy(); app.exit(1); }, 25000);
app.whenReady().then(async () => {
    require(path.join(root, 'desktop/dist/security.js')).applyAppSecurity();
    require(path.join(root, 'desktop/dist/storage.js')).registerDesktopStorage({ userDataPath: profile, rendererOrigin: 'app://framedock' });
    ipcMain.handle('canvas-desktop:agent-connection', () => null);
    ipcMain.handle('canvas-desktop:host-info', () => ({ desktop: true, platform: process.platform, version: app.getVersion() }));
    ipcMain.handle('canvas-desktop:sidecar-log', () => '');
    ipcMain.handle('framedock:generation-notification', () => null);
    const dist = path.join(root, 'web/dist');
    protocol.handle('app', request => {
        const url = new URL(request.url);
        if (url.pathname.startsWith('/proxy/')) {
            const target = decodeURIComponent(url.pathname.slice(7));
            if (target.endsWith('/queue')) {
                queueCalls++;
                // Real changes as well as repeated status and one failed queue request.
                if (queueCalls === 5) return Response.json({ error: 'temporary' }, { status: 503 });
                return Response.json({ queue_running: queueCalls === 3 || queueCalls === 4 ? [] : [[0, 'progress-prompt']] });
            }
            if (target.includes('/history/')) { historyCalls++; return Response.json({}); }
            return new Response('Unexpected external request blocked', { status: 403 });
        }
        let file = path.join(dist, decodeURIComponent(url.pathname));
        if (!file.startsWith(dist + path.sep)) return new Response('', { status: 403 });
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
        return new Response(fs.readFileSync(file), { headers: { 'content-type': mime[path.extname(file)] || 'application/octet-stream' } });
    });
    window = new BrowserWindow({ show: false, width: 1200, height: 850, webPreferences: { preload: path.join(root, 'desktop/dist/preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    require(path.join(root, 'desktop/dist/security.js')).applyWindowSecurity(window, 'app://framedock');
    await window.loadURL('app://framedock/canvas/progress-project');
    window.showInactive();
    await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{let tries=0;const timer=setInterval(()=>{if(document.querySelector('[data-node-id="progress-node"]')){clearInterval(timer);resolve(true)}else if(++tries>100){clearInterval(timer);reject(new Error('node missing at startup'))}},50)})`);
    await window.webContents.executeJavaScript(`(() => {
        const selector='[data-node-id="progress-node"]'; const original=document.querySelector(selector);
        const data=window.__progressCheck={removals:0,replacements:0,missingFrames:0,hiddenFrames:0,frames:0,statuses:[],mutations:0};
        const observer=new MutationObserver(records=>{for(const r of records){data.mutations++;for(const removed of r.removedNodes){if(removed===original||removed.contains?.(original))data.removals++}}});
        observer.observe(document.body,{childList:true,subtree:true,characterData:true});
        const tick=()=>{const el=document.querySelector(selector);data.frames++;if(!el)data.missingFrames++;else{if(el!==original)data.replacements++;const style=getComputedStyle(el);if(style.display==='none'||style.visibility==='hidden'||style.opacity==='0'||!el.getBoundingClientRect().width)data.hiddenFrames++;const text=el.textContent;if(data.statuses.at(-1)!==text)data.statuses.push(text)}window.__progressFrame=requestAnimationFrame(tick)};tick();
        window.__stopProgress=()=>{observer.disconnect();cancelAnimationFrame(window.__progressFrame);return data};
    })()`);
    await new Promise(resolve => setTimeout(resolve, 8500));
    const result = await window.webContents.executeJavaScript('window.__stopProgress()');
    result.queueCalls = queueCalls; result.historyCalls = historyCalls;
    result.asset = await window.webContents.executeJavaScript('[...document.scripts].map(s=>s.src).find(s=>s.includes("/assets/index-"))');
    result.passed = queueCalls >= 7 && result.statuses.length >= 3 && result.removals === 0 && result.replacements === 0 && result.missingFrames === 0 && result.hiddenFrames === 0;
    fs.writeFileSync(path.join(__dirname, 'electron-check.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    clearTimeout(timeout); window.destroy(); app.exit(result.passed ? 0 : 1);
}).catch(error => { console.error(error); clearTimeout(timeout); window?.destroy(); app.exit(1); });
