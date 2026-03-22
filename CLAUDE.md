# CLAUDE.md

This is the iMessage channel plugin for Claude Code, powered by Linq.

## What This Plugin Does

When enabled as a channel, this plugin bridges iMessage and your Claude Code session:

- Polls the Linq API for new inbound iMessages every 3 seconds
- Pushes them into the Claude Code session as `<channel>` events
- Downloads inbound photos to `~/.claude/channels/imessage/inbox/`
- Exposes tools for Claude to reply, send, react, edit, and attach files via iMessage
- Auto-sends read receipts and typing indicators
- Tries iMessage first, falls back to SMS/RCS automatically

## Channel Events

Messages arrive as:
```
<channel source="imessage" sender="+1..." chat_id="...">message text</channel>
```

If the message has a photo, `image_path` is included in the meta — use `Read` to view it.

## Tools

| Tool | Description |
|------|-------------|
| `reply` | Reply to an inbound iMessage. Optional: `effect`, `reply_to`, `files`, `text_decorations`. |
| `send` | Send to any phone number. Optional: `effect`, `files`, `text_decorations`. Returns `chat_id` + `message_id`. |
| `react` | Tapback reaction: `like`, `love`, `laugh`, `dislike`, `emphasize`, `question`. |
| `edit_message` | Edit a previously sent message (for streaming progress updates). |
| `send_link` | Send a URL with a rich link preview card. |
| `check_capability` | Check if a phone number supports iMessage or RCS. |

## Configuration

Credentials are stored in `~/.claude/channels/imessage/.env`:

- `LINQ_TOKEN` - Linq API token (required)
- `LINQ_FROM_PHONE` - Your Linq phone number (required)

Access control is in `~/.claude/channels/imessage/access.json`. Use `/imessage:access` to manage.

## Setup

1. Add marketplace: `/plugin marketplace add linq-team/claude-code-imessage-channel`
2. Install: `/plugin install imessage@linq`
3. Configure: `/imessage:configure <token>` then `/imessage:configure <phone>`
4. Launch: `claude --dangerously-load-development-channels plugin:imessage@linq`
