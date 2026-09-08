import type { IContext } from '../utils/interface';
import { readFile, unlink } from 'node:fs/promises';
import { CONFIG } from '../config/config';
import { exceedsContentLength, fieldString, parseMultipart, pickFile, readJsonBody, upstreamFetchTimeout, writeUpstreamResponse } from '../utils/request';
import { getSessionUser, sendJson } from '../utils/respond';
import { Controller } from './controller';

/**
 * 翻译代理控制器
 *
 * 登录用户 + 已配置内置 api_key 时，代理请求并注入 api_key；
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

	/** POST /api/translate：代理文本翻译 */
	public async translate(ctx: IContext) {
		const res = ctx.res;
		if (!CONFIG.lt.apiUrl) {
			sendJson(res, 503, { error: 'LT_API_URL is not configured on this server' });
			return;
		}
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

		const user = getSessionUser(ctx.user);
		if (user && CONFIG.lt.apiKey) {
			// 仅登录用户经本服务代理时注入内置 token（未登录走前端直连，不经过此处）
			body.api_key = CONFIG.lt.apiKey;
		}

		try {
			const upstream = await fetch(`${CONFIG.lt.apiUrl}/translate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal: upstreamFetchTimeout(),
			});
			const text = await upstream.text();
			writeUpstreamResponse(res, upstream.status, text, upstream.headers.get('content-type'));
		}
		catch (ex) {
			ctx.logger.error('proxy translate failed', ex);
			sendJson(res, 502, { error: 'Cannot reach upstream LibreTranslate API' });
		}
	}

	/** POST /api/translate_file：代理文件翻译 */
	public async translateFile(ctx: IContext) {
		const res = ctx.res;
		if (!CONFIG.lt.apiUrl) {
			sendJson(res, 503, { error: 'LT_API_URL is not configured on this server' });
			return;
		}
		if (exceedsContentLength(ctx.req, 25 * 1024 * 1024)) {
			sendJson(res, 413, { error: 'Request body too large' });
			return;
		}

		let parsed: Record<string, unknown>;
		try {
			parsed = await parseMultipart(ctx.req);
		}
		catch (ex) {
			ctx.logger.warn('parse multipart failed', ex);
			sendJson(res, 400, { error: 'Invalid multipart body' });
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
			const buffer = await readFile(file.filepath);
			const form = new FormData();
			form.append('source', fieldString(fields, 'source', 'auto'));
			form.append('target', fieldString(fields, 'target'));
			const user = getSessionUser(ctx.user);
			if (user && CONFIG.lt.apiKey) {
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
			const text = await upstream.text();
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
}

const proxy = new Proxy();
export default proxy;
