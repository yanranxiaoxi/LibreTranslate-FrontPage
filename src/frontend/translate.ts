import type { FrontendSettings, LangOption, TranslateResult } from './types';
import * as api from './api';
import { getLang, t } from './i18n';
import { ApiError } from './types';
import { toast, triggerDownload } from './ui';

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
	state.settings = settings;
	state.langs = langs;

	// 默认语言：优先 settings 提供的默认值，通过 name 或 code 匹配语言列表
	const defaultSource = settings.language?.source?.code ?? 'auto';
	const targetPref = settings.language?.target;
	state.sourceLang = defaultSource || 'auto';
	state.targetLang = resolveDefaultTarget(targetPref?.code, targetPref?.name);

	const filesEnabled = settings.filesTranslation !== false;
	root.innerHTML = buildShell(filesEnabled, settings);
	buildLanguageRow();
	bindEvents(root, filesEnabled);

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
}

function buildShell(filesEnabled: boolean, settings: FrontendSettings): string {
	const fileTab = filesEnabled
		? `<button type="button" class="tab" id="tab-file" role="tab" aria-selected="false">${t('fileTab')}</button>`
		: '';
	const supported = settings.supportedFilesFormat ?? [];
	const fileHint = supported.length ? `${t('supportedFormats')}: ${supported.join(' ')}` : '';
	return `
	<div class="tabs" role="tablist" aria-label="${t('mode')}">
		<button type="button" class="tab active" id="tab-text" role="tab" aria-selected="true">${t('textTab')}</button>
		${fileTab}
	</div>
	<div class="lang-row">
		<div class="field">
			<label class="field-label" for="src-lang">${t('translateFrom')}</label>
			<select id="src-lang" class="select" aria-label="${t('translateFrom')}"></select>
		</div>
		<button type="button" class="swap-btn" id="swap-btn" title="${t('swap')}" aria-label="${t('swap')}">⇄</button>
		<div class="field">
			<label class="field-label" for="tgt-lang">${t('translateTo')}</label>
			<select id="tgt-lang" class="select" aria-label="${t('translateTo')}"></select>
		</div>
	</div>
	<div class="panel" id="panel-text" role="tabpanel">
		<div class="io-grid">
			<div class="io-box">
				<div class="io-top">
					<span class="detected" id="detected-lang"></span>
					<span class="spacer"></span>
					<span class="char-count" id="char-count"></span>
					<button type="button" class="btn ghost small" id="clear-btn">${t('clear')}</button>
				</div>
				<textarea id="input-text" class="io-textarea" placeholder="${t('inputPlaceholder')}" spellcheck="false"></textarea>
			</div>
			<div class="io-box">
				<div class="io-top">
					<span class="output-label" id="output-label"></span>
					<span class="spacer"></span>
					<button type="button" class="btn small" id="copy-btn">${t('copy')}</button>
				</div>
				<textarea id="output-text" class="io-textarea" readonly placeholder="${t('outputPlaceholder')}"></textarea>
				<div class="alts hidden" id="alts">
					<div class="alts-title">${t('moreTranslations')}</div>
					<div class="alts-list" id="alts-list"></div>
				</div>
			</div>
		</div>
		<div class="status-line" id="status-line"></div>
	</div>
	${filesEnabled
		? `<div class="panel hidden" id="panel-file" role="tabpanel">
			<div class="file-picker" id="file-picker">
				<input type="file" id="file-input" hidden />
				<div class="file-empty" id="file-empty">
					<div class="file-icon">📄</div>
					<div class="file-title">${t('chooseFile')}</div>
					<div class="file-hint" id="file-hint">${fileHint}</div>
				</div>
				<div class="file-meta hidden" id="file-meta">
					<span class="file-name" id="file-name"></span>
					<button type="button" class="btn ghost small" id="file-remove">${t('removeFile')}</button>
				</div>
			</div>
			<div class="file-actions">
				<button type="button" class="btn primary" id="file-go">${t('translateFile')}</button>
			</div>
			<div class="status-line" id="file-status-line"></div>
		</div>`
		: ''}`;
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
