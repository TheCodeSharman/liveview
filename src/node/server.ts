import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { ViteDevServer } from 'vite';
import { createServer, normalizePath } from 'vite';

import { runDynamicOptimize } from './optimizer';
import { resolvePlugins } from './plugins';
import type { Platform, ProjectType } from './types';
import { CLIENT_DIR, CLIENT_ENTRY, ENV_ENTRY, FS_PREFIX } from './constants.js';

interface ProjectOptions {
	dir: string;
	type: ProjectType;
	platform: Platform;
	tiapp: any;
}

interface ServerOptions {
	host: string;
	port: number | undefined;
	force: boolean;
}

export interface LiveViewOpions {
	project: ProjectOptions;
	server: ServerOptions;
}

export async function startServer({
	project,
	server
}: LiveViewOpions): Promise<ViteDevServer> {
	const { dir: projectDir, type: projectType, platform, tiapp } = project;
	const isAlloy = projectType === 'alloy';
	const root = path.join(projectDir, isAlloy ? 'app' : 'Resources');
	const appEntry = isAlloy ? 'alloy.js' : 'app.js';
	// Read native module IDs directly from tiapp.xml rather than tiapp.modules,
	// which may have been filtered by build hooks (e.g. stripsimincompatiblemodules
	// removes simulator-incompatible modules before Vite starts). Vite needs to
	// know about ALL native modules so it can mark them as external.
	let nativeModules: string[];
	try {
		const tiappXmlPath = path.join(projectDir, 'tiapp.xml');
		const tiappXmlContent = readFileSync(tiappXmlPath, 'utf-8');
		const modulePattern = /<module[^>]*>([^<]+)<\/module>/g;
		const moduleSet = new Set<string>();
		let match;
		while ((match = modulePattern.exec(tiappXmlContent)) !== null) {
			moduleSet.add(match[1].trim());
		}
		nativeModules = [...moduleSet];
	} catch (e) {
		nativeModules = [...new Set<string>(tiapp.modules.map((m: any) => m.id))];
	}
	const define: Record<string, string> = {
		OS_ANDROID: JSON.stringify(platform === 'android'),
		OS_IOS: JSON.stringify(platform === 'ios')
	};
	const configFile = path.join(projectDir, 'vite.config.js');
	const viteSever = await createServer({
		configFile: existsSync(configFile) ? configFile : undefined,
		clearScreen: false,
		root,
		build: {
			modulePreload: false,
			rollupOptions: {
				input: appEntry
			}
		},
		plugins: await resolvePlugins({
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
					replacement: path.posix.join(FS_PREFIX, normalizePath(ENV_ENTRY))
				},
				{
					find: /^\/?@vite\/client/,
					replacement: path.posix.join(FS_PREFIX, normalizePath(CLIENT_ENTRY))
				}
			]
		},
		cacheDir: path.join(projectDir, 'build/.vite'),
		optimizeDeps: {
			exclude: [...nativeModules],
			esbuildOptions: {
				define,
				plugins: nativeModules.length > 0 ? [{
					name: 'titanium:native-modules',
					setup(build: any) {
						const escaped = nativeModules.map((m: string) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
						const filter = new RegExp(`^(${escaped.join('|')})$`);
						build.onResolve({ filter }, (args: any) => ({ path: args.path, external: true }));
					}
				}] : []
			}
		},
		server: {
			...server,
			hmr: true,
			fs: {
				allow: [projectDir, CLIENT_DIR]
			}
		},
		appType: 'custom',
		json: {
			stringify: true
		}
	});
	await viteSever.listen();
	await runDynamicOptimize(viteSever);

	return viteSever;
}
