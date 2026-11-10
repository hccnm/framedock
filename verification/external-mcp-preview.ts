import express from '../canvas-agent/node_modules/express/index.js';
import { createExternalMcp } from '../canvas-agent/src/server/external-mcp.ts';

// Isolated preview fixture: no user config, model credentials or GPU calls.
const app = express();
app.use(express.json());
app.use((req, res, next) => {
    if (['http://127.0.0.1:3030', 'http://localhost:3030'].includes(req.headers.origin || '')) res.setHeader('Access-Control-Allow-Origin', req.headers.origin!);
    res.setHeader('Access-Control-Allow-Headers', 'content-type,x-canvas-agent-token');
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS');
    if (req.method === 'OPTIONS') res.end(); else next();
});
const external = createExternalMcp(async () => ({ projects: [], fixture: true }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use((req, res, next) => {
    if (req.query.token === 'fixture-internal-token') next(); else res.status(401).json({ ok: false });
});
app.use(external.settings);
app.listen(17373, '127.0.0.1');
