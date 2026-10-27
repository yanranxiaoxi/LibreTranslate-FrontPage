import type { FrontendSettings, LangOption, TranslateResult } from './types';
import * as api from './api';
import { getLang, t } from './i18n';
import { ApiError } from './types';
import { el, toast, triggerDownload } from './ui';

interface TranslateState {
	langs: LangOption[];
	settings: FrontendSettings | null;
	sourceLang: string;
	targetLang: string;
	alternatives: string[];
	selectedFile: File | null;
}

const state: TranslateState = {
	langs: [],
	settings: null,
	sourceLang: 'auto',
	targetLang: '',
	alternatives: [],
	selectedFile: null,
};

let debounceTimer: number | undefined;
let abortCtrl: AbortController | null = null;
let copyResetTimer: number | undefined;

/** 输入/输出框高度的 localStorage 键 */
const TEXTAREA_HEIGHT_KEY = 'lt-textarea-height';
/** 输入/输出框默认高度与上下限（px） */
const TEXTAREA_DEFAULT_HEIGHT = 190;
const TEXTAREA_MIN_HEIGHT = 120;
const TEXTAREA_MAX_HEIGHT = 640;

function qs<T extends HTMLElement>(selector: string, root: ParentNode = document): T {
	const node = root.querySelector<T>(selector);
	if (!node) {
		throw new Error(`Element not found: ${selector}`);
	}
	return node;
}

function qsOrNull<T extends HTMLElement>(selector: string, root: ParentNode = document): T | null {
	return root.querySelector<T>(selector);
}

/** 安全读取 localStorage（隐私模式/沙箱下可能抛错，一律吞掉） */
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

/** 读取已保存的输入/输出框高度（非法值回退默认） */
function loadTextareaHeight(): number {
	const raw = Number(storageGet(TEXTAREA_HEIGHT_KEY));
	if (!Number.isFinite(raw) || raw <= 0) {
		return TEXTAREA_DEFAULT_HEIGHT;
	}
	return Math.min(Math.max(raw, TEXTAREA_MIN_HEIGHT), TEXTAREA_MAX_HEIGHT);
}

/**
 * 让输入框与输出框的右下角把手可拖拽调整高度，并保持两列底部对齐。
 *
 * 布局规则：【输入框高度】=【输出框高度】+【更多翻译版本高度】。
 * 即译文框可能比输入框矮，但左右两列的底边始终齐平，整体更整齐。
 *
 * 原生 resize 依赖写入内联 height，但 textarea 若带 flex 尺寸，flex-basis 会
 * 覆盖该 height（把手因此拖不动）；CSS 已改为 flex: none + 固定 height。
 * 这里用 ResizeObserver 由被拖动的一侧反推译文框基准高度，再同步另一侧并持久化。
 */
