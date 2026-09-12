import type { Theme } from './theme';
import * as api from './api';
import { renderAuth } from './auth';
import { getLang, initI18n, setLang, SUPPORTED_LANGS, t } from './i18n';
import { initTheme, toggleTheme } from './theme';
import { initTranslate } from './translate';
import { el, textWithLinks, toast } from './ui';

const ROOT_ID = 'app';

/** 已应用到 `<html>` 的主题 */
function currentTheme(): Theme {
	return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** 主题按钮图标：深色主题下显示 ☀（点击切回浅色），浅色主题下显示 ☾ */
function themeIcon(theme: Theme): string {
	return theme === 'dark' ? '☀' : '☾';
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

	inner.append(brand, el('div', { class: 'topbar-actions' }, [langSelect, themeBtn, userArea]));
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
