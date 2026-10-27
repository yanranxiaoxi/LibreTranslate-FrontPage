import type { IContext } from '../utils/interface';
import type { SessionUser } from '../utils/session';
import { readFile, unlink } from 'node:fs/promises';
import { CONFIG } from '../config/config';
import { ConcurrencyGate, TokenBucketLimiter } from '../utils/limit';
import { exceedsContentLength, fieldString, parseMultipart, pickFile, readJsonBody, readTextWithLimit, upstreamFetchTimeout, writeUpstreamResponse } from '../utils/request';
import { getSessionUser, sendJson } from '../utils/respond';
import { Controller } from './controller';

/** 全局并发闸门：限制同时在途的上游请求，避免套接字与内存被打满 */
const gate = new ConcurrencyGate(CONFIG.lt.proxyConcurrency);
/** 按用户限流：桶容量取每分钟额度，均匀补充 */
const limiter = new TokenBucketLimiter(CONFIG.lt.proxyRateLimit, CONFIG.lt.proxyRateLimit / 60);

/**
 * 翻译代理控制器
 *
 * 仅登录用户可用：代理请求并注入内置 api_key；未登录用户由前端直连上游。
 * 响应透传 LibreTranslate 原生 JSON（不使用 {success,code,result} 信封）。
 */
class Proxy extends Controller {
	/** GET /api/config：暴露上游 API 地址与登录用户字符上限（供前端未登录直连/登录放宽输入） */
	public async config(ctx: IContext) {
		sendJson(ctx.res, 200, {
			apiUrl: CONFIG.lt.apiUrl,
			// 0 表示未配置，不带该字段（前端登录态仍沿用上游匿名限制）
			...(CONFIG.lt.loginCharLimit > 0 ? { loginCharLimit: CONFIG.lt.loginCharLimit } : {}),
		});
	}

	/**
	 * 代理接口前置校验：上游已配置、已登录、未超出速率
	 * @returns 通过时返回当前用户；否则已写出 503 / 401 / 429 并返回 null
	 */
	private guard(ctx: IContext): SessionUser | null {
		if (!CONFIG.lt.apiUrl) {
			sendJson(ctx.res, 503, { error: 'LT_API_URL is not configured on this server' });
			return null;
		}
		const user = getSessionUser(ctx.user);
		if (!user) {
			sendJson(ctx.res, 401, { error: 'Login required to use the server proxy' });
			return null;
		}
		if (!limiter.take(user.sub)) {
			sendJson(ctx.res, 429, { error: 'Too many requests, please try again later' });
			return null;
		}
		return user;
	}

