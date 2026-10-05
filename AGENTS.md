# HAPI Chat

This is a standalone, universal VS Code client for HAPI. Keep corporate infrastructure,
tokens, chat transcripts and private test configuration out of this public repository.

Use the native client REST and SSE API. Do not depend on CLI-plane or deployment-specific
routes. Credentials belong in VS Code SecretStorage, never webviews or configuration.
Each chat must remain pinned to its connection when the selected connection changes.

Run `npm test` and `npm run lint` before committing code. Package with `npm run package`.
Fetch and pull before edits, and push completed commits. Keep durable usage instructions
in README; track task progress in the owner's issue tracker.
