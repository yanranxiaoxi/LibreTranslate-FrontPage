import type { AuthStatus } from './types';
import { t } from './i18n';
import { el } from './ui';

/** 当前打开的登录弹窗（同时只允许一个） */
let activeModal: HTMLElement | null = null;
/** 关闭动画结束后移除遮罩的定时器 */
let closeTimer: number | undefined;
/** 弹窗打开前的焦点元素，关闭后归还焦点 */
let restoreFocus: HTMLElement | null = null;

/** 关闭动画时长（毫秒），需与 style.css 的 .modal-closing 动画时长一致 */
const MODAL_CLOSE_MS = 160;

/**
 * 关闭动画进行中，忽略重复的关闭请求
 */
function isClosing(overlay: HTMLElement): boolean {
	return overlay.classList.contains('modal-closing');
}

function onKeyDown(event: KeyboardEvent): void {
	if (event.key === 'Escape') {
		closeLoginModal();
	}
}

/** 页面发生滚动时关闭弹窗（覆盖触屏、键盘、滚动条拖动等所有滚动方式） */
function onPageScroll(): void {
	closeLoginModal();
}

/**
 * 关闭登录弹窗（未打开时为空操作）。
 * 遮罩与提示框先播放淡出动画，动画结束后再移除节点。
 * @param restore - 是否把焦点归还给触发按钮（重渲染时该按钮已被移除，无需归还）
 */
function closeLoginModal(restore = true): void {
	const overlay = activeModal;
	if (!overlay || isClosing(overlay)) {
		return;
	}
	document.removeEventListener('keydown', onKeyDown);
	window.removeEventListener('scroll', onPageScroll);

	// 标记为关闭中：忽略后续关闭请求，并让遮罩不再拦截点击
	overlay.classList.add('modal-closing');

	const finish = () => {
		window.clearTimeout(closeTimer);
		closeTimer = undefined;
		overlay.remove();
		if (activeModal === overlay) {
			activeModal = null;
		}
		if (restore) {
			restoreFocus?.focus();
		}
		restoreFocus = null;
	};

	// 以 animationend 为准，超时兜底（动画被禁用/元素已脱离文档时事件可能不触发）
	overlay.addEventListener('animationend', (event) => {
		if (event.target === overlay) {
			finish();
		}
	});
	closeTimer = window.setTimeout(finish, MODAL_CLOSE_MS + 60);
}

/**
 * 打开登录弹窗：半透明遮罩 + 居中提示框，框内为 SSO 提供商登录按钮。
 * 点击遮罩（提示框外部）、滚动或按 Esc 均关闭。
 *
 * 弹窗打开时不锁定页面滚动（避免滚动条消失引起的布局闪烁），
 * 而是让遮罩上的滚动事件穿透到底层页面，同时关闭弹窗。
 */
function openLoginModal(trigger: HTMLElement, providerName: string): void {
	if (activeModal) {
		return;
	}
	restoreFocus = trigger;

	const overlay = el('div', { 'class': 'modal-overlay', 'role': 'dialog', 'aria-modal': 'true' });
	// 仅当点击发生在遮罩本身（而非提示框内部）时关闭
	overlay.addEventListener('click', (event) => {
		if (event.target === overlay) {
			closeLoginModal();
		}
	});
	// 遮罩覆盖全屏，滚轮/触屏滚动默认会落在遮罩上而不会滚动页面；
	// 这里主动把滚动量转交给底层页面，并关闭弹窗。
	overlay.addEventListener('wheel', (event) => {
		event.preventDefault();
		closeLoginModal();
		window.scrollBy({ top: event.deltaY, left: event.deltaX, behavior: 'instant' });
	}, { passive: false });
	// 触屏滑动同样穿透到底层页面（不拦截默认行为，交给浏览器原生滚动）
	overlay.addEventListener('touchmove', () => {
		closeLoginModal();
	}, { passive: true });

	const ssoButton = el('button', { class: 'btn primary modal-action', type: 'button' }, [providerName]);
	ssoButton.addEventListener('click', () => {
		window.location.href = '/api/auth/login';
	});

	overlay.append(el('div', { class: 'modal-dialog' }, [ssoButton]));
	document.body.append(overlay);

	activeModal = overlay;
	document.addEventListener('keydown', onKeyDown);
	// 键盘 PageDown/空格、拖动滚动条等引起的滚动也关闭弹窗
	window.addEventListener('scroll', onPageScroll, { passive: true });
	ssoButton.focus();
}

/**
 * 渲染右上角用户区（登录按钮 / 用户名 + 登出）
 */
export function renderAuth(container: HTMLElement, status: AuthStatus): void {
	// 已登录或服务端未启用登录时，关闭可能残留的登录弹窗
	if (status.loggedIn || !status.authEnabled) {
		closeLoginModal(false);
	}

	container.replaceChildren();

	if (!status.authEnabled) {
		// 服务端未配置 OIDC，不显示登录入口
		return;
	}

	if (status.loggedIn && status.user) {
		const chip = el('span', { class: 'user-chip' }, [status.user.username]);

		const logout = el('a', { class: 'btn ghost', href: '/api/auth/logout' }, [t('logout')]);

		container.append(chip, logout);
	}
	else {
		// 提供商名称由服务端 OIDC_PROVIDER_NAME 下发，未配置时用本地化默认文案
		const providerName = status.providerName || t('ssoLogin');
		const login = el('button', { class: 'btn primary', type: 'button' }, [t('login')]);
		login.addEventListener('click', () => openLoginModal(login, providerName));
		container.append(login);
	}
}
