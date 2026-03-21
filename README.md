# iMessage Channel for Claude Code

Connect iMessage to your Claude Code session with an MCP server.

The MCP server connects to the Linq API and provides tools to Claude to reply, react, or edit messages. When you text the Linq number, the server forwards the message to your Claude Code session.

## Prerequisites

- [Claude Code](https://claude.ai/code) v2.1.80+
- [Node.js](https://nodejs.org) >= 22

## Quick Setup

Default pairing flow for a single-user setup. See [Access Control](#access--delivery) for multi-user and policy options.

### 1. Get a Linq number

Get your token from the [Linq dashboard](https://zero.linqapp.com/api-tooling/), or run `linq signup` for a free sandbox number (3hr expiry, GitHub auth).

### 2. Install the plugin

These are Claude Code commands — run `claude` to start a session first.

```
/plugin marketplace add linq-team/claude-code-imessage-channel
/plugin install imessage@linq
```

### 3. Give the server your credentials

```
/imessage:configure <your-linq-token>
/imessage:configure <your-linq-phone-number>
```

Writes `LINQ_TOKEN=...` and `LINQ_FROM_PHONE=...` to `~/.claude/channels/imessage/.env`. You can also write that file by hand, or set the variables in your shell environment — shell takes precedence.

### 4. Relaunch with the channel flag

The server won't connect without this — exit your session and start a new one:

```bash
claude --dangerously-load-development-channels plugin:imessage@linq
```

> **Note:** Don't launch from the plugin repo directory — the local `.mcp.json` will conflict. Launch from any other directory (e.g. `~/Desktop`, your project folder, etc.).

### 5. Pair

With Claude Code running from the previous step, text your Linq number from iMessage — you'll get a 6-character pairing code back. In your Claude Code session:

```
/imessage:access pair <code>
```

Your next text reaches the assistant.

### 6. Lock it down

Pairing is for capturing phone numbers. Once you're in, switch to allowlist so strangers don't get pairing-code replies:

```
/imessage:access policy allowlist
```

### Optional: Set a startup greeting

So Claude texts you automatically when it starts:

```
/imessage:access recipient +1XXXXXXXXXX
```

Restart Claude Code with the channel flag. Claude texts you on startup.

## Access & Delivery

A Linq number is publicly addressable via iMessage. Anyone who knows the number can text it, and without a gate those messages flow straight into your assistant session. The access model decides who gets through.

By default, a text from an unknown sender triggers **pairing**: the server replies with a 6-character code and drops the message. You run `/imessage:access pair <code>` from your assistant session to approve them. Once approved, their messages pass through.

All state lives in `~/.claude/channels/imessage/access.json`. The `/imessage:access` skill commands edit this file; the server re-reads it on every inbound message, so changes take effect without a restart.

### At a glance

| | |
|-|-|
| Default policy | `pairing` |
| Sender ID | Phone number in E.164 format (e.g. `+1XXXXXXXXXX`) |
| Config file | `~/.claude/channels/imessage/access.json` |

### DM policies

`dmPolicy` controls how messages from senders not on the allowlist are handled.

| Policy | Behavior |
|--------|----------|
| `pairing` (default) | Reply with a pairing code, drop the message. Approve with `/imessage:access pair <code>`. |
| `allowlist` | Drop silently. No reply. Useful if your number is shared and pairing replies would attract spam. |
| `open` | Anyone can message. No filtering. |
| `disabled` | Drop everything, including allowlisted senders. |

```
/imessage:access policy allowlist
```

### Phone numbers

iMessage uses phone numbers as identifiers. The allowlist stores E.164 format numbers (e.g. `+1XXXXXXXXXX`). Pairing captures the number automatically.

```
/imessage:access allow +1XXXXXXXXXX
/imessage:access remove +1XXXXXXXXXX
```

### Delivery

Configure inbound behavior with `/imessage:access set <key> <value>`.

**ackReaction** — tapback sent on message receipt. iMessage supports: `like`, `love`, `laugh`, `dislike`, `emphasis`, `question`. Empty string disables.

```
/imessage:access set ackReaction love
/imessage:access set ackReaction ""
```

**pollInterval** — how often the server checks for new messages, in milliseconds. Default `3000`.

```
/imessage:access set pollInterval 5000
```

### Skill reference

| Command | Effect |
|---------|--------|
| `/imessage:access` | Print current state: policy, allowlist, pending pairings. |
| `/imessage:access pair a4f91c` | Approve pairing code. Adds sender to `allowFrom`. |
| `/imessage:access deny a4f91c` | Discard pending code. Sender not notified. |
| `/imessage:access allow +1XXXXXXXXXX` | Add a phone number directly. |
| `/imessage:access remove +1XXXXXXXXXX` | Remove from allowlist. |
| `/imessage:access policy allowlist` | Set dmPolicy. Values: `pairing`, `allowlist`, `open`, `disabled`. |
| `/imessage:access recipient +1XXXXXXXXXX` | Set default recipient for startup greeting. |
| `/imessage:access set ackReaction love` | Set a config key: `ackReaction`, `pollInterval`. |
| `/imessage:access clear` | Delete access.json, reset to defaults. |

### Config file

`~/.claude/channels/imessage/access.json`. Absent file is equivalent to `pairing` policy with empty lists, so the first text triggers pairing.

```json
{
  "dmPolicy": "pairing",
  "allowFrom": ["+1XXXXXXXXXX"],
  "defaultRecipient": "+1XXXXXXXXXX",
  "pendingPairings": {
    "a4f91c": { "phone": "+1XXXXXXXXXX", "createdAt": "2026-03-20T..." }
  },
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
| `/imessage:configure` | Show current status (token set? phone set?). |
| `/imessage:configure <token>` | Save token to `.env`. |
| `/imessage:configure +1XXXXXXXXXX` | Save phone number to `.env`. |
| `/imessage:configure clear` | Remove all credentials. |

Environment variables (`LINQ_TOKEN`, `LINQ_FROM_PHONE`, etc.) override the `.env` file.

## Tools exposed to the assistant

| Tool | Purpose |
|------|---------|
| `reply` | Reply to an inbound iMessage. Takes `chat_id` + `text`. Returns the sent message ID. |
| `send` | Send to any phone number. Takes `to` + `text`. |
| `react` | Tapback reaction to a message by ID. Values: `like`, `love`, `laugh`, `dislike`, `emphasis`, `question`. |
| `edit_message` | Edit a previously sent message. Useful for "working…" → result progress updates. |

Inbound messages trigger a typing indicator automatically — iMessage shows typing while the assistant works on a response.

## No history or search

The Linq API polls for recent messages but does not expose full chat history or search. The server only sees messages as they arrive — if the assistant needs earlier context, it will ask you to paste or summarize.

## How It Works

```
Your phone → iMessage → Linq API → poller → Claude Code session
Claude reply → Linq API → iMessage → your phone
```

The channel server polls the Linq API every 3 seconds for new messages (configurable via `pollInterval`). No webhook URL, no ngrok, no port forwarding needed. A webhook listener on port 9998 is available as fallback if you prefer real-time delivery.

When Claude starts, it automatically sets a contact card ("Claude Code" with logo) so recipients see a friendly name in iMessage.

## Features

- **Two-way iMessage** — text in, get replies back as iMessages
- **Access control** — pairing flow, allowlist, open, or disabled policy
- **Read receipts** — auto-sent when your message is received
- **Typing indicators** — shows typing while Claude processes
- **Tapback reactions** — Claude can react with like, love, laugh, etc.
- **Ack reactions** — configurable tapback sent on message receipt
- **Streaming edits** — send "working..." then update in-place (iOS 16+)
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
