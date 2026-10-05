# HAPI Chat for VS Code

A small, independent client for [HAPI](https://github.com/tiann/hapi). Open the **full HAPI website** in VS Code browser tabs, connect to several hubs, and work in parallel. A minimal custom chat panel is also available.

![Optional custom chat interface with illustrative messages](docs/images/hapi-chat.png)

## Install and connect

Install **3ndetz.hapi-chat** from [Open VSX](https://open-vsx.org/extension/3ndetz/hapi-chat), or download a `.vsix` from [GitHub Releases](https://github.com/3ndetz/hapi-vscode/releases) and run **Extensions: Install from VSIX…** in VS Code.

1. Click **HAPI Chat** in the activity bar, or run **HAPI: Add Connection**.
2. Enter a name, the hub URL and its **access token** (the token used to sign in to HAPI).
3. Expand a connection and select a session, or run **HAPI: Open Chat**.
4. The default **Web** mode opens that conversation on the HAPI website inside VS Code's integrated browser. Run **HAPI: New Chat** to open HAPI's own new-session form, with its full options. The agent uses the runner's account, native configuration and project files.

The website uses its own normal login and browser storage. Sign in once per hub in the integrated browser. To use a saved extension token, right-click that connection and choose **HAPI: Copy Login Token**, then paste it into **that hub's** login form. The clipboard clears after one minute if unchanged. Tokens are never added to navigation URLs or injected into pages. Login persistence follows VS Code's browser storage setting (`workbench.browser.dataStorage`).

Hub URLs may include a proxy prefix, for example `https://hapi.example.com/workflow/1/`. Use the actual hub address, not an HTML landing page listing several hubs. HTTP is supported for local/private networks; use HTTPS for remote connections. Tokens are entered separately and cannot be embedded in URLs.

## Parallel chats and multiple hubs

Add as many named connections as you need. Use **HAPI: Switch Connection** to select the default for new/open chat commands. The sidebar lists all saved connections, so you can also open chats or start sessions directly under a particular hub.

Switching the default hub does not redirect existing conversations. Open several sessions, then use VS Code's **Split Editor** or drag tabs into adjacent editor groups to see them side by side. Web mode opens independent browser tabs, including when you open the same conversation again. You can navigate them using HAPI's own interface.

VS Code manages web-tab restoration, and HAPI manages its website's drafts. Custom mode restores panel tabs and composer drafts through extension state. Closing a tab does not stop the agent.

## Choose the chat interface

Run **HAPI: Change Chat Mode**, or set **HAPI Chat: Chat Mode** in Settings:

* **`web` (default):** HAPI's actual website in the native integrated browser. Chat features, settings, terminal, uploads and other controls come directly from your hub. Browser features such as microphone and clipboard follow VS Code's normal site permissions. Requires a desktop VS Code build with **Browser: Open Integrated Browser**.
* **`custom`:** the extension's minimal REST + SSE chat panel shown above. Useful when you prefer a smaller interface or your editor has no integrated browser.

The setting affects newly opened chats. Existing web/custom tabs remain usable, so both interfaces can be open at the same time. **HAPI: Open Hub Website** always opens the full hub homepage.

## Included in custom mode

* Native HAPI token login and automatic JWT renewal.
* Multiple saved connections and concurrent chat tabs.
* Session list, message history with older-page loading, live SSE updates and reconnect/catch-up.
* New sessions on online HAPI runners, resume/reopen inactive sessions, stop a turn.
* Tool approval/denial, and answers to Codex `request_user_input` and Claude `AskUserQuestion` prompts.
* Plain text conversation, collapsible reasoning/tool details, and an **Open in browser** shortcut for the full HAPI interface.

The optional custom panel is a minimal client. Terminal, attachments, voice, model/permission-mode settings, rich Markdown/images, history fork/import and advanced queue controls use the full website in Web mode. Custom-mode new sessions inherit the runner's default agent settings; agent content is displayed as text.

Only sessions registered with HAPI are controllable here. This extension does not take ownership of sessions running in OpenAI's separate Codex extension. A saved/imported chat can still have an active native writer elsewhere; resume errors from that writer must be resolved through the native workflow, not by forcing a second writer.

## Credentials and compatibility

Extension access tokens use **VS Code SecretStorage**. Connection names/URLs use global extension storage. Extension credentials and JWTs stay in the extension host and are never sent to custom chat webviews or stored in settings, source files or exported tab state. Web mode loads your configured hub as a normal browser website, which owns its authentication and storage. **Copy Login Token** copies a key only when explicitly invoked. Custom chat/draft data is private to the editor, but VS Code restores drafts through webview state; do not use a shared OS account for private chats.

Editing a URL requires entering a token for the new endpoint and closes that connection's custom panels. Removing a connection deletes its SecretStorage token and closes its custom panels. Native browser tabs and website logins are managed by VS Code/HAPI independently; sign out of the site or clear its browser data to remove a website login. Existing tabs for other connections remain open. API requests refuse redirects to avoid forwarding credentials; enter the final hub URL directly. TLS certificates must be trusted. In SSH/remote workspaces the extension runs on the UI side, so the hub must be reachable from the VS Code client computer.

The session list and optional custom panel use the **native client REST + SSE API**, with no deployment-specific or internal `/cli` routes. Tested against HAPI **0.30.7**, client protocol **1**, including a hub behind a URL prefix. Other hubs implementing that contract can be used without server changes; unfamiliar agent events are tolerated, but future protocol changes may require a custom-client update. Web mode uses the hub's actual website and follows its features directly. Requires VS Code **1.100+** on desktop for custom mode, and a current desktop build with the integrated browser for Web mode; browser-only VS Code is not supported.

## Русский

Установка: скачайте VSIX из раздела Releases, затем в VS Code выберите **Extensions: Install from VSIX…**. В боковой панели HAPI добавьте подключение: название, полный адрес центра и его ключ. По умолчанию открывается сам сайт HAPI во встроенном браузере VS Code, со штатными функциями чата. На сайте нужен обычный вход ключом. Команда **HAPI: Copy Login Token** копирует сохранённый ключ выбранного центра для вставки в форму входа. Можно сохранить несколько центров и открыть несколько чатов во вкладках. **HAPI: New Chat** открывает штатную форму нового чата. Команда **HAPI: Change Chat Mode** переключает `Web` и прежний упрощённый интерфейс `Custom`. Переключение центра или режима не меняет уже открытые чаты.

## Development

```sh
npm ci
npm test
npm run lint
npm run test:host
npm run package
```

`test:host` runs an isolated VS Code extension host against two local mock hubs. It checks real integrated-browser navigation, default Web mode, multiple hubs, new-session navigation, explicit clipboard login and mixed Web/Custom tabs, as well as custom chat messaging, approvals and spawning. It does not use your saved connections or stop running agents. `VSCODE_EXECUTABLE_PATH` can point to an existing VS Code executable; otherwise the test runner downloads a stable VS Code build. All test editor data goes in the ignored `.local` directory.

To release, commit/push the source and package a VSIX. Publish the already built VSIX with `ovsx publish file.vsix`, supplying `OVSX_PAT` through a private environment. Never put publishing tokens in source, command arguments or logs. GitHub CI runs tests; publishing is intentionally a separate release action.

MIT licensed. Unaffiliated with the HAPI and VS Code projects. No upstream HAPI source is bundled.
