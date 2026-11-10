import crypto from "node:crypto";
import { createServer } from "node:http";
import express, { Router, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createCanvasMcpServer, type CanvasToolCaller } from "./mcp.js";

export const EXTERNAL_MCP_PORT = 17372;

type ExternalMcpOptions = { port?: number; token?: string; saveToken?: (token: string) => void };

/** 外部 MCP 使用独立固定端口和持久令牌；开关仅保存在当前进程，重启后关闭。 */
export function createExternalMcp(callTool: CanvasToolCaller, options: ExternalMcpOptions = {}) {
    let token = options.token || "";
    let enabled = false;
    let port = options.port ?? EXTERNAL_MCP_PORT;
    let changes = Promise.resolve();
    const mcp = express();
    mcp.disable("x-powered-by");
    mcp.use(express.json({ limit: "30mb" }));
    const listener = createServer(mcp);
    const settings = Router();
    const servers = new Map<ReturnType<typeof createCanvasMcpServer>, Response>();
    const status = () => ({ ok: true as const, enabled, url: `http://127.0.0.1:${port}/mcp`, token: enabled ? token : "" });
    const revokeRequests = () => {
        for (const [server, response] of servers) {
            response.destroy();
            void server.close().catch(() => undefined);
        }
    };
    const replaceToken = () => {
        const nextToken = crypto.randomBytes(18).toString("hex");
        options.saveToken?.(nextToken);
        token = nextToken;
        revokeRequests();
    };
    const disable = async () => {
        enabled = false;
        revokeRequests();
        if (!listener.listening) return;
        await new Promise<void>((resolve, reject) => {
            listener.close((error) => error ? reject(error) : resolve());
            listener.closeAllConnections();
        });
    };
    const enqueue = (change: () => Promise<void> | void) => {
        const pending = changes.then(change);
        changes = pending.catch(() => undefined);
        return pending;
    };
    settings.use((_req, res, next) => {
        res.setHeader("Cache-Control", "no-store");
        next();
    });
    settings.get("/agent/api/external-mcp", (_req, res) => res.json(status()));
    settings.put("/agent/api/external-mcp", async (req, res) => {
        if (typeof req.body?.enabled !== "boolean") return void res.status(400).json({ ok: false, error: "enabled must be a boolean" });
        const requestedEnabled = req.body.enabled;
        try {
            await enqueue(async () => {
                if (!requestedEnabled) return disable();
                if (enabled) return;
                if (!token) replaceToken();
                await new Promise<void>((resolve, reject) => {
                    const failed = (error: Error) => { listener.off("listening", ready); reject(error); };
                    const ready = () => { listener.off("error", failed); resolve(); };
                    listener.once("error", failed);
                    listener.once("listening", ready);
                    listener.listen(port, "127.0.0.1");
                });
                const address = listener.address();
                if (address && typeof address !== "string") port = address.port;
                enabled = true;
            });
            res.json(status());
        } catch (error) {
            const occupied = (error as NodeJS.ErrnoException).code === "EADDRINUSE";
            res.status(occupied ? 409 : 500).json({ ok: false, error: occupied ? `外部 MCP 固定端口 ${port} 已被占用，请释放端口后重试。` : (error instanceof Error ? error.message : String(error)) });
        }
    });
    settings.post("/agent/api/external-mcp/reset-token", async (_req, res) => {
        try {
            await enqueue(replaceToken);
            res.json(status());
        } catch (error) {
            res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    });
    mcp.all("/mcp", async (req, res, next) => {
        res.setHeader("Cache-Control", "no-store");
        if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host || "") || !localOrigin(req.headers.origin)) {
            return void res.status(403).json({ ok: false, error: "localhost Host and Origin required" });
        }
        if (!enabled) return void res.status(403).json({ ok: false, error: "external MCP disabled" });
        const requestToken = token;
        if (req.headers.authorization !== `Bearer ${requestToken}`) return void res.status(401).json({ ok: false, error: "invalid external MCP token" });
        if (req.method !== "POST") return void res.status(405).set("Allow", "POST").json({ ok: false, error: "method not allowed" });
        const server = createCanvasMcpServer((name, input) => {
            if (!enabled || token !== requestToken) throw new Error("external MCP disabled or token revoked");
            return callTool(name, input);
        });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        servers.set(server, res);
        res.on("close", () => {
            servers.delete(server);
            void server.close().catch(() => undefined);
        });
        try {
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            servers.delete(server);
            await server.close().catch(() => undefined);
            if (!res.headersSent) next(error);
            else res.end();
        }
    });
    return { settings, close: () => enqueue(disable) };
}

function localOrigin(origin: string | undefined) {
    if (!origin) return true;
    try {
        const url = new URL(origin);
        return ["http:", "https:"].includes(url.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.origin === origin;
    } catch {
        return false;
    }
}
