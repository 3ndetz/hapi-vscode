# HAPI Chat for VS Code

A small, independent client for [HAPI](https://github.com/tiann/hapi). **Connections and folders live on the left. Full HAPI website chats open in the right sidebar and in independent windows beside each other.** Open several instances, select saved hub profiles and sign in automatically. Chats follow your editor's light/dark theme. Proxy use is configurable. Optional integrated-browser tabs and minimal custom chat panels remain available.

![Optional custom chat interface with illustrative messages](docs/images/hapi-chat.png)

## Install and connect

Install **3ndetz.hapi-chat** from [Open VSX](https://open-vsx.org/extension/3ndetz/hapi-chat), or download a `.vsix` from [GitHub Releases](https://github.com/3ndetz/hapi-vscode/releases) and run **Extensions: Install from VSIX…** in VS Code.

After installing an update, run **Developer: Reload Window** so that the current window loads the new sidebar contribution. If VS Code reports that the HAPI sidebar is unavailable, reload the window and open the chat again. Reloading keeps saved profiles and tokens.

1. Click **HAPI Connections** in the left activity bar, or run **HAPI: Add Connection**. Add/edit/remove profiles here; the folder list uses the whole left container.
2. Enter a name, the hub URL and its **access token** (the token used to sign in to HAPI).
3. In **Connections and Folders**, expand a hub, then a working folder and select a session. **HAPI: Show Chat List** focuses this list; **HAPI: Open Chat** searches sessions by title and directory.
4. Default **Web** mode opens that conversation in **HAPI Chats** on the right, with the site's own chat interface. **HAPI: Show Right Chat Panel** reveals it. The site uses all the height below two compact header rows. Select the saved profile in **Hub** and an open conversation in **Chat**. Run **HAPI: New Chat** to open HAPI's native form; the folder's **+** shortcut preselects its directory. The runner's native account, configuration and project files apply.

**Sidebar login is automatic from the saved profile.** Hub keys stay in SecretStorage and the extension host. A private loopback adapter loads the hub's actual website and translates its temporary local login capability into normal hub authentication. Each connection has its own local origin. The hub key never appears in website URLs or sidebar messages; navigation state saves only profile/session metadata. HTTP, streaming and WebSocket requests use the native hub unchanged.

Integrated-browser mode uses its own normal website login. **HAPI: Copy Login Token** explicitly copies a saved key for that hub's login form; clipboard clears after one minute if unchanged. Browser login persistence follows `workbench.browser.dataStorage`. The optional browser mode never puts hub keys into URLs.

Hub URLs may include a proxy prefix, for example `https://hapi.example.com/workflow/1/`. Use the actual hub address, not an HTML landing page listing several hubs. HTTP is supported for local/private networks; use HTTPS for remote connections. Tokens are entered separately and cannot be embedded in URLs.

## Parallel chats and multiple hubs

Add as many named connections as you need. Use **HAPI: Switch Connection** to select the default for new/open chat commands. The sidebar lists all saved connections, so you can also open chats or start sessions directly under a particular hub.

Profile edits are serialized so rapid saves cannot overwrite another connection. Each extension host keeps its acknowledged profile list; reload another main VS Code window to load profiles edited elsewhere. Auxiliary chat windows share the original host and update immediately.

The left sidebar lists sessions as **hub → working folder → chats**, keeping folders on different runner machines separate. The independent right chat header shows the current saved profile. Opening another profile preserves other chats; the **Chat** selector switches conversations and selects that chat's profile. Each open website stays loaded independently; **×** closes the selected website without stopping its agent. **↻** reloads only that website if it needs a fresh sign-in. Switching between the left configuration and an editor does not hide the right chat. Both containers can still be moved using VS Code's normal view controls.

Sidebar navigation is restored from extension state. Its adapter reuses a saved local port when available, so HAPI can retain website preferences and drafts for that origin; if the port is occupied, a new local origin is used. Integrated-browser and Custom modes still support editor tabs and **Split Editor**. VS Code manages integrated-browser restoration; Custom restores panel tabs and composer drafts.

## Choose the chat interface

Run **HAPI: Change Chat Mode**, or set **HAPI Chat: Chat Mode** in Settings:

* **`web` (default):** the hub's actual website in the sidebar, with automatic login from saved profiles. Chat features, settings, terminal and uploads come from your hub. Browser features such as microphone/clipboard still depend on browser permissions.
* **`custom`:** the extension's minimal REST + SSE chat panel shown above. Useful when you prefer a smaller interface or your editor has no integrated browser.

The setting affects newly opened chats. Existing web/custom views remain usable. **HAPI Chat: Web Location** selects `sidebar` (default) or `browser` editor tabs. **HAPI: Open Hub Website** opens the selected homepage in the sidebar; **HAPI: Open in Integrated Browser** is available if a hub's security policy blocks embedding.

**HAPI Chat: Sync Editor Theme** defaults to enabled. Dark and dark high-contrast editors pass a dark browser scheme; light editors pass light. Existing sidebar websites update without reloading or losing drafts. HAPI's **Settings → Display → Appearance mode** should be **System** (its default). Choosing a fixed Light/Dark/OLED mode on the site intentionally overrides the browser scheme. Color palettes stay under HAPI's own settings.

## Included in custom mode

* Native HAPI token login and automatic JWT renewal.
* Multiple saved connections and concurrent chat tabs.
* Session list, message history with older-page loading, live SSE updates and reconnect/catch-up.
* New sessions on online HAPI runners, resume/reopen inactive sessions, stop a turn.
* Tool approval/denial, and answers to Codex `request_user_input` and Claude `AskUserQuestion` prompts.
* Plain text conversation, collapsible reasoning/tool details, and an **Open in browser** shortcut for the full HAPI interface.

The optional custom panel is a minimal client. Terminal, attachments, voice, model/permission-mode settings, rich Markdown/images, history fork/import and advanced queue controls use the full website in Web mode. Custom-mode new sessions inherit the runner's default agent settings; agent content is displayed as text.

Only sessions registered with HAPI are controllable here. This extension does not take ownership of sessions running in OpenAI's separate Codex extension. A saved/imported chat can still have an active native writer elsewhere; resume errors from that writer must be resolved through the native workflow, not by forcing a second writer.

## Multiple chat windows

Keep connections and folders on the left and the primary website chat on the right. For several chats visible at once, use **HAPI: Open Chat Beside**, the **◫** button above the website, or the split icon next to a session in the folder tree. Every invocation creates a separate native VS Code webview panel, including when the same conversation is already open. Panels appear in adjacent full-height editor groups, alongside the right sidebar. Drag their tabs between groups and resize columns using VS Code's normal controls.

**HAPI: New Chat Window** or the second **＋** button opens a fresh HAPI new-session form in its own column. A folder's context menu carries its directory into that form. This is HAPI's real website, with the same native features and runner-side project rules. Each window has its own saved-profile selector and stays on its own hub when another window changes profile. Keys are read from SecretStorage automatically. Closing a window closes its website only; it does not stop an agent. **↗** in a chat window moves that panel into a separate native VS Code window. The sidebar's upper **↗** still opens the independent integrated browser.

Panels restore their safe navigation metadata after a VS Code reload. A small adapter bridge observes the website's current session path so that opening beside, reloading and restoring follow chats created or selected inside the native website. It never reports tokens or conversation text. If a hub's own content-security policy blocks the bridge, use the session tree to open the desired chat; native website framing/security policies are respected.

## Proxy settings

**HAPI Chat: Use VS Code Proxy** (`hapiChat.useVSCodeProxy`) is **enabled by default**. Extension API calls and embedded website traffic, including assets, uploads, SSE and WebSockets, use `http.proxy` (HTTP/HTTPS), `http.proxySupport`, `http.noProxy`, `http.proxyAuthorization` and `http.proxyStrictSSL`. When `http.proxy` is empty, HTTP(S) environment proxy variables are used. Loopback and matching exclusions always connect directly. Automatic operating-system/PAC proxy discovery and SOCKS proxies are not supported by this transport; configure an HTTP(S) proxy explicitly.

Disable the setting for direct HAPI connections even if VS Code or the environment specifies a proxy:

```json
"hapiChat.useVSCodeProxy": false
```

The setting affects subsequent extension requests without an editor restart. Already established streams/sockets retain their route until reconnect; **↻** reconnects the embedded website. It does not change global VS Code settings, other extensions, the runner's network or optional external integrated-browser traffic. TLS verification stays enabled unless your explicit `http.proxyStrictSSL` setting disables it. System trust certificates are included when the Node runtime supports them and `http.systemCertificates` is enabled.

## Credentials and compatibility

Hub access keys use **VS Code SecretStorage**. Profile names/URLs and navigation metadata use global extension storage. Keys are never stored in settings, source files or tab state and never sent to sidebar/custom chat scripts. The sidebar's loopback adapter listens only on `127.0.0.1`, rejects mismatched Host/cross-origin login and scopes a random capability to one profile. Only its native authentication endpoint translates that capability to the real key. Native JWTs are returned to HAPI's actual website, as in normal browser login. Custom JWTs remain in the extension host. **Copy Login Token** copies a key only when invoked. Do not use a shared OS account for private chats.

Editing a URL requires a new token and closes that profile's sidebar websites and custom panels. Removing a profile deletes its SecretStorage key and stops its loopback adapter. Other profiles remain usable. External integrated-browser tabs/logins are managed by VS Code/HAPI independently. API authentication refuses redirects; enter the final hub URL directly. TLS certificates must be trusted. In SSH/remote workspaces the extension and adapter run on the UI side, so the hub must be reachable from the client computer. Hub framing/CSP policies remain in force; use integrated-browser mode if your hub refuses embedded pages.

The session list and custom panel use the **native REST + SSE API**, with no internal `/cli` routes. Tested against HAPI **0.30.7**, client protocol **1**, including a prefix proxy. Sidebar auto-login uses the native website token-login flow and requires no hub changes; native website assets/API must be served under the configured hub prefix. Future protocol or frontend changes can require an adapter update. Requires desktop VS Code **1.106+**, which supports native secondary-sidebar containers; optional integrated-browser mode needs a build with that feature. Browser-only VS Code is not supported.

## Русский

Установка: скачайте VSIX из Releases, затем выберите **Extensions: Install from VSIX…** и перезагрузите окно VS Code. В **HAPI Connections** слева настройте профили и выберите чат в списке папок. Сам чат откроется отдельно в **HAPI Chats** справа, на всю высоту панели. Ключ хранится в SecretStorage, вход автоматический. В шапке **Hub** выбирается сохранённый профиль, **Chat** переключает открытые чаты. Кнопка **×** закрывает выбранный сайт без остановки агента, **↻** перезагружает его. Команда **HAPI: Show Right Chat Panel** показывает правую панель. Нужен VS Code 1.106 или новее.

Чтобы видеть несколько чатов одновременно, нажмите **◫** над чатом или выполните **HAPI: Open Chat Beside**. Каждый клик открывает отдельную область рядом, даже для того же чата. **HAPI: New Chat Window** открывает форму нового чата в своей области. У каждой области своя шапка Hub с сохранёнными профилями и автовходом. Вкладки можно перетаскивать и расставлять как на примере с Codex. Кнопка **↗** в окне чата переносит его в отдельное окно VS Code.

В настройках **HAPI Chat: Use VS Code Proxy** по умолчанию включено использование HTTP(S) прокси VS Code. Выключите настройку, чтобы расширение подключалось напрямую. Она действует на список, вход и встроенный сайт, включая поток сообщений и WebSocket. Уже открытый сайт переподключается кнопкой **↻**. Глобальные настройки VS Code и других расширений не меняются.

Список ниже сгруппирован как **центр → рабочая папка → чаты**. **HAPI: Show Chat List** открывает список. Кнопка **+** у папки открывает новый чат с этой рабочей папкой. Настройка **HAPI Chat: Sync Editor Theme** включена по умолчанию: сайт подхватывает светлую или тёмную тему VS Code. В самом HAPI оставьте **Settings → Display → Appearance mode → System**, чтобы ручной выбор темы не перекрывал синхронизацию.

**HAPI: Change Chat Mode** переключает `Web` и прежний `Custom`. **HAPI Chat: Web Location → browser** возвращает открытие в обычных вкладках браузера VS Code. У такого браузера отдельный вход на сайт; для него доступна команда **HAPI: Copy Login Token**. Уже открытые чаты других профилей не перенаправляются.

## Development

```sh
npm ci
npm test
npm run lint
npm run test:host
npm run package
```

`test:host` runs an isolated VS Code extension host against two local mock hubs. It checks the real sidebar, grouped folders, profile authentication, independent websites, new-session navigation and mixed Web/Custom views, as well as custom messaging, approvals and spawning. It does not use your saved connections or stop running agents. `VSCODE_EXECUTABLE_PATH` can point to an existing VS Code executable; otherwise the runner downloads a stable build. Test editor data goes in the ignored `.local` directory.

To release, commit/push the source and package a VSIX. Publish the already built VSIX with `ovsx publish file.vsix`, supplying `OVSX_PAT` through a private environment. Never put publishing tokens in source, command arguments or logs. GitHub CI runs tests; publishing is intentionally a separate release action.

MIT licensed. Unaffiliated with the HAPI and VS Code projects. No upstream HAPI source is bundled.
