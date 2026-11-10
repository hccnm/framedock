import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const desktop = path.join(root, "desktop");
const staging = path.join(desktop, ".packaging");

export async function readReleaseVersion(directory = root) {
    const tag = (await readFile(path.join(directory, "VERSION"), "utf8")).trim();
    if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== tag) {
        throw new Error(`发布 tag ${process.env.GITHUB_REF_NAME} 与 VERSION ${tag} 不一致`);
    }
    return tag.replace(/^v/, "");
}

async function prepare() {
    if (process.platform !== "darwin") throw new Error("macOS 安装包须在 macOS 上构建");
    const version = await readReleaseVersion();
    // 先确认所有构建产物存在，再替换本脚本专用的暂存目录。
    for (const relative of ["desktop/dist/main.js", "desktop/dist/preload.js", "web/dist/index.html", "web/dist/plugins/index.json", "canvas-agent/dist/index.js"]) {
        if (!(await stat(path.join(root, relative))).isFile()) throw new Error(`缺少构建产物：${relative}，请先运行 npm run build`);
    }
    await mkdir(staging, { recursive: true });
    for (const name of ["app", "canvas-agent", "icon.iconset"]) {
        await rm(path.join(staging, name), { recursive: true, force: true });
        await mkdir(path.join(staging, name));
    }
    const manifest = JSON.parse(await readFile(path.join(desktop, "package.json"), "utf8"));
    await writeFile(path.join(staging, "app/package.json"), JSON.stringify({
        name: "framedock", version, main: manifest.main,
        description: "FrameDock desktop creative workspace",
        author: "FrameDock contributors", license: "MIT",
        homepage: "https://github.com/hccnm/framedock",
    }, null, 2) + "\n");
    await cp(path.join(desktop, "dist"), path.join(staging, "app/dist"), { recursive: true });
    await cp(path.join(root, "LICENSE"), path.join(staging, "app/LICENSE"));
    for (const name of ["package.json", "package-lock.json", "agent-instructions.md", "dist"]) {
        await cp(path.join(root, "canvas-agent", name), path.join(staging, "canvas-agent", name), { recursive: true });
    }
    // 从锁文件独立安装生产依赖，不携带开发依赖、用户配置或本机 node_modules。
    execFileSync("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
        cwd: path.join(staging, "canvas-agent"), stdio: "inherit",
    });
    const icon = path.join(root, "web/public/framedock-icon.png");
    const iconset = path.join(staging, "icon.iconset");
    for (const size of [16, 32, 128, 256, 512]) {
        for (const scale of [1, 2]) {
            execFileSync("sips", ["-z", String(size * scale), String(size * scale), icon, "--out", path.join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`)], { stdio: "ignore" });
        }
    }
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(staging, "icon.icns")], { stdio: "inherit" });
    console.log(`FrameDock ${version} 打包资源已准备完成`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    prepare().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
