# iMessage Channel for Claude Code

Text your Claude Code session from iMessage. Two-way: you send a text, Claude reads it and replies back via iMessage. Powered by [Linq](https://linqapp.com).

## Demo

```
You (iMessage):  Hey there claude code
Claude Code:     ← imessage: Hey there claude code
                 ● imessage – reply(text: "Hey! What's up?")
                   └ sent via iMessage
You (iMessage):  [receives "Hey! What's up?"]
```

## Prerequisites

- [Claude Code](https://claude.ai/code) v2.1.80+
- [Node.js](https://nodejs.org) >= 22
- A [Linq](https://linqapp.com) API token and phone number

## Quick Setup

### 1. Install the plugin

```
/plugin marketplace add linq-team/claude-code-imessage-channel
/plugin install imessage@linq
```

### 2. Configure

Get your token from the [Linq dashboard](https://zero.linqapp.com/api-tooling/) or run `linq signup` for a free sandbox number.

```
/imessage:configure <your-token>
/imessage:configure <your-linq-phone-number>
```

### 3. Launch with the channel flag

```bash
claude --channels plugin:imessage@linq
```

### 4. Set your phone number

So Claude knows who to text on startup:

```
/imessage:access recipient +1234567890
```

Restart Claude Code with the channel flag. Claude texts you on startup.

## Access Control

By default, unknown senders trigger a **pairing flow** — they get a 6-character code, and you approve it from your session. Once approved, their messages pass through.

All state lives in `~/.claude/channels/imessage/access.json`. The server re-reads it on every inbound message, so changes take effect without a restart.

### Policies

| Policy | Behavior |
|--------|----------|
| `pairing` (default) | Unknown senders get a pairing code. Approve with `/imessage:access pair <code>`. |
| `allowlist` | Drop silently. No reply to unknown senders. |
| `open` | Anyone can message. No filtering. |
| `disabled` | Drop everything. |

### Skill reference

| Command | Effect |
|---------|--------|
| `/imessage:access` | Print current state: policy, allowlist, pending pairings. |
| `/imessage:access pair <code>` | Approve pairing code. Adds sender to allowlist. |
| `/imessage:access deny <code>` | Discard pending code. Sender not notified. |
| `/imessage:access allow +1234567890` | Add phone number to allowlist. |
| `/imessage:access remove +1234567890` | Remove from allowlist. |
| `/imessage:access policy allowlist` | Set policy. Values: `pairing`, `allowlist`, `open`, `disabled`. |
| `/imessage:access recipient +1234567890` | Set default recipient for startup greeting. |
| `/imessage:access set ackReaction love` | Tapback on receipt: `like`, `love`, `laugh`, `dislike`, `emphasis`, `question`. |

### Config file

`~/.claude/channels/imessage/access.json`:

```json
{
  "dmPolicy": "pairing",
  "allowFrom": ["+12025551234"],
  "defaultRecipient": "+12025551234",
  "pendingPairings": {},
  "ackReaction": "love",
  "pollInterval": 3000
}
```

## Configuration

Credentials are stored in `~/.claude/channels/imessage/.env`:

```
LINQ_TOKEN=your-api-token
LINQ_FROM_PHONE=+1XXXXXXXXXX
```

Manage with `/imessage:configure`:

| Command | Effect |
|---------|--------|
| `/imessage:configure` | Show current status. |
| `/imessage:configure <token>` | Set API token. |
| `/imessage:configure +1234567890` | Set Linq phone number. |
| `/imessage:configure clear` | Remove all credentials. |

Environment variables (`LINQ_TOKEN`, `LINQ_FROM_PHONE`, etc.) override the `.env` file.

## Tools

| Tool | Description |
|------|-------------|
| `reply` | Reply to an inbound iMessage conversation |
| `send` | Send an iMessage to any phone number |
| `react` | Tapback reaction (like, love, laugh, dislike, emphasis, question) |
| `edit_message` | Edit a previously sent message (for streaming progress updates) |

## How It Works

```
Your phone → iMessage → Linq → poller → Claude Code session
Claude reply → Linq API → iMessage → your phone
```

The channel server polls the Linq API every 3 seconds for new messages. No webhook URL, no ngrok, no port forwarding needed. A webhook listener on port 9998 is available as fallback.

## Features

- **Two-way iMessage** — text in, get replies back as iMessages
- **Access control** — pairing flow, allowlist, or open policy
- **Read receipts** — auto-sent when your message is received
- **Typing indicators** — shows typing while Claude processes
- **Tapback reactions** — Claude can react with like, love, laugh, etc.
- **Ack reactions** — configurable tapback sent on message receipt
- **Streaming edits** — send "working..." then update in-place
- **Contact card** — auto-sets name to "Claude Code" with logo
- **No ngrok needed** — polling-based, works behind any firewall

## Plugin Structure

```
claude-code-imessage-channel/
├── .claude-plugin/
│   ├── plugin.json          # Plugin manifest
│   └── marketplace.json     # Marketplace catalog
├── .mcp.json                # MCP server config
├── skills/
│   ├── access/
│   │   └── SKILL.md         # Access control skill
│   ├── configure/
│   │   └── SKILL.md         # Configuration skill
│   └── imessage/
│       └── SKILL.md         # Usage hints skill
├── src/
│   └── channel.ts           # Channel server
├── CLAUDE.md
├── package.json
└── tsconfig.json
```

## Requirements

- Node.js >= 22
- Claude Code v2.1.80+ with channels support
- A [Linq](https://linqapp.com) account with an API token and phone number

## License

MIT
