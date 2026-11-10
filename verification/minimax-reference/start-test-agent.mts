import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "framedock-ui-agent-"));
// Isolate the service configuration and skill writes from the user's desktop data.
os.homedir = () => testHome;
process.env.PORT = "17379";
await fs.mkdir(path.join(testHome, ".framedock"));
await fs.writeFile(path.join(testHome, ".framedock", "canvas-agent.json"), JSON.stringify({ url: "http://127.0.0.1:17379", token: "framedock-isolated-ui-test", origins: ["http://localhost:3011"] }));
const { startHttpServer } = await import("../../canvas-agent/src/server/http.ts");
startHttpServer();
