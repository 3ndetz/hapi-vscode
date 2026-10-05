# HAPI Chat

This is a standalone, universal VS Code client for HAPI. Keep corporate infrastructure,
tokens, chat transcripts and private test configuration out of this public repository.

Keep connection configuration and folder navigation in the primary sidebar, and
default to the full HAPI website in a separate secondary sidebar webview. The chat
must use its container's full height rather than sharing height with the folder list.
Keep the minimal native
REST and SSE client as an optional custom mode. Do not depend on CLI-plane or
deployment-specific routes. Extension credentials belong in VS Code SecretStorage,
never custom webviews, configuration or navigation URLs. The website owns its login.
Each chat must remain pinned to its connection when the selected connection changes.
For sidebar auto-login, proxy the native site over loopback and translate a random,
connection-scoped capability to the real key only in the extension host. Never forward
that capability upstream, expose the hub key to the sidebar or persist capability URLs.

Run `npm test` and `npm run lint` before committing code. Package with `npm run package`.
Fetch and pull before edits, and push completed commits. Keep durable usage instructions
in README; track task progress in the owner's issue tracker.
