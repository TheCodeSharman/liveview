import path from 'path';
import chalk from 'chalk';
import fs from 'fs-extra';
import supportsColor from 'supports-color';

import { determineProjectType, resolveHost } from '../utils';
import { LiveViewOpions, startServer } from '../server';

interface DoneCallback {
	(error?: Error | null, ...args: unknown[]): void;
}

const BOOSTRAP_FILE = '_liveview.bootstrap.js';

export const id = 'liveview-v2';

export function init(logger: any, config: any, cli: any): void {
	let serverOptions: LiveViewOpions;
	let usePreview = false;
	let nativeHelperCopied = false;

	const log = (msg: string) =>
		logger.info(`${chalk.green('[LiveView]')} ${msg}`);
	const dbg = (msg: string) =>
		logger.debug(`${chalk.green('[LiveView]')} ${msg}`);

	dbg('init() called — registering hooks');

	cli.on('build.config', (data: any) => {
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
		pre: function (data: any, callback: DoneCallback) {
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
				const pbxFile = xcodeProject.addFile(
					'Classes/LiveViewFetch.m',
					xcodeProject.getFirstProject().firstProject.mainGroup,
					{ sourceTree: 'SOURCE_ROOT' }
				);
				if (pbxFile) {
					pbxFile.uuid = xcodeProject.generateUuid();
					xcodeProject.addToPbxBuildFileSection(pbxFile);
					xcodeProject.addToPbxSourcesBuildPhase(pbxFile);
					dbg('  Added to compile sources');
				} else {
					dbg('  addFile returned null (already exists?)');
				}
			} catch (e) {
				logger.warn(
					`${chalk.green('[LiveView]')} Failed to add LiveViewFetch.m: ${e}`
				);
			}
			callback();
		}
	});

	cli.on('build.pre.compile', {
		priority: 1100,
		post: async (builder: any, done: DoneCallback) => {
			dbg('build.pre.compile post hook fired');
			dbg(`  cli.argv.liveview=${cli.argv.liveview}`);
			if (!cli.argv.liveview) {
				return done();
			}

			const sdkMajorVersion = parseInt(
				cli.sdk.name.substr(0, cli.sdk.name.indexOf('.'))
			);
			if (sdkMajorVersion < 10) {
				return done();
			}
			// Delete liveview flag from argv to disable LiveView shipped with SDK
			delete cli.argv.liveview;
			usePreview = true;

			if (supportsColor.stdout) {
				// Explicitly set `FORCE_COLOR` env to enable colored debug output using
				// chalk inside the app.
				process.env.FORCE_COLOR = supportsColor.stdout.level.toString();
			}

			const projectDir = cli.argv['project-dir'];
			const liveviewDir = path.join(builder.buildDir, '.liveview');
			fs.ensureDirSync(liveviewDir);

			const host = cli.argv['liveview-ip'] || resolveHost();
			const port = cli.argv['liveview-port'] || 8323;
			const force = cli.argv['force'];
			serverOptions = {
				project: {
					dir: projectDir,
					type: determineProjectType(builder),
					platform: cli.argv.platform,
					tiapp: cli.tiapp
				},
				server: {
					host,
					port,
					force
				}
			};

			const templateFile = path.resolve(__dirname, '../liveview.bootstrap.js');
			let bootstrapContent = await fs.readFile(templateFile, 'utf-8');
			bootstrapContent = bootstrapContent
				.replaceAll('__SERVER_HOSTNAME__', JSON.stringify(host))
				.replaceAll('__SERVER_PORT__', JSON.stringify(port));
			const bootstrapPath = path.join(liveviewDir, 'Resources', BOOSTRAP_FILE);
			await fs.outputFile(bootstrapPath, bootstrapContent);

			// prevent deletion of LiveView cache folder under build/<platform>/.liveview
			builder.unmarkBuildDirFiles(liveviewDir);
			// prevent deletion of Vite's dep cache under build/.vite
			builder.unmarkBuildDirFiles(path.join(projectDir, 'build/.vite'));

			cli.on(`build.${cli.argv.platform}.requestResourcesDirPaths`, {
				pre: (data: any) => {
					const paths = data.args[0];
					paths.push(path.join(liveviewDir, 'Resources'));
				}
			});
			if (cli.argv.platform === 'ios') {
				// iOS does not support the above hook yet, manually copy the hook into
				// `Resources` for now.
				await fs.copyFile(
					bootstrapPath,
					path.join(projectDir, 'Resources', BOOSTRAP_FILE)
				);
				// Copy native helper that swizzles [APSHTTPRequest send] to
				// pump the run loop instead of blocking with a semaphore,
				// preventing the iOS scene-update watchdog (0x8BADF00D).
				const nativeSrc = path.resolve(__dirname, '../native/LiveViewFetch.m');
				dbg(`Native helper source: ${nativeSrc}`);
				dbg(`  exists: ${fs.existsSync(nativeSrc)}`);
				if (fs.existsSync(nativeSrc)) {
					const classesDir = path.join(builder.buildDir, 'Classes');
					fs.ensureDirSync(classesDir);
					const dest = path.join(classesDir, 'LiveViewFetch.m');
					await fs.copyFile(nativeSrc, dest);
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

	cli.on('build.pre.build', async (builder: any, done: DoneCallback) => {
		dbg('build.pre.build hook fired');
		if (usePreview) {
			log('Starting dev server ...');
			await startServer(serverOptions);
		}

		done();
	});
}
