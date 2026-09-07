export type ToastType = 'info' | 'error' | 'success';

let toastTimer: number | undefined;

/**
 * 简易 toast 提示
 */
export function toast(message: string, type: ToastType = 'info'): void {
	let box = document.getElementById('toast-box');
	if (!box) {
		box = document.createElement('div');
		box.id = 'toast-box';
		box.className = 'toast-box';
		document.body.appendChild(box);
	}
	const item = document.createElement('div');
	item.className = `toast toast-${type}`;
	item.textContent = message;
	box.appendChild(item);
	window.clearTimeout(toastTimer);
	toastTimer = window.setTimeout(() => {
		box?.replaceChildren();
	}, 3500);
}

/**
 * 创建元素的小工具
 */
export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	attrs: Record<string, string> = {},
	children: Array<HTMLElement | string> = [],
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		node.setAttribute(key, value);
	}
	for (const child of children) {
		node.append(child);
	}
	return node;
}

/**
 * 生成文件名对应的下载文件名（从 translatedFileUrl 中解析）
 */
export function fileNameFromUrl(url: string): string {
	try {
		const name = new URL(url).pathname.split('/').filter(Boolean).pop();
		return name || 'translation';
	}
	catch {
		return 'translation';
	}
}

/**
 * 触发浏览器下载
 */
export function triggerDownload(url: string): void {
	const a = document.createElement('a');
	a.href = url;
	a.download = fileNameFromUrl(url);
	a.rel = 'noopener';
	document.body.appendChild(a);
	a.click();
	a.remove();
}
