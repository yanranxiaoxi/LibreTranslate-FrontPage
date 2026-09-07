import process from 'node:process';
import * as packageJson from '../../package.json';
import 'dotenv/config';

/**
 * 验证必需的环境变量
 * @param name - 环境变量名称
 * @param value - 环境变量值
 * @param defaultValue - 默认值
 * @returns 验证后的环境变量值
 */
function validateEnvVar(name: string, value: string | undefined, defaultValue?: string): string {
	if (!value && defaultValue === undefined) {
		throw new Error(`Required environment variable ${name} is not set`);
	}
	return value || defaultValue!;
}

/**
 * 验证端口号
 * @param port - 端口号字符串
 * @param defaultPort - 默认端口号
 * @returns 验证后的端口号
 */
function validatePort(port: string | undefined, defaultPort: number): number {
	const portNum = port ? Number(port) : defaultPort;
	if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
		throw new Error(`Invalid port number: ${port}. Must be between 1 and 65535`);
	}
	return portNum;
}

export const CONFIG = {
	env: validateEnvVar('ENV_PRODUCT', process.env.ENV_PRODUCT, 'development'),
	host: validateEnvVar('SERVER_HOST', process.env.SERVER_HOST, '0.0.0.0'),
	port: validatePort(process.env.SERVER_PORT, 80),
	serverName: validateEnvVar('SERVER_NAME', process.env.SERVER_NAME, 'server'),

	envProduct: validateEnvVar('ENV_PRODUCT', process.env.ENV_PRODUCT, 'development'),
	projectName: validateEnvVar('PROJECT_NAME', process.env.PROJECT_NAME, packageJson.name),
	logLevel: validateEnvVar('LOG_LEVEL', process.env.LOG_LEVEL, 'info'),
} as const;
