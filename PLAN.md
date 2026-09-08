# PLAN — LibreTranslate 前端 + OpenID 登录服务

## 目标

在现有 Venation（自研 Node.js HTTP 框架，TypeScript + ESM + esbuild + pnpm）仓库上，构建一个完整的 LibreTranslate 前端页面服务：

- 配置对接 LibreTranslate API 地址 + 内置 token（`api_key`）
- 未登录用户：前端直连 LibreTranslate API（匿名，受 API 侧匿名限流）
- 登录用户：前端走本服务 `/api/*` 代理，代理注入内置 `api_key`（更稳定、限额更高）
- 本服务不做任何限额/配额管理，仅将请求正确代理 / 不代理直连到 API
- 仅 OpenID 登录（标准授权码流 + S256 PKCE），至少支持 Keycloak，环境变量可配置以适配其它 IdP；显示登录用户名（`preferred_username`），头像暂不处理
- 主页：翻译窗口（文本 + 文件两个标签页，交互照抄 LibreTranslate 原版；可翻译语言从 API 动态获取；支持多翻译版本 alternatives 展示与采用）+ 右上角登录/登出/用户信息
- 页面干净整洁、响应式，支持移动端
- PWA（manifest + Service Worker）
- 多语言：中英双语，后续可便捷扩展
- 前端：原生 TypeScript + esbuild，无框架；**非前后端分离**，一次构建产出后端入口与前端静态资源，整体部署

## 关键约束（用户明确要求）

1. **不要修改框架的构建模式**：保持 ESM，不改成 CJS。
2. **不需要前后端分离**：前端需求简单（主要一个页面），`pnpm build` 一次性构建后端（`dist/index.js`）+ 前端静态资源（`dist/public/`），整体部署。
3. 当前仓库中 `src/frontend/`、`src/service/` 等目录为空，`public/assets/main.js`、`dist/*.cjs` 均为残留幽灵产物，实现时清理由构建流程产出覆盖。

## 已确认决策

- OpenID：标准授权码流 + S256 PKCE，至少支持 Keycloak；完全可配置 `issuer / client_id / client_secret / redirect_uri / scope` + 用户名 claim（默认 `preferred_username`，可配置），头像暂不处理
- 多翻译版本：翻译请求携带 `alternatives: 3`，前端展示主译文 + 备选版本，点击备选版本可替换主译文
- 前端：原生 TS + esbuild，无框架，`src/frontend/main.ts` → `public/assets/main.js`（dev 直接服务 `public/`，build 时复制到 `dist/public/`）
- 翻译窗口：文本 + 文件翻译两个标签页（照抄原版交互）
- 未登录：前端直连 API URL；登录：走本服务代理（API 地址通过 `GET /api/config` 暴露给前端）
- 会话：无状态签名 Cookie（jose `SignJWT` + HMAC），无 DB
- `/api/*` 返回原生 JSON（不用 `{success, code, result}` 信封，因为代理必须透传 LibreTranslate 原生响应）
- 目标 API 未开启 `require_api_key_origin`，故文件下载直接用 API 返回的 `translatedFileUrl`

## 目标 API 契约（LibreTranslate v1.9.6，已对 translator.api.soraharu.com 实测）

- `GET /languages` → `[{code, name, targets[]}]`，支持 `?lang=` 返回本地化语言名
- `GET /frontend/settings` → `{charLimit, frontendTimeout, apiKeys, keyRequired, suggestions, filesTranslation, supportedFilesFormat[], language:{source,target}}`
- `POST /translate` body `{q, source, target, format, alternatives, api_key}` → `{translatedText, alternatives?, detectedLanguage?}`
- `POST /translate_file` multipart(`file, source, target, api_key`) → `{translatedFileUrl}`
- 错误统一 `{"error": string}`；HTTP 400/403/429/500
- `api_key` 放在请求体字段（非 Authorization 头）
- 各端点已带 CORS `Access-Control-Allow-Origin: *`，未登录直连可行
- 语言码注意 ISO 别名：`zh-Hans`/`zh-Hant`/`pt-BR` 为对外码

## 实施步骤