function initTextareaResize(root: HTMLElement): void {
	const input = qsOrNull<HTMLTextAreaElement>('#input-text', root);
	const output = qsOrNull<HTMLTextAreaElement>('#output-text', root);
	const alts = qsOrNull<HTMLElement>('#alts', root);
	if (!input || !output) {
		return;
	}

	/** 译文框高度（不含多版本译文区），输入框高度在其基础上叠加多版本区 */
	let baseHeight = loadTextareaHeight();

	const altHeight = () => (alts && !alts.classList.contains('hidden') ? alts.offsetHeight : 0);
	/** 双列布局才需要叠加多版本区高度以对齐底部；单列时两框等高更整齐 */
	const stacksAlts = () => !window.matchMedia('(max-width: 720px)').matches;
	/** 输入框相对译文框的额外高度 */
	const extraHeight = () => (stacksAlts() ? altHeight() : 0);

	/**
	 * 同步两侧的上下限。
	 *
	 * 输入框的 min/max-height 必须一并叠加 extraHeight：原生 resize 只遵守元素的
	 * min/max-height，若只限制基准高度，用户能把输入框一路拖到低于最小高度。
	 */
	const applyLimits = () => {
		const extra = extraHeight();
		input.style.minHeight = `${TEXTAREA_MIN_HEIGHT + extra}px`;
		input.style.maxHeight = `${TEXTAREA_MAX_HEIGHT + extra}px`;
		output.style.minHeight = `${TEXTAREA_MIN_HEIGHT}px`;
		output.style.maxHeight = `${TEXTAREA_MAX_HEIGHT}px`;
	};

	/** 按 baseHeight 重写两侧高度（初始化 / 多版本区变化 / 断点切换时使用） */
	const applyAll = () => {
		applyLimits();
		output.style.height = `${baseHeight}px`;
		input.style.height = `${baseHeight + extraHeight()}px`;
	};
	applyAll();

	// 断点切换（双列 ↔ 单列）时重算输入框高度
	window.matchMedia('(max-width: 720px)').addEventListener('change', applyAll);

	const clampBase = (value: number) =>
		Math.min(Math.max(Math.round(value), TEXTAREA_MIN_HEIGHT), TEXTAREA_MAX_HEIGHT);

	const observer = new ResizeObserver((entries) => {
		for (const entry of entries) {
			const target = entry.target as HTMLElement;
			if (target === alts) {
				// 多版本译文区显示/隐藏/内容变化：重新叠加输入框高度
				applyAll();
				continue;
			}
			// 用 border-box 高度：contentRect 不含 padding，会把高度误判为最小值
			const height = entry.borderBoxSize?.[0]?.blockSize ?? target.offsetHeight;
			if (!height) {
				continue;
			}
			// 由被拖动的一侧反推基准高度（输入框需先减去叠加部分）
			const next = clampBase(target === input ? height - extraHeight() : height);
			if (next === baseHeight) {
				continue;
			}
			baseHeight = next;
			/*
			 * 只写另一侧：被拖动的一侧由浏览器原生 resize 掌控，回写它的 height
			 * 会与拖拽争抢，快速拖动时导致把手越界。
			 */
			if (target === input) {
				output.style.height = `${baseHeight}px`;
			}
			else {
				input.style.height = `${baseHeight + extraHeight()}px`;
			}
			storageSet(TEXTAREA_HEIGHT_KEY, String(baseHeight));
		}
	});
	observer.observe(input);
	observer.observe(output);
	if (alts) {
		observer.observe(alts);
	}
}

/**
 * 初始化翻译窗口（先拉取设置与语言，再构建 UI 并绑定事件）
 * @param root - 翻译卡片挂载元素
 */
export async function initTranslate(root: HTMLElement): Promise<void> {
	// 并行拉取设置与语言列表（语言名随当前界面语言本地化）
	const [settings, langs] = await Promise.all([
		api.getSettings(),
		api.getLanguages(getLang()),
	]);

	// 登录用户走本服务代理（注入内置 api_key），其字符上限由内置 key 的配额决定，
	// 上游 /frontend/settings 只会返回全局匿名值（如 5000），无法感知登录态；
	// 服务端若配置了 LT_LOGIN_CHAR_LIMIT（与内置 key 配额一致），登录时用它覆盖 UI 限制。
	const loginLimit = api.isLoggedIn() ? api.getLoginCharLimit() : undefined;
	if (loginLimit && loginLimit > 0) {
		settings.charLimit = loginLimit;
	}

	state.settings = settings;
	state.langs = langs;

	// 默认语言：优先 settings 提供的默认值，通过 name 或 code 匹配语言列表
	const defaultSource = settings.language?.source?.code ?? 'auto';
	const targetPref = settings.language?.target;
	state.sourceLang = defaultSource || 'auto';
	state.targetLang = resolveDefaultTarget(targetPref?.code, targetPref?.name);

	const filesEnabled = settings.filesTranslation !== false;
	root.replaceChildren(buildShell(filesEnabled, settings));
	buildLanguageRow();
	bindEvents(root, filesEnabled);
	initTextareaResize(root);

	const fileInput = qs<HTMLInputElement>('#file-input', root);
	const supported = settings.supportedFilesFormat ?? [];
	if (supported.length) {
		fileInput.accept = supported.join(',');
	}
	const inputText = qs<HTMLTextAreaElement>('#input-text', root);
	if (settings.charLimit > 0) {
		inputText.maxLength = settings.charLimit;
	}
	updateCharCount();
	focusInputOnLoad(inputText);
}

/**
 * 页面加载后把焦点放到输入框，方便直接开始输入。
 *
 * 仅桌面端生效：触屏设备自动聚焦会立刻弹起软键盘并顶起页面，体验反而更差。
 * 若用户已把焦点移到别处（如浏览器自动恢复的表单焦点）则不抢占。
 */
