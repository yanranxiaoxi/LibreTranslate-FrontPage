import type { AppConfig, AuthStatus, FrontendSettings, LangOption, TranslatePayload, TranslateResult } from './types';
import { ApiError } from './types';

const configCache: AppConfig = { apiUrl: '' };
let statusCache: AuthStatus = { loggedIn: false, authEnabled: false, user: null };
const CFG_KEY = 'lt-api-url';
type AuthListener = (status: AuthStatus) => void;
const authListeners: AuthListener[] = [];

/** 订阅登录态变化（会话过期自动登出后，界面据此刷新用户区） */
export function onAuthChange(cb: AuthListener): void {
	authListeners.push(cb);
}

/** 内部：登录态变化时通知订阅者（如翻译遇 401 自动登出后） */
function notifyAuthChange(status: AuthStatus): void {
	authListeners.forEach(cb => cb(status));
}
/** 安全读写 localStorage（隐私模式/沙箱下可能抛错，一律吞掉） */
function storageGet(key: string): string | null {
	try {
		return localStorage.getItem(key);
	}
	catch {
		return null;
	}
}

function storageSet(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	}
	catch {
		// 忽略
	}
}

/**
 * 请求同源 JSON 接口
 */
async function sameOriginJson<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, init);
	let data: unknown = null;
	try {
		data = await res.json();
	}
	catch {
		// 非 JSON 响应
	}
	if (!res.ok) {
		const err = data as { error?: string } | null;
		throw new ApiError(err?.error || `HTTP ${res.status}`, res.status);
	}
	return data as T;
}

/**
 * 加载应用配置（上游 API 地址），失败时回退本地缓存（PWA 离线场景）
 */
export async function loadConfig(): Promise<AppConfig> {
	try {
		const cfg = await sameOriginJson<AppConfig>('/api/config');
		configCache.apiUrl = cfg.apiUrl;
		configCache.loginCharLimit = cfg.loginCharLimit;
		if (cfg.apiUrl) {
			storageSet(CFG_KEY, cfg.apiUrl);
		}
		return configCache;
	}
	catch {
		const stored = storageGet(CFG_KEY);
		if (stored) {
			configCache.apiUrl = stored;
			return configCache;
		}
		throw new ApiError('Server unreachable');
	}
}

/**
 * 加载登录状态
 */
export async function loadAuthStatus(): Promise<AuthStatus> {
	statusCache = await sameOriginJson<AuthStatus>('/api/auth/status');
	authListeners.forEach(cb => cb(statusCache));
	return statusCache;
}

export function getApiUrl(): string {
	return configCache.apiUrl;
}

export function isLoggedIn(): boolean {
	return statusCache.loggedIn;
}

/**
 * 登录用户的字符上限（服务端配置，0/undefined 表示不覆盖）
 */
export function getLoginCharLimit(): number | undefined {
	return configCache.loginCharLimit;
}

/**
 * UI 语言码 → LibreTranslate 上游界面语言码映射。
 *
 * 上游 locale 使用 BCP-47 旧标签：简体中文为 zh（非 zh-Hans）。
 * 拉取 /languages?lang= 需用上游认识的码，否则语言名会退回英文。
 */
const LT_LOCALE_BY_UI: Record<string, string> = {
	'zh-Hans': 'zh',
};

/**
 * 拉取语言列表（uiLang 决定返回的语言名语言，映射到上游界面语言码）
 */
export async function getLanguages(uiLang: string): Promise<LangOption[]> {
	const ltLang = LT_LOCALE_BY_UI[uiLang] ?? uiLang;
	return await sameOriginJson<LangOption[]>(`${configCache.apiUrl}/languages?lang=${encodeURIComponent(ltLang)}`);
}

/**
 * 拉取前端设置
 */
export async function getSettings(): Promise<FrontendSettings> {
	return await sameOriginJson<FrontendSettings>(`${configCache.apiUrl}/frontend/settings`);
}

/**
 * 执行一次翻译请求；会话过期（代理返回 401）时刷新登录态并自动重试直连上游。
 */
async function translateOnce(payload: TranslatePayload, signal?: AbortSignal): Promise<TranslateResult> {
	const url = isLoggedIn() ? '/api/translate' : `${configCache.apiUrl}/translate`;
	return await sameOriginJson<TranslateResult>(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
		signal,
	});
}

/**
 * 文本翻译：未登录直连上游 API，登录走本服务代理（注入内置 token）
 */
export async function translateText(payload: TranslatePayload, signal?: AbortSignal): Promise<TranslateResult> {
	try {
		return await translateOnce(payload, signal);
	}
	catch (err) {
		// 会话中途过期/失效：刷新登录态，若确已登出则改为直连重试一次
		if (err instanceof ApiError && err.status === 401) {
			try {
				await loadAuthStatus();
			}
			catch {
				statusCache = { loggedIn: false, authEnabled: false, user: null };
				notifyAuthChange(statusCache);
			}
			if (!isLoggedIn()) {
				return await translateOnce(payload, signal);
			}
		}
		throw err;
	}
}

/**
 * 文件翻译：路径选择同文本翻译；会话过期（代理返回 401）时刷新登录态并自动重试直连上游。
 */
async function translateFileOnce(file: File, source: string, target: string, signal?: AbortSignal): Promise<{ translatedFileUrl: string }> {
	const form = new FormData();
	form.append('file', file);
	form.append('source', source);
	form.append('target', target);
	const url = isLoggedIn() ? '/api/translate_file' : `${configCache.apiUrl}/translate_file`;
	return await sameOriginJson<{ translatedFileUrl: string }>(url, {
		method: 'POST',
		body: form,
		signal,
	});
}

/**
 * 文件翻译：未登录直连上游 API，登录走本服务代理
 */
export async function translateFile(file: File, source: string, target: string, signal?: AbortSignal): Promise<{ translatedFileUrl: string }> {
	try {
		return await translateFileOnce(file, source, target, signal);
	}
	catch (err) {
		// 会话中途过期/失效：刷新登录态，若确已登出则改为直连重试一次
		if (err instanceof ApiError && err.status === 401) {
			try {
				await loadAuthStatus();
			}
			catch {
				statusCache = { loggedIn: false, authEnabled: false, user: null };
				notifyAuthChange(statusCache);
			}
			if (!isLoggedIn()) {
				return await translateFileOnce(file, source, target, signal);
			}
		}
		throw err;
	}
}