### 阶段 1：依赖与配置
1. 新增依赖：`openid-client`、`jose`（会话 JWT 签名）
2. `src/config/config.ts` 新增环境变量：
   - `LT_API_URL`（必填，如 `https://translator.api.soraharu.com`）、`LT_API_KEY`（可选，登录代理注入用）
   - `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI` / `OIDC_SCOPE`（默认 `openid profile email`）/ `OIDC_USERNAME_CLAIM`（默认 `preferred_username`）
   - `SESSION_SECRET`（必填）、`SESSION_COOKIE_NAME`（默认 `lt_session`）、`SESSION_TTL`（默认 7 天）
   - 静态目录：运行入口 `import.meta.url` 同级的 `public/`（构建产物 `dist/public`），开发时回退到项目根 `public/`，可用 `STATIC_DIR` 覆盖

### 阶段 2：后端基础设施
3. `src/utils/cookie.ts` — Cookie 解析/序列化（手写，无依赖）
4. `src/utils/session.ts` — 用 jose 签发/校验会话 JWT（claims: `sub/username/exp`）
5. `src/utils/mime.ts` — 静态文件 MIME 映射
6. `src/controller/frontend.controller.ts` — 静态文件服务 + `GET /`（返回 `index.html`），正确 Content-Type；`sw.js` 与 `index.html` 使用 `no-cache`

### 阶段 3：OpenID 认证
7. `src/service/oidc.ts` — openid-client v6：`Issuer.discover`、`generators`（state/nonce/codeVerifier，S256 challenge）、`authorizationUrl`、`callback`（code grant + PKCE 校验）、`userinfo` 取用户名
8. `src/middleware/session.middleware.ts` — 解析会话 Cookie → `ctx.user`
9. `src/controller/auth.controller.ts`：
   - `GET /api/auth/status` → `{loggedIn, authEnabled, user:{username} | null}`
   - `GET /api/auth/login` → 302 到 IdP（state/nonce/code_verifier 存短期签名 Cookie）
   - `GET /api/auth/callback` → 校验 state/nonce，换 token，取 userinfo，写会话 Cookie，302 到 `/`
   - `GET /api/auth/logout` → 清 Cookie，302 到 `/`

### 阶段 4：代理层
10. `src/controller/proxy.controller.ts`（不使用 api() 信封中间件，透传原生响应）：
    - `POST /api/translate` → 读取 JSON body，登录用户 + 已配置 `LT_API_KEY` 时注入 `api_key`，`fetch` 转发到 `LT_API_URL/translate`，透传状态码 + JSON body
    - `POST /api/translate_file` → formidable 解析 multipart，重建 FormData 转发到 `LT_API_URL/translate_file`（注入 `api_key` 逻辑同上），透传 JSON（`translatedFileUrl` 原样返回，前端 `<a download>` 直接下载）
    - `GET /api/config` → `{apiUrl}`（公开，未登录直连需用）

### 阶段 5：前端（原生 TS + esbuild）
11. `public/` 静态目录：`index.html`、`css/style.css`、`manifest.webmanifest`、`sw.js`、`icons/icon-192.png`、`icons/icon-512.png`、`icons/maskable-512.png`、`favicon.svg`、`locales/en.json`、`locales/zh-Hans.json`
12. `src/frontend/`：
    - `types.ts` — 类型定义
    - `api.ts` — 直连/代理决策：`GET /api/config` 拿 apiUrl，`GET /api/auth/status` 拿登录态；未登录直连 `{apiUrl}/languages|frontend/settings|translate|translate_file`；登录走 `/api/translate|translate_file`
    - `i18n.ts` — 运行时加载 `/locales/{lang}.json`，`t(key)`，语言切换，默认 `navigator.language`；语言列表内置，扩展 = 增加 JSON 与语言元数据
    - `theme.ts` — 深色/浅色切换（`prefers-color-scheme` + `localStorage`）
    - `auth.ts` — 登录/登出按钮 + 用户名渲染（无头像）
    - `translate.ts` — 翻译窗口：语言下拉（auto 仅源语言、目标按 `source.targets` 过滤、交换）、500ms 防抖、字符计数（`charLimit` 为 -1 时不显示）、复制/清空、`detectedLanguage` 显示、多版本译文展示（主译文 + alternatives，点击采用替换主译文）、文件翻译标签
    - `main.ts` — 入口：初始化、注册 SW、渲染