function focusInputOnLoad(input: HTMLTextAreaElement): void {
	if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
		return;
	}
	const active = document.activeElement;
	if (active && active !== document.body) {
		return;
	}
	// preventScroll：刷新时浏览器会恢复滚动位置，聚焦不应把页面拽回顶部
	input.focus({ preventScroll: true });
	// 浏览器可能恢复了上次的输入内容，光标置于末尾便于继续输入
	const end = input.value.length;
	input.setSelectionRange(end, end);
}

/**
 * 构建翻译界面骨架
 *
 * 用 DOM 构造而不是 HTML 字符串模板：`supportedFilesFormat` 来自上游
 * `/frontend/settings`，属于外部数据；拼进模板就会成为注入点（CSP 只是
 * 兜底，不应依赖它）。所有文案与外部值都经 textContent 写入。
 */
function buildShell(filesEnabled: boolean, settings: FrontendSettings): DocumentFragment {
	const frag = document.createDocumentFragment();

	const tabs = el('div', { 'class': 'tabs', 'role': 'tablist', 'aria-label': t('mode') });
	tabs.append(
		el('button', { 'type': 'button', 'class': 'tab active', 'id': 'tab-text', 'role': 'tab', 'aria-selected': 'true' }, [t('textTab')]),
	);
	if (filesEnabled) {
		tabs.append(
			el('button', { 'type': 'button', 'class': 'tab', 'id': 'tab-file', 'role': 'tab', 'aria-selected': 'false' }, [t('fileTab')]),
		);
	}

	const srcField = el('div', { class: 'field' });
	srcField.append(
		el('label', { class: 'field-label', for: 'src-lang' }, [t('translateFrom')]),
		el('select', { 'id': 'src-lang', 'class': 'select', 'aria-label': t('translateFrom') }),
	);

	const tgtField = el('div', { class: 'field' });
	tgtField.append(
		el('label', { class: 'field-label', for: 'tgt-lang' }, [t('translateTo')]),
		el('select', { 'id': 'tgt-lang', 'class': 'select', 'aria-label': t('translateTo') }),
	);

	const langRow = el('div', { class: 'lang-row' });
	langRow.append(
		srcField,
		el('button', { 'type': 'button', 'class': 'swap-btn', 'id': 'swap-btn', 'title': t('swap'), 'aria-label': t('swap') }, ['⇄']),
		tgtField,
	);

	const inputTop = el('div', { class: 'io-top' });
	inputTop.append(
		el('span', { class: 'detected', id: 'detected-lang' }),
		el('span', { class: 'spacer' }),
		el('span', { class: 'char-count', id: 'char-count' }),
		el('button', { type: 'button', class: 'btn ghost small', id: 'clear-btn' }, [t('clear')]),
	);

	const inputBox = el('div', { class: 'io-box' });
	inputBox.append(
		inputTop,
		el('textarea', { id: 'input-text', class: 'io-textarea', placeholder: t('inputPlaceholder'), spellcheck: 'false' }),
	);

	const outputTop = el('div', { class: 'io-top' });
	outputTop.append(
		el('span', { class: 'output-label', id: 'output-label' }),
		el('span', { class: 'spacer' }),
		el('button', { type: 'button', class: 'btn small', id: 'copy-btn' }, [t('copy')]),
	);

	const alts = el('div', { class: 'alts hidden', id: 'alts' });
	alts.append(
		el('div', { class: 'alts-title' }, [t('moreTranslations')]),
		el('div', { class: 'alts-list', id: 'alts-list' }),
	);

	const outputBox = el('div', { class: 'io-box' });
	outputBox.append(
		outputTop,
		el('textarea', { id: 'output-text', class: 'io-textarea', readonly: '', placeholder: t('outputPlaceholder') }),
		alts,
	);

	const ioGrid = el('div', { class: 'io-grid' });
	ioGrid.append(inputBox, outputBox);

	const textPanel = el('div', { class: 'panel', id: 'panel-text', role: 'tabpanel' });
	textPanel.append(ioGrid, el('div', { class: 'status-line', id: 'status-line' }));

	frag.append(tabs, langRow, textPanel);

	if (filesEnabled) {
		const supported = settings.supportedFilesFormat ?? [];
		const fileHint = supported.length ? `${t('supportedFormats')}: ${supported.join(' ')}` : '';

		const empty = el('div', { class: 'file-empty', id: 'file-empty' });
		empty.append(
			el('div', { class: 'file-icon' }, ['📄']),
			el('div', { class: 'file-title' }, [t('chooseFile')]),
			el('div', { class: 'file-hint', id: 'file-hint' }, [fileHint]),
		);

		const meta = el('div', { class: 'file-meta hidden', id: 'file-meta' });
		meta.append(
			el('span', { class: 'file-name', id: 'file-name' }),
			el('button', { type: 'button', class: 'btn ghost small', id: 'file-remove' }, [t('removeFile')]),
		);

		const picker = el('div', { class: 'file-picker', id: 'file-picker' });
		picker.append(
			el('input', { type: 'file', id: 'file-input', hidden: '' }),
			empty,
			meta,
		);

		const actions = el('div', { class: 'file-actions' });
		actions.append(el('button', { type: 'button', class: 'btn primary', id: 'file-go' }, [t('translateFile')]));

		const filePanel = el('div', { class: 'panel hidden', id: 'panel-file', role: 'tabpanel' });
		filePanel.append(picker, actions, el('div', { class: 'status-line', id: 'file-status-line' }));

		frag.append(filePanel);
	}

	return frag;
}

