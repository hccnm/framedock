import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { SkillStore } from "../../canvas-agent/src/skills/store.ts";
const require = createRequire(new URL("../../web/package.json", import.meta.url));
const { unzipSync } = require("fflate");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "framedock-market-check-"));
const store = new SkillStore(root);
const catalog = JSON.parse(await fs.readFile(new URL("../../web/public/skill-market/catalog.json", import.meta.url), "utf8"));
const results = [];
for (const skill of catalog) {
    try {
        const bytes = await fs.readFile(new URL(`../../web/public/skill-market/packages/${skill.name}.zip`, import.meta.url));
        const entries = unzipSync(bytes) as Record<string, Uint8Array>;
        const files = Object.fromEntries(Object.entries(entries).filter(([name]) => !name.endsWith("/")).map(([name, data]) => [name, Buffer.from(data).toString("base64")]));
        const imported = await store.importPackage({ files, interface: { displayName: skill.displayNameZh || skill.name, defaultPrompt: `$${skill.name} ${skill.guidePrompt || ""}`.trim() } });
        if (imported.name !== skill.name) throw new Error(`名称不一致: ${imported.name}`);
        results.push({ name: skill.name, ok: true, files: Object.keys(files).length });
    } catch (error) { results.push({ name: skill.name, ok: false, error: String(error) }); }
}
await fs.rm(root, { recursive: true });
await fs.writeFile(new URL("package-validation.json", import.meta.url), JSON.stringify(results, null, 2));
console.log({ passed: results.filter((r) => r.ok).length, failures: results.filter((r) => !r.ok) });
