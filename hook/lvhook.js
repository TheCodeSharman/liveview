'use strict';

// Native entry point for Titanium SDK 13.4.0+, whose bundled
// `cli/hooks/liveview.js` is `export * from 'liveview/hook/lvhook.js'`.
// Re-exporting the v2 build hook here makes the SDK load THIS package's
// LiveView directly, so it overrides the default and registers `--liveview`
// exactly once. Pre-13.4.0 SDKs have no such shim and load the same hook via
// the `paths.hooks` entry the installer adds instead.
const hook = require('../dist/node/hooks/liveview.js');

exports.id = hook.id;
exports.init = hook.init;
