/** /api/config 返回结构 */
export interface AppConfig {
	apiUrl: string;
}

/** /api/auth/status 返回结构 */
export interface AuthStatus {
	loggedIn: boolean;
	authEnabled: boolean;
	user: { username: string } | null;
}

/** GET /languages 语言项 */
export interface LangOption {
	code: string;
	name: string;
	targets?: string[];
}

/** GET /frontend/settings */
export interface FrontendSettings {
	charLimit: number;
	frontendTimeout: number;
	filesTranslation: boolean;
	supportedFilesFormat: string[];
	language?: {
		source?: { code: string; name: string };
		target?: { code: string; name: string };
	};
}

/** POST /translate 响应 */
export interface TranslateResult {
	translatedText: string;
	alternatives?: string[];
	detectedLanguage?: { language: string; confidence: number };
}

/** 翻译请求载荷 */
export interface TranslatePayload {
	q: string;
	source: string;
	target: string;
	format?: 'text' | 'html';
	alternatives?: number;
}

/** 带业务信息的请求错误 */
export class ApiError extends Error {
	public readonly status: number;
	public constructor(message: string, status = 0) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
	}
}
