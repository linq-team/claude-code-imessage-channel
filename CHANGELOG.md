# Changelog

## 0.2.0

- Restructured as installable Claude Code plugin (`/plugin install imessage@linq`)
- Added `/imessage:access` skill for access control (pairing, allowlist, policies)
- Added `/imessage:configure` skill for credential management
- Config stored in `~/.claude/channels/imessage/` (`.env` + `access.json`)
- Fixed react endpoint to match Linq SDK (`/reactions` not `/react`)
- Fixed reaction type `emphasize` (was `emphasis`)
- Webhook server handles EADDRINUSE gracefully
- Startup logic runs independently of webhook
- Legacy fallback for `~/.linq/config.json` with migration warning

## 0.1.0

- Initial release
- Two-way iMessage bridge via Linq API
- Polling-based message retrieval (no ngrok needed)
- Reply, send, react, and edit_message tools
- Auto read receipts and typing indicators
- Contact card auto-setup
- Sender allowlist via environment variable
