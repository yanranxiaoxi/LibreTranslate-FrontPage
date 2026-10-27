[English](#) | [简体中文](./README.zh-Hans.md)

# LibreTranslate FrontPage

> [!WARNING]
> This project was written through **Vibe Coding**. Although the code has been
> reviewed by humans, it cannot be guaranteed to be 100% controlled or
> bug-free. Use it at your own risk.

A complete front-end service for a [LibreTranslate](https://github.com/LibreTranslate/LibreTranslate) instance, built on the project's own Node.js + TypeScript framework. It ships a clean, responsive single-page translator (text & file), optional OpenID Connect sign-in, and PWA support.

## Features

- **Translator UI** — core interactions aligned with LibreTranslate's official front end:
  - Language list and per-source supported targets are fetched dynamically from the API (`?lang=` returns localized names), with auto-detection and source/target swapping
  - Automatic translation on input (500ms debounce), with character counter, copy/clear, and detected-language display
  - **Alternative translations**: requests include `alternatives: 3`; all variants are listed below the main output and can be adopted with a click
  - File translation tab (supported formats come from API settings, e.g. `.txt/.docx/.odt/.pptx/.srt`); the translated file downloads automatically
- **Smart request path**:
  - Not signed in → the browser calls the LibreTranslate API directly (anonymous, subject to its anonymous rate limits)
  - Signed in → requests go through this service's `/api/*` proxy, which injects the server-side `api_key` (higher, dedicated quota)
  - The proxy path is **signed-in only**; when the session expires the client falls back to the direct path
- **Higher input limit for signed-in users** — upstream `/frontend/settings` only exposes the global anonymous `charLimit` (e.g. 5000) and cannot report a key's quota. Set `LT_LOGIN_CHAR_LIMIT` to the built-in key's quota (e.g. `100000`); signed-in users then get the wider input box while anonymous users keep the upstream limit. The same limit is enforced server-side, so a hand-crafted request cannot bypass it.
- **OpenID Connect sign-in only** — standard authorization code flow + S256 PKCE (`openid-client` v6). Verified with Keycloak; other IdPs can be adapted via environment variables. Shows the signed-in user name (`preferred_username`); avatars are out of scope.
- **PWA** — `manifest.webmanifest` plus a service worker with versioned app-shell caching; the shell opens offline and, when the upstream is reachable, direct-to-API translation remains available
- **i18n** — Simplified Chinese & English built in; adding a language requires only a locale file plus one registration entry
- **Light / dark theme** — follows the system preference and can be toggled manually
- Responsive layout across desktop and mobile

## How requests flow

```
Browser ── not signed in ───────────────► {LT_API_URL}/translate        (direct, anonymous)
       │
       └── signed in ──► /api/translate ─► {LT_API_URL}/translate       (server injects LT_API_KEY)
```

- `GET /api/config` returns `{ apiUrl, loginCharLimit? }` so the browser knows where to call directly when signed out, and how wide the input box may be once signed in.
- `POST /api/translate` / `POST /api/translate_file` **require a session** and transparently proxy the upstream response (same status code & JSON body). The built-in `api_key` is appended server-side only when the session user is valid and `LT_API_KEY` is configured.
- The server also enforces `LT_LOGIN_CHAR_LIMIT`, the per-file `LT_PROXY_MAX_FILE_BYTES`, the per-user `LT_PROXY_RATE_LIMIT` and the global `LT_PROXY_CONCURRENCY`, so the proxy cannot be used as a free relay or a concurrency amplifier.

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `LT_API_URL` | yes | — | Upstream LibreTranslate base URL, e.g. `https://translator.api.soraharu.com` |
| `LT_API_KEY` | no | — | Built-in API key injected by the proxy for signed-in users |
| `LT_LOGIN_CHAR_LIMIT` | no | `0` | Character limit for signed-in users; should match the built-in key's upstream quota (e.g. `100000`). `0` = keep the upstream anonymous limit. Also enforced server-side |
| `LT_PROXY_RATE_LIMIT` | no | `120` | Proxy requests allowed per signed-in user per minute |
| `LT_PROXY_CONCURRENCY` | no | `32` | Maximum in-flight upstream proxy requests (per instance) |
| `LT_PROXY_MAX_FILE_BYTES` | no | `10485760` | Maximum size of a single uploaded file (10 MiB) |
| `OIDC_ISSUER` | no* | — | OpenID Provider issuer URL (e.g. `https://sso.example.com/realms/master`) |
| `OIDC_CLIENT_ID` | no* | — | OIDC client id |
| `OIDC_CLIENT_SECRET` | no* | — | OIDC client secret |
| `OIDC_REDIRECT_URI` | no* | — | Callback URI, must exactly match the IdP redirect URI, e.g. `https://your.domain/api/auth/callback` |
| `OIDC_SCOPE` | no | `openid profile email` | Requested scope |
| `OIDC_USERNAME_CLAIM` | no | `preferred_username` | Claim used as the user name (use `name`/`sub` for IdPs without it) |
| `OIDC_PROVIDER_NAME` | no | `Sign in with OpenID Connect` | SSO provider name shown on the login dialog button |
| `OIDC_ACCOUNT_URL` | no | — | SSO account centre URL; when set, the user name turns into a link to it (`http`/`https` only) |
| `OIDC_POST_LOGOUT_REDIRECT_URI` | no | site root of `OIDC_REDIRECT_URI` | Where the IdP returns after "also sign out of SSO"; register it at the IdP |
| `SESSION_SECRET` | no* | — | ≥32 random chars used to sign the session cookie |
| `SESSION_COOKIE_NAME` | no | `lt_session` | Session cookie name |
| `SESSION_TTL` | no | `604800` | Session lifetime in seconds |
| `STATIC_DIR` | no | auto | Static directory (auto resolves: `dist/public` in prod, `public` in dev) |

\* Login is disabled unless all OIDC fields **and** `SESSION_SECRET` are set — the sign-in button is then hidden.

Other inherited server variables: `SERVER_HOST`, `SERVER_PORT` (default 3001), `LOG_LEVEL`, `PROJECT_NAME`, `ENV_PRODUCT`.

## Quick start

```bash
pnpm install
pnpm build        # backend → dist/index.js (ESM) + frontend → dist/public/ (single build)
pnpm dev          # backend dev (tsx, serves ./public)
```

Run:

```bash
LT_API_URL=https://translator.api.soraharu.com \
SESSION_SECRET='...' \
node dist/index.js
```

Visit http://localhost:3001 once started. Only `LT_API_URL` is required for translation; the sign-in entry appears once OIDC is configured.

## OIDC: Keycloak example

1. In Keycloak create a client:
   - **Access Type / Client authentication**: `confidential`
   - **Standard flow**: enabled (Authorization Code + PKCE S256)
   - **Valid redirect URIs**: `https://your.domain/api/auth/callback`
2. Export/set env vars: `OIDC_ISSUER` (realm URL), `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, and a `SESSION_SECRET`.
3. Restart the service; the top-right area shows *Sign in* → Keycloak login → the user name (`preferred_username`) plus *Sign out*.

For other IdPs (Authentik, Google, GitLab OIDC, …) adjust `OIDC_ISSUER` and, if needed, `OIDC_USERNAME_CLAIM`.

## API endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/config` | `{ apiUrl }` (public) |
| `GET` | `/api/auth/status` | `{ loggedIn, authEnabled, user }` |
| `GET` | `/api/auth/login` | 302 → IdP |
| `GET` | `/api/auth/callback` | OIDC callback → session cookie → `/` |
| `GET` | `/api/auth/logout` | clears session → `/` |
| `POST` | `/api/translate` | session — proxied text translation (injects `api_key`) |
| `POST` | `/api/translate_file` | session — proxied file translation |
| any other GET | `/` or static files | front-end page & assets |

## Add a language

1. Create `public/locales/<code>.json` modeled on `zh-Hans.json`.
2. Register the language code in `SUPPORTED_LANGS` inside `src/frontend/i18n.ts`.

UI strings and the API-provided language names then follow the selected language in the top-bar switcher.

## PWA notes

Service worker keeps a versioned app-shell cache and prefers the network (`no-cache` for html/js/css) with cache fallback — bump `CACHE_VERSION` in `public/sw.js` when the shell changes. PWA requires HTTPS (or `localhost`).

## Docker

Published image: [`docker.io/yanranxiaoxi/libretranslate-frontpage`](https://hub.docker.com/r/yanranxiaoxi/libretranslate-frontpage) (`latest` follows the default branch).

```bash
docker run -d --name libretranslate-frontpage \
  -p 3001:3001 \
  -e LT_API_URL=https://translator.api.soraharu.com \
  -e SESSION_SECRET='...' \
  docker.io/yanranxiaoxi/libretranslate-frontpage:latest
```

To build locally instead, then run your own tag:

```bash
pnpm build
docker build -t libretranslate-frontpage .
docker run -d --name libretranslate-frontpage -p 3001:3001 \
  -e LT_API_URL=https://translator.api.soraharu.com \
  -e SESSION_SECRET='...' \
  libretranslate-frontpage
```

The image is also available from the GitLab registry as `registry.gitlab.soraharu.com/xiaoxi/libretranslate-frontpage:latest`. It runs `pnpm install --prod` and copies `dist/` (backend + `public/`).

## Scope & boundaries

- Only OIDC sign-in (no local accounts), no per-user API-key input, no quota management, no suggestion submissions.
- Avatars are not displayed.
- Sessions are stateless (restart invalidates them).
- File downloads use the `translatedFileUrl` returned by the upstream directly; if the upstream later enables `require_api_key_origin`, add a download proxy then.

See [PLAN.md](./PLAN.md) for the full design notes.
