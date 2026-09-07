import type { BuildOptions } from 'esbuild';

const config: BuildOptions = {
	entryPoints: {
		index: './src/entry/index.ts',
	},
	entryNames: '[name]',
	assetNames: '[name]',
	bundle: true,
	minify: false,
	loader: {},
	outdir: './dist/',
	sourcemap: 'linked',
	platform: 'node',
	treeShaking: false,
	ignoreAnnotations: true,
	define: {},
	external: ['skywalking-backend-js'],
};

export default config;
