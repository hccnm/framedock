import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { agentConfigFile, readAgentConfig } from "./paths.js";

export type SidecarConnection = { url: string; token: string };
export type SidecarEvent = { type: "starting" | "ready" | "restarting" | "failed"; message?: string };

/** 生成本次启动使用的随机连接 token。 */
export function randomToken() {
    return crypto.randomBytes(18).toString("hex");
}

/** 选取一个当前空闲的回环端口。 */
export function findFreePort() {
    return new Promise<number>((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address() as net.AddressInfo;
            server.close(() => resolve(port));
        });
    });
}

/** 每次启动写入新的随机 token；保留配置中的其余字段，首次启动补一个默认 url。 */
export function rotateAgentToken() {
    const token = randomToken();
    const file = agentConfigFile();
    const config = readAgentConfig();
    if (typeof config.url !== "string" || !config.url) config.url = "http://127.0.0.1:17371";
    config.token = token;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
    return token;
}

/** 等待 sidecar /health 就绪；超时返回 false。 */
function waitUntilHealthy(url: string, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    return new Promise<boolean>((resolve) => {
        const probe = async () => {
            try {
                if ((await fetch(`${url}/health`)).ok) return resolve(true);
            } catch {
                // sidecar 尚未就绪，继续等待。
            }
            if (Date.now() > deadline) return resolve(false);
            setTimeout(probe, 300);
        };
        void probe();
    });
}

/**
 * Canvas Agent sidecar 生命周期：启动、健康检查、异常退出自动重启一次、优雅退出。
 * sidecar 只监听 127.0.0.1；token 每次应用启动随机生成。
 */
export class AgentSidecar {
    private child: ChildProcess | null = null;
    private connection: SidecarConnection | null = null;
    private restartedOnce = false;
    private stoppedByUser = false;
    private logBuffer: string[] = [];

    constructor(private entry: string, private onEvent: (event: SidecarEvent) => void) {}

    /** 启动 sidecar：随机空闲端口 + 每次启动随机 token，等待 /health 就绪。 */
    async start(): Promise<SidecarConnection> {
        const connection = { url: `http://127.0.0.1:${await findFreePort()}`, token: rotateAgentToken() };
        this.stoppedByUser = false;
        this.restartedOnce = false;
        await this.launch(connection);
        return connection;
    }

    /** 优雅退出 sidecar；超时后才强制终止子进程。 */
    async stop() {
        this.stoppedByUser = true;
        await this.stopChild();
    }

    /** 返回保留的最近一段 sidecar 输出，用于诊断展示。 */
    recentLog() {
        return this.logBuffer.join("");
    }

    private async launch(connection: SidecarConnection) {
        this.connection = connection;
        this.onEvent({ type: this.restartedOnce ? "restarting" : "starting" });
        const child = spawn(process.execPath, [this.entry], {
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(new URL(connection.url).port) },
        });
        this.child = child;
        this.logBuffer = [];
        const collect = (chunk: Buffer | string) => {
            this.logBuffer.push(String(chunk));
            if (this.logBuffer.length > 400) this.logBuffer.splice(0, this.logBuffer.length - 400);
        };
        child.stdout?.on("data", collect);
        child.stderr?.on("data", collect);
        if (!(await waitUntilHealthy(connection.url))) {
            await this.stopChild();
            throw new Error(`Canvas Agent 启动失败（健康检查超时）：${this.logBuffer.join("").trim().split("\n").at(-1) || "无输出"}`);
        }
        this.onEvent({ type: "ready" });
        child.once("exit", () => {
            if (this.child === child) void this.handleUnexpectedExit();
        });
    }

    /** 意外退出后自动重启一次；复用原端口和 token，避免渲染层连接信息失效。 */
    private async handleUnexpectedExit() {
        this.child = null;
        if (this.stoppedByUser || !this.connection) return;
        if (this.restartedOnce) {
            this.onEvent({ type: "failed", message: "Canvas Agent 意外退出且自动恢复失败，请重启应用。" });
            return;
        }
        this.restartedOnce = true;
        try {
            await this.launch(this.connection);
        } catch {
            this.onEvent({ type: "failed", message: "Canvas Agent 意外退出且自动恢复失败，请重启应用。" });
        }
    }

    private stopChild() {
        const child = this.child;
        this.child = null;
        if (!child || child.exitCode !== null) return Promise.resolve();
        return new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                try {
                    child.kill("SIGKILL");
                } catch {
                    // 进程已退出时忽略。
                }
                resolve();
            }, 3_000);
            child.once("exit", () => {
                clearTimeout(timer);
                resolve();
            });
            try {
                child.kill();
            } catch {
                clearTimeout(timer);
                resolve();
            }
        });
    }
}
