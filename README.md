# HAPI Chat for VS Code

A small, independent client for [HAPI](https://github.com/tiann/hapi). Open agent chats in VS Code editor tabs, connect to several hubs, and work in parallel.

![Chat interface with illustrative messages](docs/images/hapi-chat.png)

## Install and connect

Install **3ndetz.hapi-chat** from [Open VSX](https://open-vsx.org/extension/3ndetz/hapi-chat), or download a `.vsix` from [GitHub Releases](https://github.com/3ndetz/hapi-vscode/releases) and run **Extensions: Install from VSIX…** in VS Code.

1. Click **HAPI Chat** in the activity bar, or run **HAPI: Add Connection**.
2. Enter a name, the hub URL and its **access token** (the token used to sign in to HAPI).
3. Expand a connection and select a session, or run **HAPI: Open Chat**.
4. Run **HAPI: New Chat** to choose an online runner, agent and working directory **on that machine**. The agent uses the runner's account, native configuration and project files.

Hub URLs may include a proxy prefix, for example `https://hapi.example.com/workflow/1/`. Use the actual hub address, not an HTML landing page listing several hubs. HTTP is supported for local/private networks; use HTTPS for remote connections. Tokens are entered separately and cannot be embedded in URLs.

## Parallel chats and multiple hubs

Add as many named connections as you need. Use **HAPI: Switch Connection** to select the default for new/open chat commands. The sidebar lists all saved connections, so you can also open chats or start sessions directly under a particular hub.

Every open tab stays attached to its own **connection and session**. Switching the default hub does not redirect existing conversations. Open several sessions, then use VS Code's **Split Editor** or drag tabs into adjacent editor groups to see them side by side. Opening the same session again focuses its existing tab.

Tabs and composer drafts are restored after restarting VS Code. Closing a tab disconnects that view; it does not stop the agent. Use **Stop turn** to interrupt a working agent.

## Included

* Native HAPI token login and automatic JWT renewal.
* Multiple saved connections and concurrent chat tabs.
* Session list, message history with older-page loading, live SSE updates and reconnect/catch-up.
* New sessions on online HAPI runners, resume/reopen inactive sessions, stop a turn.
* Tool approval/denial, and answers to Codex `request_user_input` and Claude `AskUserQuestion` prompts.
* Plain text conversation, collapsible reasoning/tool details, and an **Open in browser** shortcut for the full HAPI interface.

This is a minimal client, not a reimplementation of every HAPI web feature. Terminal, attachments, voice, model/permission-mode settings, rich Markdown/images, history fork/import and advanced queue controls are available in the hub's browser UI. New sessions inherit the runner's default agent settings. Agent content is displayed as text, never executed as HTML.

Only sessions registered with HAPI are controllable here. This extension does not take ownership of sessions running in OpenAI's separate Codex extension. A saved/imported chat can still have an active native writer elsewhere; resume errors from that writer must be resolved through the native workflow, not by forcing a second writer.

## Credentials and compatibility

Access tokens use **VS Code SecretStorage**. Connection names/URLs use global extension storage. Credentials and JWTs stay in the extension host and are never sent to chat webviews or stored in settings, source files or exported tab state. Chat/draft data is private to the editor, but VS Code restores drafts through webview state; do not use a shared OS account for private chats.

Editing a URL requires entering a token for the new endpoint and closes that connection's tabs. Removing a connection deletes its token and closes its tabs. Existing tabs for other connections remain open. Requests refuse redirects to avoid forwarding credentials; enter the final hub URL directly. TLS certificates must be trusted by the extension host. In SSH/remote workspaces the extension runs on the UI side, so the hub must be reachable from the VS Code client computer.

Uses the **native client REST + SSE API**, with no SMA-specific or internal `/cli` routes. Tested against HAPI **0.30.7**, client protocol **1**, including a hub behind a URL prefix. Other hubs implementing that contract can be used without server changes; unfamiliar agent events are tolerated, but future protocol changes may require an extension update. Requires VS Code **1.100+** on desktop; browser-only VS Code is not supported.

## Русский

Установка: скачайте VSIX из раздела Releases, затем в VS Code выберите **Extensions: Install from VSIX…**. В боковой панели HAPI добавьте подключение: название, полный адрес центра и его ключ. Можно сохранить несколько центров и открыть несколько чатов во вкладках. Для нового чата выберите машину, агента и папку на этой машине. Переключение центра не меняет уже открытые чаты. Ключи хранятся в защищённом хранилище VS Code.

## Development

```sh
npm ci
npm test
npm run lint
npm run test:host
npm run package
```

`test:host` runs an isolated VS Code extension host against two local mock hubs. It does not use your saved connections or stop running agents. `VSCODE_EXECUTABLE_PATH` can point to an existing VS Code executable; otherwise the test runner downloads a stable VS Code build. All test editor data goes in the ignored `.local` directory.

To release, commit/push the source and package a VSIX. Publish the already built VSIX with `ovsx publish file.vsix`, supplying `OVSX_PAT` through a private environment. Never put publishing tokens in source, command arguments or logs. GitHub CI runs tests; publishing is intentionally a separate release action.

MIT licensed. Unaffiliated with the HAPI and VS Code projects. No upstream HAPI source is bundled.
