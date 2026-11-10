const release = process.env.FRAMEDOCK_RELEASE === "1";

module.exports = {
    appId: "io.github.hccnm.framedock",
    productName: "FrameDock",
    directories: { app: ".packaging/app", output: "release" },
    files: ["dist/**/*.js", "package.json", "LICENSE"],
    extraResources: [
        { from: "../web/dist", to: "web/dist", filter: ["**/*", "!**/*.map"] },
        { from: ".packaging/canvas-agent", to: "canvas-agent", filter: ["**/*", "!**/*.test.*", "!**/*.map", "!**/*.d.ts", "!**/fixtures/**"] },
        { from: "../web/public/framedock-icon.png", to: "framedock-icon.png" },
    ],
    asar: true,
    npmRebuild: false,
    electronFuses: { runAsNode: true },
    forceCodeSigning: release,
    artifactName: "${productName}-${version}-${arch}.${ext}",
    mac: {
        target: ["dmg"],
        category: "public.app-category.graphics-design",
        icon: ".packaging/icon.icns",
        identity: release ? undefined : "-",
        hardenedRuntime: release,
        entitlements: "build/entitlements.mac.plist",
        entitlementsInherit: "build/entitlements.mac.plist",
        notarize: release,
    },
    dmg: { contents: [{ x: 130, y: 220 }, { x: 410, y: 220, type: "link", path: "/Applications" }] },
    publish: null,
};