	/** POST /api/translate：代理文本翻译 */
	public async translate(ctx: IContext) {
		const res = ctx.res;
		const user = this.guard(ctx);
		if (!user) {
			return;
		}
		if (!gate.tryAcquire()) {
			sendJson(res, 503, { error: 'Server is busy, please try again later' });
			return;
		}

		try {
			if (exceedsContentLength(ctx.req)) {
				sendJson(res, 413, { error: 'Request body too large' });
				return;
			}
			let body: Record<string, unknown>;
			try {
				body = await readJsonBody(ctx.req);
			}
			catch (ex) {
				const message = ex instanceof Error ? ex.message : '';
				sendJson(res, message === 'Request body too large' ? 413 : 400, { error: message === 'Request body too large' ? message : 'Invalid JSON body' });
				return;
			}

			// 服务端配额：客户端 maxLength 只影响输入框，必须在此复核
			const limit = CONFIG.lt.loginCharLimit;
			if (limit > 0 && typeof body.q === 'string' && body.q.length > limit) {
				sendJson(res, 413, { error: `Text exceeds the configured limit of ${limit} characters` });
				return;
			}

			if (CONFIG.lt.apiKey) {
				// 仅登录用户经本服务代理时注入内置 token（未登录走前端直连，不经过此处）
				body.api_key = CONFIG.lt.apiKey;
			}

			const upstream = await fetch(`${CONFIG.lt.apiUrl}/translate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal: upstreamFetchTimeout(),
			});
			const text = await readTextWithLimit(upstream);
			if (text === null) {
				sendJson(res, 502, { error: 'Upstream response too large' });
				return;
			}
			writeUpstreamResponse(res, upstream.status, text, upstream.headers.get('content-type'));
		}
		catch (ex) {
			ctx.logger.error('proxy translate failed', ex);
			sendJson(res, 502, { error: 'Cannot reach upstream LibreTranslate API' });
		}
		finally {
			gate.release();
		}
	}

	/** POST /api/translate_file：代理文件翻译 */
	public async translateFile(ctx: IContext) {
		const res = ctx.res;
		const user = this.guard(ctx);
		if (!user) {
			return;
		}
		if (!gate.tryAcquire()) {
			sendJson(res, 503, { error: 'Server is busy, please try again later' });
			return;
		}

		const maxFileBytes = CONFIG.lt.proxyMaxFileBytes;
		try {
			// multipart 边界与字段开销留 1 MiB 余量，超出的交给 formidable 单文件上限兜底
			if (exceedsContentLength(ctx.req, maxFileBytes + 1024 * 1024)) {
				sendJson(res, 413, { error: 'Request body too large' });
				return;
			}

			let parsed: Record<string, unknown>;
			try {
				parsed = await parseMultipart(ctx.req, maxFileBytes);
			}
			catch (ex) {
				// formidable 对超限文件抛 httpCode 413 的错误，按载荷过大而非报文非法处理
				const status = (ex as { httpCode?: number } | null)?.httpCode === 413 ? 413 : 400;
				ctx.logger.warn('parse multipart failed', ex);
				sendJson(res, status, { error: status === 413 ? 'Request body too large' : 'Invalid multipart body' });
				return;
			}

			// formidable 解析成功后已落盘的临时文件（即使字段名不符也需清理，防泄漏）
			const allFiles = (parsed.files as Record<string, unknown> | undefined) ?? {};
			const cleanup = () => {
				for (const file of Object.values(allFiles)) {
					const item = Array.isArray(file) ? file[0] : file;
					const filepath = item && typeof item === 'object' ? (item as { filepath?: string }).filepath : undefined;
					if (filepath) {
						unlink(filepath).catch(() => {});
					}
				}
			};

			const fields = parsed.fields as Record<string, unknown> | undefined;
			const file = pickFile(allFiles);
			if (!file) {
				cleanup();
				sendJson(res, 400, { error: 'Missing file field' });
				return;
			}

			try {
				if (file.size > maxFileBytes) {
					sendJson(res, 413, { error: `File exceeds the configured limit of ${maxFileBytes} bytes` });
					return;
				}

				const buffer = await readFile(file.filepath);
				const form = new FormData();
				form.append('source', fieldString(fields, 'source', 'auto'));
				form.append('target', fieldString(fields, 'target'));
				if (CONFIG.lt.apiKey) {
					form.append('api_key', CONFIG.lt.apiKey);
				}
				// Buffer → BlobPart：运行时任何 ArrayBufferView 均可，类型上 Uint8Array 满足 BlobPart
				const bytes = new Uint8Array(buffer);
				form.append('file', new Blob([bytes as unknown as BlobPart]), file.originalFilename || 'document.txt');

				const upstream = await fetch(`${CONFIG.lt.apiUrl}/translate_file`, {
					method: 'POST',
					body: form,
					signal: upstreamFetchTimeout(),
				});
				const text = await readTextWithLimit(upstream);
				if (text === null) {
					sendJson(res, 502, { error: 'Upstream response too large' });
					return;
				}
				writeUpstreamResponse(res, upstream.status, text, upstream.headers.get('content-type'));
			}
			catch (ex) {
				ctx.logger.error('proxy translate_file failed', ex);
				sendJson(res, 502, { error: 'Cannot reach upstream LibreTranslate API' });
			}
			finally {
				// 清理 formidable 临时文件
				cleanup();
			}
		}
		finally {
			gate.release();
		}
	}
}

const proxy = new Proxy();
export default proxy;
