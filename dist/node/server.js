"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startServer = void 0;
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = require("node:fs");
const vite_1 = require("vite");
const optimizer_1 = require("./optimizer");
const plugins_1 = require("./plugins");
const constants_js_1 = require("./constants.js");
async function startServer({ project, server }) {
    const { dir: projectDir, type: projectType, platform, tiapp } = project;
    const isAlloy = projectType === 'alloy';
    const root = node_path_1.default.join(projectDir, isAlloy ? 'app' : 'Resources');
    const appEntry = isAlloy ? 'alloy.js' : 'app.js';
    // Read native module IDs directly from tiapp.xml rather than tiapp.modules,
    // which may have been filtered by build hooks (e.g. stripsimincompatiblemodules
    // removes simulator-incompatible modules before Vite starts). Vite needs to
    // know about ALL native modules so it can mark them as external.
    let nativeModules;
    try {
        const tiappXmlPath = node_path_1.default.join(projectDir, 'tiapp.xml');
        const tiappXmlContent = (0, node_fs_1.readFileSync)(tiappXmlPath, 'utf-8');
        const modulePattern = /<module[^>]*>([^<]+)<\/module>/g;
        const moduleSet = new Set();
        let match;
        while ((match = modulePattern.exec(tiappXmlContent)) !== null) {
            moduleSet.add(match[1].trim());
        }
        nativeModules = [...moduleSet];
    }
    catch (e) {
        nativeModules = [...new Set(tiapp.modules.map((m) => m.id))];
    }
    const define = {
        OS_ANDROID: JSON.stringify(platform === 'android'),
        OS_IOS: JSON.stringify(platform === 'ios')
    };
    const configFile = node_path_1.default.join(projectDir, 'vite.config.js');
    const viteSever = await (0, vite_1.createServer)({
        configFile: (0, node_fs_1.existsSync)(configFile) ? configFile : undefined,
        clearScreen: false,
        root,
        build: {
            modulePreload: false,
            rollupOptions: {
                input: appEntry
            }
        },
        plugins: await (0, plugins_1.resolvePlugins)({
            projectDir,
            type: projectType,
            platform,
            nativeModules
        }),
        define,
        resolve: {
            alias: [
                {
                    find: /^\/?@vite\/env/,
                    replacement: node_path_1.default.posix.join(constants_js_1.FS_PREFIX, (0, vite_1.normalizePath)(constants_js_1.ENV_ENTRY))
                },
                {
                    find: /^\/?@vite\/client/,
                    replacement: node_path_1.default.posix.join(constants_js_1.FS_PREFIX, (0, vite_1.normalizePath)(constants_js_1.CLIENT_ENTRY))
                }
            ]
        },
        cacheDir: node_path_1.default.join(projectDir, 'build/.vite'),
        optimizeDeps: {
            exclude: [...nativeModules],
            esbuildOptions: {
                define,
                plugins: nativeModules.length > 0 ? [{
                        name: 'titanium:native-modules',
                        setup(build) {
                            const escaped = nativeModules.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                            const filter = new RegExp(`^(${escaped.join('|')})$`);
                            build.onResolve({ filter }, (args) => ({ path: args.path, external: true }));
                        }
                    }] : []
            }
        },
        server: {
            ...server,
            hmr: true,
            fs: {
                allow: [projectDir, constants_js_1.CLIENT_DIR]
            }
        },
        appType: 'custom',
        json: {
            stringify: true
        }
    });
    await viteSever.listen();
    await (0, optimizer_1.runDynamicOptimize)(viteSever);
    return viteSever;
}
exports.startServer = startServer;
