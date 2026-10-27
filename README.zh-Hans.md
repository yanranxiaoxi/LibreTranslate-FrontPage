[English](./README.md) | [简体中文](#)

# LibreTranslate FrontPage

> [!WARNING]
> 本项目通过 **Vibe Coding** 方式编写。尽管代码经过人工 review，
> 但仍无法保证 100% 可控、零缺陷，请自行评估风险后使用。

基于项目自研的 Node.js + TypeScript 框架构建的 LibreTranslate 前端页面服务：一个干净、自适应、支持移动端的单页翻译器（文本 + 文件），可选 OpenID Connect 登录，支持 PWA。

## 功能

- **翻译窗口** — 核心交互对齐 LibreTranslate 官方前端：
  - 语言列表与各源语言可译目标均从 API 动态获取（`?lang=` 返回本地化语言名），支持自动检测与源/目标语言交换
  - 文本输入自动触发翻译（500ms 防抖），支持字符计数、复制/清空与检测语言展示
  - **多翻译版本**：翻译请求携带 `alternatives: 3`，主译文下方展示全部备选版本，点击即可采用为当前译文
  - 文件翻译标签页（支持格式由 API settings 返回，如 `.txt/.docx/.odt/.pptx/.srt` 等），完成后自动下载译文文件
- **智能请求路径**：
  - 未登录：浏览器直连 LibreTranslate API（匿名，受 API 侧匿名限流约束）
  - 已登录：请求经本服务 `/api/*` 代理转发并注入服务端 `api_key`（更稳定、限额更高）
  - 代理路径**仅登录用户可用**：会话失效时前端自动退回直连
- **登录用户更大的输入上限** — 上游 `/frontend/settings` 只返回全局匿名 `charLimit`（如 5000），无法获知 key 的配额。将 `LT_LOGIN_CHAR_LIMIT` 配置为内置 key 在上游的配额（如 `100000`）后，登录用户输入框即放宽至该值，未登录用户仍沿用上游限制。该上限同时由服务端强制校验，无法用自行构造的请求绕过。
- **仅 OpenID 登录** — 标准授权码流 + S256 PKCE（openid-client v6），至少实测支持 Keycloak；其它 IdP 可通过环境变量适配。展示登录用户名（`preferred_username`），头像暂不处理
- **PWA** — manifest 与 Service Worker 应用外壳缓存，支持离线打开外壳；上游服务可达时，离线状态亦可直连翻译
- **多语言** — 内置简体中文与英文；新增语言只需补充 locale 文件并完成注册
- **深浅主题** — 跟随系统偏好，支持手动切换
- 响应式布局，适配桌面端与移动端

## 请求路径

```
浏览器 ── 未登录 ────────────────► {LT_API_URL}/translate        直连（匿名）
       │
       └── 已登录 ──► /api/translate ─► {LT_API_URL}/translate  代理注入 LT_API_KEY
```

- `GET /api/config` 返回 `{ apiUrl, loginCharLimit? }`，供浏览器未登录时直连使用，并告知登录后输入框可放宽至的上限。
- `POST /api/translate` / `POST /api/translate_file` **要求登录**，透传上游响应（状态码与 JSON 原样返回）；内置 `api_key` 仅在会话有效且配置了 `LT_API_KEY` 时由服务端追加。
- 服务端同时强制 `LT_LOGIN_CHAR_LIMIT`、单文件 `LT_PROXY_MAX_FILE_BYTES`、每用户 `LT_PROXY_RATE_LIMIT` 与全局 `LT_PROXY_CONCURRENCY`，避免代理被当作免费中继或并发放大器。

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `LT_API_URL` | 是 | — | 上游 LibreTranslate 地址，如 `https://translator.api.soraharu.com` |
| `LT_API_KEY` | 否 | — | 内置 API key，登录用户经代理时注入 |
| `LT_LOGIN_CHAR_LIMIT` | 否 | `0` | 登录用户的字符上限，应与内置 key 在上游的配额一致（如 `100000`）；`0` = 沿用上游匿名限制。服务端同样按此校验 |
| `LT_PROXY_RATE_LIMIT` | 否 | `120` | 每个登录用户每分钟可发起的代理请求数 |
| `LT_PROXY_CONCURRENCY` | 否 | `32` | 同时进行的上游代理请求上限（单实例） |
| `LT_PROXY_MAX_FILE_BYTES` | 否 | `10485760` | 单个上传文件的字节上限（10 MiB） |
| `OIDC_ISSUER` | 否* | — | OpenID Provider 的 issuer 地址（如 Keycloak realm） |
| `OIDC_CLIENT_ID` | 否* | — | OIDC 客户端 ID |
| `OIDC_CLIENT_SECRET` | 否* | — | OIDC 客户端密钥 |
| `OIDC_REDIRECT_URI` | 否* | — | 回调地址，须与 IdP 注册的 Redirect URI 完全一致，如 `https://你的域名/api/auth/callback` |
| `OIDC_SCOPE` | 否 | `openid profile email` | 请求的 scope |
| `OIDC_USERNAME_CLAIM` | 否 | `preferred_username` | 取用户名的 claim（无此字段的 IdP 可改 `name`/`sub`） |
| `OIDC_PROVIDER_NAME` | 否 | `使用 OpenID Connect 登录` | SSO 提供商名称，显示在登录弹窗的按钮上 |
| `OIDC_ACCOUNT_URL` | 否 | — | SSO 用户中心地址；配置后用户名变为指向它的链接（只接受 `http`/`https`） |
| `OIDC_POST_LOGOUT_REDIRECT_URI` | 否 | `OIDC_REDIRECT_URI` 的站点根 | 「同时退出 SSO」时 IdP 回跳地址，需在 IdP 客户端登记 |
| `SESSION_SECRET` | 否* | — | 启用登录时必填，至少 32 字节；填了值就一定校验长度，不足则启动失败 |
| `SESSION_COOKIE_NAME` | 否 | `lt_session` | 会话 Cookie 名 |
| `SESSION_TTL` | 否 | `604800` | 会话有效期（秒） |
| `STATIC_DIR` | 否 | 自动 | 静态目录（生产自动解析 `dist/public`，开发 `public`） |

\* 只有全部 OIDC 字段与 `SESSION_SECRET` 都配置后登录才启用，否则右上角不显示登录入口。未启用登录时可以不填。

其余沿用框架变量：`SERVER_HOST`、`SERVER_PORT`（默认 3001）、`LOG_LEVEL`、`PROJECT_NAME`、`ENV_PRODUCT`。

## 快速开始

```bash
pnpm install
pnpm build        # 一次构建：后端 → dist/index.js（ESM）+ 前端 → dist/public/
pnpm dev          # 后端开发（tsx，静态目录 ./public）
```

运行：

```bash
LT_API_URL=https://translator.api.soraharu.com \
SESSION_SECRET='...' \
node dist/index.js
```

启动后访问 http://localhost:3001。仅配置 `LT_API_URL` 即可使用翻译功能；完成 OIDC 配置后页面将显示登录入口（此时还需要至少 32 字节的 `SESSION_SECRET`）。

## OIDC：Keycloak 对接示例

1. Keycloak 中新建客户端：
   - Client authentication：`confidential`
   - Standard flow：开启（授权码 + PKCE S256）
   - Valid redirect URIs：`https://你的域名/api/auth/callback`
2. 设置环境变量：`OIDC_ISSUER`（realm URL）、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`、`OIDC_REDIRECT_URI` 与 `SESSION_SECRET`。
3. 重启服务，右上角出现「登录」→ Keycloak 登录 → 显示用户名（`preferred_username`）与「退出登录」。

其它 IdP（Authentik、Google、GitLab OIDC 等）一般只需改 `OIDC_ISSUER`，必要时调整 `OIDC_USERNAME_CLAIM`。

## 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/config` | 返回 `{ apiUrl }`（公开） |
| `GET` | `/api/auth/status` | 返回 `{ loggedIn, authEnabled, user }` |
| `GET` | `/api/auth/login` | 302 跳转 IdP |
| `GET` | `/api/auth/callback` | OIDC 回调 → 写入会话 Cookie → `/` |
| `GET` | `/api/auth/logout` | 清除会话 → `/` |
| `POST` | `/api/translate` | 会话 | 文本翻译代理（注入 `api_key`） |
| `POST` | `/api/translate_file` | 会话 | 文件翻译代理 |
| 其余 GET | `/` 与静态资源 | 前端页面与资源 |

## 新增语言

1. 参照 `public/locales/zh-Hans.json` 新建 `public/locales/<code>.json`。
2. 在 `src/frontend/i18n.ts` 的 `SUPPORTED_LANGS` 中注册该语言码。

界面文案与 API 返回的语言名称将随所选语言即时联动。

## PWA 说明

Service Worker 采用版本化外壳缓存：同源 GET 网络优先（html/js/css 均 `no-cache`）+ 缓存兜底；改动外壳时请递增 `public/sw.js` 中的 `CACHE_VERSION`。PWA 需要 HTTPS（localhost 除外）。

## 安全响应头

所有响应都带严格 CSP：`script-src 'self'`、`style-src 'self'`，**不使用** `'unsafe-inline'`。因此前端改动有两条约束：

- 首屏主题脚本是独立文件 `public/theme-init.js`（在样式表之前的阻塞 `<script src>`），不再内联；
- 不允许内联 `style="…"` 属性与 `<style>` 元素，请改用 class。

`connect-src` 还包含 `LT_API_URL` 的 origin，因为未登录用户会直连上游。**有意不下发** `Strict-Transport-Security`：TLS 在反向代理终止，HSTS 应在那里配置。

## Docker

已发布镜像：[`docker.io/yanranxiaoxi/libretranslate-frontpage`](https://hub.docker.com/r/yanranxiaoxi/libretranslate-frontpage)（`latest` 跟随默认分支）。

```bash
docker run -d --name libretranslate-frontpage \
  -p 3001:3001 \
  -e LT_API_URL=https://translator.api.soraharu.com \
  -e SESSION_SECRET='...' \
  docker.io/yanranxiaoxi/libretranslate-frontpage:latest
```

如需本地构建，再运行自己打的标签：

```bash
pnpm build
docker build -t libretranslate-frontpage .
docker run -d --name libretranslate-frontpage -p 3001:3001 \
  -e LT_API_URL=https://translator.api.soraharu.com \
  -e SESSION_SECRET='...' \
  libretranslate-frontpage
```

镜像同时发布在 GitLab 私有仓库：`registry.gitlab.soraharu.com/xiaoxi/libretranslate-frontpage:latest`。镜像内会 `pnpm install --prod` 并复制 `dist/`（后端 + `public/`）。

## 范围与边界

- 仅 OIDC 登录（无本地账号）；不支持用户自带 API key 输入；不做限额管理与建议（suggestions）提交。
- 不展示头像。
- 会话无状态（服务重启即失效）。
- 文件下载直连上游返回的 `translatedFileUrl`；若未来上游开启 `require_api_key_origin`，再补充下载代理。

完整设计说明见 [PLAN.md](./PLAN.md)。
