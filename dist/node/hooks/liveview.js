"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.init = exports.id = void 0;
const path_1 = __importDefault(require("path"));
const chalk_1 = __importDefault(require("chalk"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const supports_color_1 = __importDefault(require("supports-color"));
const utils_1 = require("../utils");
const server_1 = require("../server");
const BOOSTRAP_FILE = '_liveview.bootstrap.js';
exports.id = 'liveview-v2';
function init(logger, config, cli) {
    let serverOptions;
    let usePreview = false;
    let nativeHelperCopied = false;
    const log = (msg) => logger.info(`${chalk_1.default.green('[LiveView]')} ${msg}`);
    const dbg = (msg) => logger.debug(`${chalk_1.default.green('[LiveView]')} ${msg}`);
    dbg('init() called — registering hooks');
    cli.on('build.config', (data) => {
        dbg('build.config hook fired');
        const config = data.result[1];
        const flags = config.flags || (config.flags = {});
        flags.liveview = {
            default: false,
            desc: 'Enable LiveView'
        };
        const options = config.options || (config.options = {});
        options['liveview-host'] = {
            default: null,
            desc: 'Specify which IP addresses the LiveView server should listen on'
        };
        options['liveview-port'] = {
            default: null,
            desc: 'Specify LiveView server port'
        };
    });
    // Add native run-loop swizzle to the Xcode project's compile sources.
    dbg('Registering build.ios.xcodeproject pre hook');
    cli.on('build.ios.xcodeproject', {
        pre: function (data, callback) {
            dbg('build.ios.xcodeproject pre hook fired');
            dbg(`  nativeHelperCopied=${nativeHelperCopied}`);
            if (!nativeHelperCopied) {
                dbg('  Skipping — native helper not copied yet');
                return callback();
            }
            const xcodeProject = data.args[0];
            dbg(`  xcodeProject.filepath=${xcodeProject?.filepath}`);
            log('Adding LiveViewFetch.m to Xcode project');
            try {
                // Create a file reference manually to avoid addPluginFile's
                // reliance on a 'Plugins' PBXGroup (which doesn't exist).
                const pbxFile = xcodeProject.addFile('Classes/LiveViewFetch.m', xcodeProject.getFirstProject().firstProject.mainGroup, { sourceTree: 'SOURCE_ROOT' });
                if (pbxFile) {
                    pbxFile.uuid = xcodeProject.generateUuid();
                    xcodeProject.addToPbxBuildFileSection(pbxFile);
                    xcodeProject.addToPbxSourcesBuildPhase(pbxFile);
                    dbg('  Added to compile sources');
                }
                else {
                    dbg('  addFile returned null (already exists?)');
                }
            }
            catch (e) {
                logger.warn(`${chalk_1.default.green('[LiveView]')} Failed to add LiveViewFetch.m: ${e}`);
            }
            callback();
        }
    });
    cli.on('build.pre.compile', {
        priority: 1100,
        post: async (builder, done) => {
            dbg('build.pre.compile post hook fired');
            dbg(`  cli.argv.liveview=${cli.argv.liveview}`);
            if (!cli.argv.liveview) {
                return done();
            }
            const sdkMajorVersion = parseInt(cli.sdk.name.substr(0, cli.sdk.name.indexOf('.')));
            if (sdkMajorVersion < 10) {
                return done();
            }
            // Delete liveview flag from argv to disable LiveView shipped with SDK
            delete cli.argv.liveview;
            usePreview = true;
            if (supports_color_1.default.stdout) {
                // Explicitly set `FORCE_COLOR` env to enable colored debug output using
                // chalk inside the app.
                process.env.FORCE_COLOR = supports_color_1.default.stdout.level.toString();
            }
            const projectDir = cli.argv['project-dir'];
            const liveviewDir = path_1.default.join(builder.buildDir, '.liveview');
            fs_extra_1.default.ensureDirSync(liveviewDir);
            const host = cli.argv['liveview-ip'] || (0, utils_1.resolveHost)();
            const port = cli.argv['liveview-port'] || 8323;
            const force = cli.argv['force'];
            serverOptions = {
                project: {
                    dir: projectDir,
                    type: (0, utils_1.determineProjectType)(builder),
                    platform: cli.argv.platform,
                    tiapp: cli.tiapp
                },
                server: {
                    host,
                    port,
                    force
                }
            };
            const templateFile = path_1.default.resolve(__dirname, '../liveview.bootstrap.js');
            let bootstrapContent = await fs_extra_1.default.readFile(templateFile, 'utf-8');
            bootstrapContent = bootstrapContent
                .replaceAll('__SERVER_HOSTNAME__', JSON.stringify(host))
                .replaceAll('__SERVER_PORT__', JSON.stringify(port));
            const bootstrapPath = path_1.default.join(liveviewDir, 'Resources', BOOSTRAP_FILE);
            await fs_extra_1.default.outputFile(bootstrapPath, bootstrapContent);
            // prevent deletion of LiveView cache folder under build/<platform>/.liveview
            builder.unmarkBuildDirFiles(liveviewDir);
            // prevent deletion of Vite's dep cache under build/.vite
            builder.unmarkBuildDirFiles(path_1.default.join(projectDir, 'build/.vite'));
            cli.on(`build.${cli.argv.platform}.requestResourcesDirPaths`, {
                pre: (data) => {
                    const paths = data.args[0];
                    paths.push(path_1.default.join(liveviewDir, 'Resources'));
                }
            });
            if (cli.argv.platform === 'ios') {
                // iOS does not support the above hook yet, manually copy the hook into
                // `Resources` for now.
                await fs_extra_1.default.copyFile(bootstrapPath, path_1.default.join(projectDir, 'Resources', BOOSTRAP_FILE));
                // Copy native helper that swizzles [APSHTTPRequest send] to
                // pump the run loop instead of blocking with a semaphore,
                // preventing the iOS scene-update watchdog (0x8BADF00D).
                const nativeSrc = path_1.default.resolve(__dirname, '../native/LiveViewFetch.m');
                dbg(`Native helper source: ${nativeSrc}`);
                dbg(`  exists: ${fs_extra_1.default.existsSync(nativeSrc)}`);
                if (fs_extra_1.default.existsSync(nativeSrc)) {
                    const classesDir = path_1.default.join(builder.buildDir, 'Classes');
                    fs_extra_1.default.ensureDirSync(classesDir);
                    const dest = path_1.default.join(classesDir, 'LiveViewFetch.m');
                    await fs_extra_1.default.copyFile(nativeSrc, dest);
                    nativeHelperCopied = true;
                    dbg(`Copied native helper to ${dest}`);
                }
                // The user might add new Ti APIs while developing with LiveView so let's
                // just preemptively include all Ti module
                builder.includeAllTiModules = true;
            }
            done();
        }
    });
    cli.on('build.pre.build', async (builder, done) => {
        dbg('build.pre.build hook fired');
        if (usePreview) {
            log('Starting dev server ...');
            await (0, server_1.startServer)(serverOptions);
        }
        done();
    });
}
exports.init = init;