function resolveDefaultTarget(code?: string, name?: string): string {
	const langs = state.langs;
	if (!langs.length) {
		return code || 'en';
	}
	// 1) 语言名精确匹配（settings 的名字随后端语言，与 ?lang= 返回一致）
	if (name) {
		const byName = langs.find(l => l.name === name);
		if (byName) {
			return byName.code;
		}
	}
	// 2) code 直接命中（如 en / zh-Hans）
	if (code && langs.some(l => l.code === code)) {
		return code;
	}
	// 3) 兜底英文或首个语言
	if (langs.some(l => l.code === 'en')) {
		return 'en';
	}
	return langs[0].code;
}

/** 目标语言候选：源语言为 auto 时全部，否则按其 targets 过滤 */
function allowedTargets(): string[] {
	const { langs, sourceLang } = state;
	if (sourceLang === 'auto') {
		return langs.map(l => l.code);
	}
	const src = langs.find(l => l.code === sourceLang);
	if (src?.targets?.length) {
		return src.targets;
	}
	return langs.map(l => l.code);
}

/** 某语言可翻译到的目标（交换校验用） */
function targetsOf(code: string): string[] {
	const lang = state.langs.find(l => l.code === code);
	if (!lang?.targets?.length) {
		return state.langs.map(l => l.code);
	}
	return lang.targets;
}

function langName(code: string): string {
	if (code === 'auto') {
		return t('autoDetect');
	}
	return state.langs.find(l => l.code === code)?.name ?? code;
}

function buildLanguageRow(): void {
	const src = qs<HTMLSelectElement>('#src-lang');
	const tgt = qs<HTMLSelectElement>('#tgt-lang');

	// 源语言：auto 置顶 + 全部语言按名称排序
	const sourceOptions = [
		{ code: 'auto', name: t('autoDetect') },
		...[...state.langs].sort((a, b) => a.name.localeCompare(b.name)),
	];
	src.replaceChildren(...sourceOptions.map((opt) => {
		const node = document.createElement('option');
		node.value = opt.code;
		node.textContent = opt.name;
		return node;
	}));
	src.value = state.sourceLang;

	renderTargetOptions();
	tgt.value = state.targetLang;

	qs('#output-label').textContent = state.targetLang ? langName(state.targetLang) : '';
}

function renderTargetOptions(): void {
	const tgt = qs<HTMLSelectElement>('#tgt-lang');
	tgt.replaceChildren(...allowedTargets().map((code) => {
		const node = document.createElement('option');
		node.value = code;
		node.textContent = langName(code);
		return node;
	}));
}

