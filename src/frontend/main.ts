import type { Theme } from './theme';
import * as api from './api';
import { renderAuth } from './auth';
import { getLang, initI18n, setLang, SUPPORTED_LANGS, t } from './i18n';
import { initScrollChrome } from './scroll-chrome';
import { initTheme, toggleTheme } from './theme';
import { initTranslate } from './translate';
import { el, textWithLinks, toast } from './ui';

const ROOT_ID = 'app';
/** 项目源码仓库：顶栏按钮跳转目标 */
const GITHUB_URL = 'https://github.com/yanranxiaoxi/LibreTranslate-FrontPage';

/** 已应用到 `<html>` 的主题 */
function currentTheme(): Theme {
	return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** 主题按钮图标：深色主题下显示 ☀（点击切回浅色），浅色主题下显示 ☾ */
function themeIcon(theme: Theme): string {
	return theme === 'dark' ? '☀' : '☾';
}

/**
 * GitHub 图标
 *
 * 用 createElementNS 而不是 innerHTML：项目里没有 HTML 拼接，
 * SVG 作为按钮内容同样按静态标记处理。
 */
function githubIcon(): SVGSVGElement {
	const NS = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(NS, 'svg');
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('focusable', 'false');
	const path = document.createElementNS(NS, 'path');
	// GitHub mark（官方 16×16 路径）
	path.setAttribute('d', 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z');
	svg.append(path);
	return svg;
}

/** 顶栏 GitHub 按钮：新标签页打开，避免用户丢掉当前页面 */
function buildGithubLink(): HTMLAnchorElement {
	const link = el('a', {
		'class': 'icon-btn',
		'href': GITHUB_URL,
		'target': '_blank',
		'rel': 'noopener noreferrer',
		'title': t('githubLink'),
		'aria-label': t('githubLink'),
	});
	link.append(githubIcon());
	return link;
}

function buildHeader(): HTMLElement {
	const header = el('header', { class: 'topbar' });
	const inner = el('div', { class: 'container topbar-inner' });

	const brand = el('a', { class: 'brand', href: '/' }, [t('appName')]);
	const langSelect = el('select', { 'class': 'select lang-select', 'aria-label': t('language') });
	for (const meta of SUPPORTED_LANGS) {
		const option = el('option', { value: meta.code }, [meta.label]);
		option.selected = meta.code === getLang();
		langSelect.append(option);
	}
	langSelect.addEventListener('change', () => {
		void setLang(langSelect.value);
	});

	const themeBtn = el('button', { 'class': 'icon-btn', 'type': 'button', 'title': t('toggleTheme'), 'aria-label': t('toggleTheme') }, [
		themeIcon(currentTheme()),
	]);
	themeBtn.addEventListener('click', () => {
		const theme = toggleTheme();
		themeBtn.setAttribute('aria-label', theme === 'dark' ? t('themeToLight') : t('themeToDark'));
		themeBtn.textContent = themeIcon(theme);
	});

	const userArea = el('div', { class: 'user-area', id: 'user-area' });

	inner.append(brand, el('div', { class: 'topbar-actions' }, [langSelect, themeBtn, buildGithubLink(), userArea]));
	header.append(inner);
	return header;
}

function buildMain(): HTMLElement {
	const main = el('main', { class: 'container' });
	const heading = el('h1', { class: 'page-title' }, [t('appName')]);
	const tagline = el('p', { class: 'page-tagline' }, [t('tagline')]);
	const card = el('section', { class: 'card translator-card', id: 'translator' });
	main.append(heading, tagline, card);
	return main;
}

function buildFooter(): HTMLElement {
	const footer = el('footer', { class: 'container footer' });
	// footerNote 支持内嵌 Markdown 链接，如 "Built with ... by [XiaoXi](https://soraharu.com/)."
	footer.append(el('p', {}, textWithLinks(t('footerNote'))));
	return footer;
}

function registerServiceWorker(): void {
	if (!('serviceWorker' in navigator)) {
		return;
	}
	// module 异步主流程可能晚于 load 事件，因此直接注册（页面 DOM 已就绪）
	void navigator.serviceWorker.register('/sw.js').catch(() => {
		// SW 注册失败不阻塞页面
	});
}

/** 处理回调错误标记（?login=failed） */
function handleLoginFlag(): void {
	const params = new URLSearchParams(window.location.search);
	if (params.get('login') === 'failed') {
		toast(t('loginFailed'), 'error');
		window.history.replaceState({}, '', window.location.pathname);
	}
}

async function main(): Promise<void> {
	const root = document.getElementById(ROOT_ID);
	if (!root) {
		return;
	}

	await initI18n();
	initTheme();

	document.documentElement.lang = getLang();
	document.title = t('appName');

	root.append(buildHeader(), buildMain(), buildFooter());
	handleLoginFlag();

	// 小屏滚动时收起顶栏；页脚是普通文档流内容，不需要收起
	initScrollChrome({ top: document.querySelector<HTMLElement>('.topbar') });

	// 渲染用户区（登录/登出/用户名）
	const userArea = document.getElementById('user-area');
	if (userArea) {
		// 登录态变化（如会话过期自动登出）时刷新右上角用户区
		api.onAuthChange(status => renderAuth(userArea, status));
		try {
			const status = await api.loadAuthStatus();
			renderAuth(userArea, status);
		}
		catch {
			// 状态接口失败不影响翻译
		}
	}

	// 初始化翻译窗口
	const translator = document.getElementById('translator');
	if (translator) {
		try {
			await api.loadConfig();
			if (!api.getApiUrl()) {
				translator.innerHTML = '';
				translator.append(el('p', { class: 'config-error' }, [t('serverNotConfigured')]));
			}
			else {
				await initTranslate(translator);
			}
		}
		catch {
			translator.innerHTML = '';
			translator.append(el('p', { class: 'config-error' }, [t('initFailed')]));
		}
	}

	registerServiceWorker();
}

void main();
