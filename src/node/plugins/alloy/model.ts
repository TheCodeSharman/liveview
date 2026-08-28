import path from 'path';
import { Plugin } from 'vite';

import { AlloyContext } from './context';

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function modelPlugin(ctx: AlloyContext): Plugin {
	// Match canonical Alloy Model locations only: `<appDir>/models/*` or
	// `<appDir>/widgets/<name>/models/*`. Anchoring to `appDir` prevents
	// incidental `.../models/...` segments (e.g. `app/lib/models/*`) from
	// being treated as Alloy Models — those are plain libs, not model
	// definitions, and running them through the Alloy model compiler
	// fails with `Cannot read properties of null (reading 'widget')`.
	const modelRE = new RegExp(
		`^${escapeRegExp(
			ctx.appDir
		)}(?:[/\\\\]widgets[/\\\\][^/\\\\]+)?[/\\\\]models[/\\\\](.*)$`
	);

	return {
		name: 'titanium:alloy:model',

		async resolveId(id, importer) {
			if (modelRE.test(id)) {
				const result = await this.resolve(
					path.join(ctx.appDir, id.replace(/\/alloy\//, '')),
					importer,
					{ skipSelf: true }
				);
				if (result) {
					return result.id;
				}
			}
		},

		transform(code, id) {
			if (modelRE.test(id)) {
				const { code: modelCode } = ctx.compiler.compileModel({
					file: id,
					content: code
				});

				return modelCode;
			}
		}
	};
}
