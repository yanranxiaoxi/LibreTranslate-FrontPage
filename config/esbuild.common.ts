import type { BuildOptions } from 'esbuild';

/**
 * 运行时依赖 external：由 Node ESM 直接加载（CJS 包若打进 ESM 产物会触发
 * “Dynamic require of ... is not supported”错误）
 */
export const RUNTIME_EXTERNALS = [
	'dotenv',
	'dotenv/config',
	'formidable',
	'winston',
	'winston-daily-rotate-file',
	'openid-client',
	'jose',
];

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
	format: 'esm', // 保持 ESM，不切换为 CJS
	treeShaking: false,
	ignoreAnnotations: true,
	define: {},
	external: RUNTIME_EXTERNALS,
};

export default config;