function bindEvents(root: HTMLElement, filesEnabled: boolean): void {
	qs<HTMLSelectElement>('#src-lang', root).addEventListener('change', (e) => {
		state.sourceLang = (e.target as HTMLSelectElement).value;
		renderTargetOptions();
		state.targetLang = qs<HTMLSelectElement>('#tgt-lang', root).value;
		qs('#output-label', root).textContent = langName(state.targetLang);
		if (qs<HTMLTextAreaElement>('#input-text', root).value.trim()) {
			scheduleTranslate();
		}
	});

	qs<HTMLSelectElement>('#tgt-lang', root).addEventListener('change', (e) => {
		state.targetLang = (e.target as HTMLSelectElement).value;
		qs('#output-label', root).textContent = langName(state.targetLang);
		if (qs<HTMLTextAreaElement>('#input-text', root).value.trim()) {
			scheduleTranslate();
		}
	});

	qs('#swap-btn', root).addEventListener('click', () => {
		const src = state.sourceLang;
		const tgt = state.targetLang;
		if (src === 'auto' || src === tgt || !targetsOf(tgt).includes(src)) {
			toast(t('cannotSwap'));
			return;
		}
		state.sourceLang = tgt;
		state.targetLang = src;
		qs<HTMLSelectElement>('#src-lang', root).value = state.sourceLang;
		renderTargetOptions();
		qs<HTMLSelectElement>('#tgt-lang', root).value = state.targetLang;
		qs('#output-label', root).textContent = langName(state.targetLang);

		// 交换输入输出文本
		const input = qs<HTMLTextAreaElement>('#input-text', root);
		const output = qs<HTMLTextAreaElement>('#output-text', root);
		const temp = output.value;
		output.value = input.value;
		input.value = temp;
		state.alternatives = [];
		renderAlternatives(root);
		updateCharCount();
		if (input.value.trim()) {
			scheduleTranslate();
		}
	});

	const input = qs<HTMLTextAreaElement>('#input-text', root);
	input.addEventListener('input', () => {
		updateCharCount();
		scheduleTranslate();
	});

	qs('#clear-btn', root).addEventListener('click', () => {
		input.value = '';
		qs<HTMLTextAreaElement>('#output-text', root).value = '';
		qs('#detected-lang', root).textContent = '';
		state.alternatives = [];
		renderAlternatives(root);
		setStatus(root, '');
		updateCharCount();
		input.focus();
	});

	qs('#copy-btn', root).addEventListener('click', async () => {
		const output = qs<HTMLTextAreaElement>('#output-text', root);
		if (!output.value) {
			return;
		}
		const btn = qs<HTMLButtonElement>('#copy-btn', root);
		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(output.value);
			}
			else {
				output.select();
				document.execCommand('copy');
			}
			btn.textContent = t('copied');
			window.clearTimeout(copyResetTimer);
			copyResetTimer = window.setTimeout(() => {
				btn.textContent = t('copy');
			}, 1500);
		}
		catch {
			toast(t('copyFailed'), 'error');
		}
	});

	// Tab 切换
	const tabText = qs('#tab-text', root);
	const tabFile = qsOrNull<HTMLElement>('#tab-file', root);
	const panelText = qs('#panel-text', root);
	const panelFile = qsOrNull<HTMLElement>('#panel-file', root);

	const switchTab = (tab: 'text' | 'file') => {
		const isText = tab === 'text';
		tabText.classList.toggle('active', isText);
		tabFile?.classList.toggle('active', !isText);
		panelText.classList.toggle('hidden', !isText);
		panelFile?.classList.toggle('hidden', isText);
	};
	tabText.addEventListener('click', () => switchTab('text'));
	tabFile?.addEventListener('click', () => switchTab('file'));

	// 文件翻译
	if (!filesEnabled) {
		return;
	}
	const fileInput = qs<HTMLInputElement>('#file-input', root);
	const picker = qs<HTMLElement>('#file-picker', root);
	const fileEmpty = qs<HTMLElement>('#file-empty', root);
	const fileMeta = qs<HTMLElement>('#file-meta', root);
	const fileName = qs<HTMLElement>('#file-name', root);

	picker.addEventListener('click', (e) => {
		if ((e.target as HTMLElement).closest('#file-remove')) {
			return;
		}
		fileInput.click();
	});
	fileInput.addEventListener('change', () => {
		const file = fileInput.files?.[0] ?? null;
		state.selectedFile = file;
		if (file) {
			fileEmpty.classList.add('hidden');
			fileMeta.classList.remove('hidden');
			fileName.textContent = file.name;
		}
	});
	qs('#file-remove', root).addEventListener('click', (e) => {
		e.stopPropagation();
		fileInput.value = '';
		state.selectedFile = null;
		fileEmpty.classList.remove('hidden');
		fileMeta.classList.add('hidden');
	});
	qs('#file-go', root).addEventListener('click', () => {
		void translateSelectedFile(root);
	});
}

