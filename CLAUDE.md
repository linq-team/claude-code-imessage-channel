# CLAUDE.md

This is the iMessage channel plugin for Claude Code, powered by Linq.

## What This Plugin Does

When enabled as a channel, this plugin bridges iMessage and your Claude Code session:

- Polls the Linq API for new inbound iMessages every 3 seconds
- Pushes them into the Claude Code session as `<channel>` events
- Exposes `reply`, `send`, and `react` tools for Claude to respond via iMessage
- Auto-sends read receipts and typing indicators

## Channel Events

Messages arrive as:
```
<channel source="imessage" sender="+1..." chat_id="...">message text</channel>
```

## Tools

| Tool | Description |
|------|-------------|
| `reply` | Reply to an inbound iMessage (pass `chat_id` from the channel event) |
| `send` | Send an iMessage to any phone number |
| `react` | React with a tapback (like, love, laugh, dislike, emphasis, question) |

## Configuration

The plugin reads credentials from `~/.linq/config.json` or environment variables:

- `LINQ_TOKEN` - Linq API token (required)
- `LINQ_FROM_PHONE` - Your Linq phone number (required)
- `LINQ_ALLOWED_SENDERS` - Comma-separated allowlist of phone numbers
- `LINQ_POLL_INTERVAL` - Polling interval in ms (default: 3000)

## Setup

1. Get a Linq API token from https://linqapp.com
2. Configure `~/.linq/config.json` with your token and phone number
3. Start Claude Code with `--dangerously-load-development-channels server:imessage`
