import { unzipSync } from "fflate";
import { fetchAgentJson, type AgentSkillInterface, type AgentSkillResponse } from "./canvas-agent";

export type MarketSkill = {
    name: string;
    displayNameZh: string;
    summaryZh: string;
    description: string;
    version: string;
    authorCn: string;
    source: string;
    downloads: number;
    tagsCn: string[];
    categoryCodes: string[];
    coverUrl?: string;
    showcase: string[];
    guidePrompt?: string;
    packageUrl?: string;
    structuredInfo?: Record<string, { summary: string; best_for: string[]; how_to_use: string; outputs: string }>;
};

export async function fetchSkillCatalog(): Promise<MarketSkill[]> {
    const response = await fetch(`${import.meta.env.BASE_URL}skill-market/catalog.json`);
    if (!response.ok) throw new Error("技能目录读取失败");
    return response.json();
}

export async function importSkillPackage(endpoint: string, token: string, data: ArrayBuffer, metadata?: AgentSkillInterface) {
    // Match the Skill import JSON limit before allocating decompressed resources.
    let encodedSize = 0;
    const entries = Object.entries(unzipSync(new Uint8Array(data), { filter: (file) => {
        encodedSize += Math.ceil(file.originalSize / 3) * 4;
        if (encodedSize > 256 * 1024 * 1024) throw new Error("技能安装请求超过 256 MB 上限，未安装任何文件");
        return true;
    } })).filter(([name]) => !name.endsWith("/"));
    const direct = entries.find(([name]) => name === "SKILL.md");
    const roots = direct ? [direct] : entries.filter(([name]) => name.split("/").length === 2 && name.endsWith("/SKILL.md"));
    if (roots.length !== 1) throw new Error("请选择只包含一个 SKILL.md 的技能 ZIP 文件");
    const prefix = roots[0][0].slice(0, -"SKILL.md".length);
    const files: Record<string, string> = Object.create(null);
    for (const [name, bytes] of entries) {
        if (!name.startsWith(prefix)) throw new Error("技能包包含目录外文件");
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
        files[name.slice(prefix.length)] = btoa(binary);
    }
    const body = JSON.stringify({ files, interface: metadata });
    if (new Blob([body]).size > 256 * 1024 * 1024) throw new Error("技能安装请求超过 256 MB 上限，未安装任何文件");
    return fetchAgentJson<AgentSkillResponse>(endpoint, token, "/agent/api/skills/import", {
        method: "POST", headers: { "Content-Type": "application/json" }, body,
    });
}
