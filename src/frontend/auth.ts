import type { AuthStatus } from './types';
import { t } from './i18n';

/**
 * 渲染右上角用户区（登录按钮 / 用户名 + 登出）
 */
export function renderAuth(container: HTMLElement, status: AuthStatus): void {
	container.replaceChildren();

	if (!status.authEnabled) {
		// 服务端未配置 OIDC，不显示登录入口
		return;
	}

	if (status.loggedIn && status.user) {
		const chip = document.createElement('span');
		chip.className = 'user-chip';
		chip.textContent = status.user.username;

		const logout = document.createElement('a');
		logout.className = 'btn ghost';
		logout.href = '/api/auth/logout';
		logout.textContent = t('logout');

		container.append(chip, logout);
	}
	else {
		const login = document.createElement('a');
		login.className = 'btn primary';
		login.href = '/api/auth/login';
		login.textContent = t('login');
		container.append(login);
	}
}