### 阶段 6：构建、部署与文档
13. 构建：`config/esbuild.prod.ts` 一次构建（**ESM** 后端 → `dist/index.js`，浏览器前端 → `public/assets/main.js`，再复制 `public/*` → `dist/public/`）；`config/esbuild.common.ts` 显式 `format: 'esm'`
14. `package.json` scripts：`dev`（后端 tsx）、`build`（rimraf + 一次构建）、`fix`/`lint` 保留
15. `Dockerfile`：COPY 整个 `dist/`（含 `public/`），入口不变
16. `.env.example`、`README.md` / `README.zh-Hans.md`：环境变量说明 + Keycloak 对接示例
17. `PLAN.md`（本文件）固化在项目根目录

## 关键文件

- `PLAN.md` — 根目录
- `src/config/config.ts` — 新增 LT/OIDC/Session 配置
- `src/utils/cookie.ts`、`session.ts`、`mime.ts` — 新增
- `src/service/oidc.ts` — 新增
- `src/controller/frontend.controller.ts`、`auth.controller.ts`、`proxy.controller.ts` — 新增
- `src/middleware/session.middleware.ts` — 新增
- `src/router/index.ts` — 重写：移除对不存在 `./test` 的引用，注册静态、auth、proxy 路由
- `src/frontend/*.ts` — 新增
- `public/*` — 新增（清理幽灵 `public/assets/main.js`）
- `config/esbuild.common.ts`、`esbuild.prod.ts` — 调整（ESM + 前端产物 + 静态复制）
- `package.json`、`Dockerfile`、`.env.example`、`README*` — 修改

## 验证

1. `pnpm build` 成功，`dist/` 含 `index.js`（ESM）与 `public/`（`index.html`、`assets/main.js`、`manifest.webmanifest`、`sw.js`、`icons/`、`locales/`）
2. 启动后 `curl /` 返回 `index.html`；`curl /api/config` 返回 `{apiUrl}`；`curl /assets/main.js` 200
3. 未登录直连 `{apiUrl}/translate` 成功返回 `translatedText` 与 `alternatives`（受 API 匿名限流约束）
4. 完成 OIDC 登录（Keycloak 标准流 + S256 PKCE）后 `/api/auth/status` 返回 `loggedIn: true` 与用户名（`preferred_username`）
5. 翻译响应展示主译文 + 备选版本，点击备选版本可替换主译文
6. 登录后 `POST /api/translate` 返回 `translatedText`，代理正确注入 `api_key`（与未登录直连对照）
7. 文件翻译上传 `.txt` 返回 `translatedFileUrl` 可下载
8. PWA：DevTools 校验 Manifest 有效、Service Worker 注册成功、可离线打开壳
9. 移动端响应式：375px 宽度下翻译窗口与登录按钮正常
10. 中英切换：UI 文案与语言下拉名称同步变化

## 决策与范围边界

- 不实现本地用户名密码；仅 OIDC
- 不实现限额/配额管理；仅代理透传
- 不做 per-user 自带 API key 输入（原版 `setApiKey` 功能，范围外）
- 不做 suggestions 建议翻译（目标 API 未开启）
- 头像显示暂不做（仅用户名）
- 文件下载走 API 返回的 `translatedFileUrl` 直连；若未来 API 开启 `require_api_key_origin` 再补下载代理
- 会话无状态（重启失效），单实例假设

## 进一步考虑

1. OIDC 用户名 claim：默认 `preferred_username`（Keycloak 原生自带）；其它 IdP 无该字段时通过 `OIDC_USERNAME_CLAIM` 改为 `name`/`sub` 兜底
2. 部署需 HTTPS（Service Worker 要求），否则仅 localhost 可用 PWA
3. `alternatives` 数量：LibreTranslate 默认 `alternatives_limit=3`，请求固定 `alternatives: 3`；若部署上限不同则响应数组可能少于 3，前端按实际返回渲染即可
