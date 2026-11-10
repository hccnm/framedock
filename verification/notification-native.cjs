const { app, Notification } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const path = require('node:path');

app.setName('FrameDock Notification Verification');
const resultFile = path.join(__dirname, 'notification-native-result.json');
const result = { supported: false, shown: false, clicked: false, events: [] };
let finished = false;
function finish() {
    if (finished) return;
    finished = true;
    writeFileSync(resultFile, JSON.stringify(result, null, 2));
    app.quit();
}
app.whenReady().then(() => {
    result.supported = Notification.isSupported();
    if (!result.supported) return finish();
    const source = stripTypeScriptTypes(readFileSync(path.join(__dirname, '../desktop/src/notifications.ts'), 'utf8'))
        .replace(/^import .*;\n/gm, '').replace('export function createGenerationNotifications', 'return function createGenerationNotifications');
    class ObservedNotification extends Notification {
        constructor(options) {
            super(options);
            this.on('show', () => { result.shown = true; this.emit('click'); this.close(); finish(); });
            this.on('failed', (_event, error) => { result.error = error; finish(); });
        }
    }
    const window = {
        isDestroyed: () => false, isMinimized: () => true,
        restore: () => result.events.push('restore'), show: () => result.events.push('show'), focus: () => result.events.push('focus'),
        webContents: { send: (event, target) => { result.clicked = true; result.target = target; result.events.push(event); } },
    };
    const notify = new Function('Notification', source)(ObservedNotification)(() => window);
    notify({ id: 'native-verification', title: 'FrameDock 通知验证', body: '生成任务通知功能验证，此通知可忽略。', target: { kind: 'image', logId: 'native-verification' } });
    setTimeout(finish, 8000);
}).catch(error => { result.error = String(error); finish(); });