function scheduleTranslate(): void {
	const timeout = state.settings?.frontendTimeout ?? 500;
	window.clearTimeout(debounceTimer);
	debounceTimer = window.setTimeout(() => {
		void translateNow();
	}, Math.max(200, timeout));
}

function updateCharCount(): void {
	const count = qs('#char-count');
	const limit = state.settings?.charLimit ?? -1;
	const length = qs<HTMLTextAreaElement>('#input-text').value.length;
	if (!limit || limit < 0) {
		count.classList.add('hidden');
		return;
	}
	count.classList.remove('hidden');
	count.textContent = `${length} / ${limit}`;
	count.classList.toggle('over', length > limit);
}

async function translateNow(): Promise<void> {
	const input = qs<HTMLTextAreaElement>('#input-text');
	const output = qs<HTMLTextAreaElement>('#output-text');
	const q = input.value;
	if (!q.trim()) {
		output.value = '';
		qs('#detected-lang').textContent = '';
		state.alternatives = [];
		renderAlternatives();
		setStatus(null, '');
		return;
	}

	abortCtrl?.abort();
	abortCtrl = new AbortController();
	setStatus(null, t('translating'));

	try {
		const res = await api.translateText(
			{
				q,
				source: state.sourceLang,
				target: state.targetLang,
				format: 'text',
				alternatives: 3,
			},
			abortCtrl.signal,
		);
		setStatus(null, '');
		applyResult(res);
	}
	catch (err) {
		if ((err as Error).name === 'AbortError') {
			return;
		}
		output.value = '';
		if (err instanceof ApiError) {
			setStatus(null, `${t('translationError')}: ${err.message}`);
		}
		else {
			setStatus(null, t('networkError'));
		}
	}
}

function applyResult(res: TranslateResult): void {
	const root = qs('#panel-text').parentElement as HTMLElement;
	const output = qs<HTMLTextAreaElement>('#output-text', root);
	output.value = res.translatedText ?? '';
	state.alternatives = res.alternatives ?? [];
	renderAlternatives(root);

	// 自动检测语言展示
	const detected = qs('#detected-lang', root);
	if (state.sourceLang === 'auto' && res.detectedLanguage) {
		const name = langName(res.detectedLanguage.language);
		const confidence = res.detectedLanguage.confidence;
		detected.textContent = `${t('detected')} ${name}${confidence !== undefined ? ` (${Math.round(confidence)}%)` : ''}`;
	}
	else {
		detected.textContent = '';
	}
}

function renderAlternatives(root: ParentNode = document): void {
	const box = qs<HTMLElement>('#alts', root);
	const list = qs<HTMLElement>('#alts-list', root);
	if (!state.alternatives.length) {
		box.classList.add('hidden');
		list.replaceChildren();
		return;
	}
	box.classList.remove('hidden');
	list.replaceChildren(...state.alternatives.map((alt) => {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'alt-item';
		btn.textContent = alt;
		btn.title = alt;
		btn.addEventListener('click', () => {
			qs<HTMLTextAreaElement>('#output-text', root).value = alt;
			for (const node of list.children) {
				node.classList.remove('active');
			}
			btn.classList.add('active');
		});
		return btn;
	}));
}

function setStatus(root: HTMLElement | null, text: string): void {
	if (root) {
		qs('#status-line', root).textContent = text;
	}
	else {
		const line = qsOrNull<HTMLElement>('#status-line');
		if (line) {
			line.textContent = text;
		}
	}
}

async function translateSelectedFile(root: HTMLElement): Promise<void> {
	const file = state.selectedFile;
	if (!file) {
		toast(t('noFileSelected'), 'error');
		return;
	}
	const btn = qs<HTMLButtonElement>('#file-go', root);
	const statusLine = qs<HTMLElement>('#file-status-line', root);
	btn.disabled = true;
	statusLine.textContent = t('translatingFile');
	try {
		const res = await api.translateFile(file, state.sourceLang, state.targetLang);
		statusLine.textContent = t('fileTranslated');
		toast(t('fileTranslated'), 'success');
		triggerDownload(res.translatedFileUrl);
	}
	catch (err) {
		statusLine.textContent = '';
		if (err instanceof ApiError) {
			toast(`${t('translationError')}: ${err.message}`, 'error');
		}
		else {
			toast(t('networkError'), 'error');
		}
	}
	finally {
		btn.disabled = false;
	}
}
