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
  - No quota/usage management is implemented here; requests are simply proxied / passed through
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

- `GET /api/config` returns `{ apiUrl }` so the browser knows where to call directly when signed out.
- `POST /api/translate` / `POST /api/translate_file` transparently proxy the upstream response (same status code & JSON body). The built-in `api_key` is appended server-side only when the session user is valid and `LT_API_KEY` is configured.

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `LT_API_URL` | yes | — | Upstream LibreTranslate base URL, e.g. `https://translator.api.soraharu.com` |
| `LT_API_KEY` | no | — | Built-in API key injected by the proxy for signed-in users |
| `OIDC_ISSUER` | no* | — | OpenID Provider issuer URL (e.g. `https://sso.example.com/realms/master`) |
| `OIDC_CLIENT_ID` | no* | — | OIDC client id |
| `OIDC_CLIENT_SECRET` | no* | — | OIDC client secret |
| `OIDC_REDIRECT_URI` | no* | — | Callback URI, must exactly match the IdP redirect URI, e.g. `https://your.domain/api/auth/callback` |
| `OIDC_SCOPE` | no | `openid profile email` | Requested scope |
| `OIDC_USERNAME_CLAIM` | no | `preferred_username` | Claim used as the user name (use `name`/`sub` for IdPs without it) |
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
| `POST` | `/api/translate` | proxied text translation (injects `api_key` when signed in) |
| `POST` | `/api/translate_file` | proxied file translation |
| any other GET | `/` or static files | front-end page & assets |

## Add a language

1. Create `public/locales/<code>.json` modeled on `zh-Hans.json`.
2. Register the language code in `SUPPORTED_LANGS` inside `src/frontend/i18n.ts`.

UI strings and the API-provided language names then follow the selected language in the top-bar switcher.

## PWA notes

Service worker keeps a versioned app-shell cache and prefers the network (`no-cache` for html/js/css) with cache fallback — bump `CACHE_VERSION` in `public/sw.js` when the shell changes. PWA requires HTTPS (or `localhost`).

## Docker

```bash
docker build -t libretranslate-frontpage .
docker run -p 3001:3001 \
  -e LT_API_URL=https://translator.api.soraharu.com \
  -e SESSION_SECRET='...' \
  libretranslate-frontpage
```

The image runs `pnpm install --prod` and copies `dist/` (backend + `public/`).

## Scope & boundaries

- Only OIDC sign-in (no local accounts), no per-user API-key input, no quota management, no suggestion submissions.
- Avatars are not displayed.
- Sessions are stateless (restart invalidates them).
- File downloads use the `translatedFileUrl` returned by the upstream directly; if the upstream later enables `require_api_key_origin`, add a download proxy then.

See [PLAN.md](./PLAN.md) for the full design notes.
