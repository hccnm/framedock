import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import express from "../../canvas-agent/node_modules/express/index.js";

// Separate home, Agent configuration, and external MCP port; no user credentials or generation.
const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "framedock-video-frame-"));
os.homedir = () => testHome;
process.env.PORT = "17390";
await fs.mkdir(path.join(testHome, ".framedock"));
await fs.writeFile(path.join(testHome, ".framedock", "canvas-agent.json"), JSON.stringify({ url: "http://127.0.0.1:17390", token: "video-frame-internal-test", origins: ["http://localhost:3030", "http://127.0.0.1:3030"] }));
const { startHttpServer } = await import("../../canvas-agent/src/server/http.ts");
const { createExternalMcp } = await import("../../canvas-agent/src/server/external-mcp.ts");
startHttpServer();
// Run the real MCP transport against the real Agent/session/SSE bridge, using an isolated test port.
const external = createExternalMcp(async (name, input) => {
    const response = await fetch("http://127.0.0.1:17390/api/tools", { method: "POST", headers: { "Content-Type": "application/json", "x-canvas-agent-token": "video-frame-internal-test" }, body: JSON.stringify({ name, input }) });
    const body = await response.json();
    if (!body.ok) throw new Error(body.error || "tool failed");
    return body.result;
}, { port: 17392, token: "video-frame-external-test" });
const management = express();
management.use(express.json());
management.use(external.settings);
const managementServer = management.listen(17391, "127.0.0.1");
await new Promise<void>((resolve) => managementServer.once("listening", resolve));
const enabled = await fetch("http://127.0.0.1:17391/agent/api/external-mcp", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) });
if (!enabled.ok) throw new Error("Could not enable isolated MCP");
console.log("Video frame MCP fixture ready: Agent 17390; MCP 17392");
process.once("SIGTERM", async () => {
    await external.close();
    managementServer.close();
    await fs.rm(testHome, { recursive: true, force: true });
    process.exit(0);
});
