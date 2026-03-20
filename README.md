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

## Quick Start

### 1. Prerequisites

- [Claude Code](https://claude.ai/code) v2.1.80+
- [Node.js](https://nodejs.org) >= 22

### 2. Install

```bash
git clone https://github.com/linq-team/claude-code-imessage-channel.git
cd claude-code-imessage-channel
npm install && npm run build
```

### 3. Get a Linq number (free sandbox)

```bash
# Install the Linq CLI
curl -fsSL https://raw.githubusercontent.com/linq-team/linq-cli/main/install.sh | sh

# Sign up (authenticates via GitHub, provisions a sandbox number)
linq signup

# See your token and phone number
linq profile
```

Or if you already have a Linq account, get your token from the [Linq dashboard](https://zero.linqapp.com/api-tooling/).

### 4. Configure

```bash
mkdir -p ~/.linq
cat > ~/.linq/config.json << 'EOF'
{
  "version": 2,
  "profile": "default",
  "profiles": {
    "default": {
      "token": "YOUR_TOKEN_FROM_LINQ_PROFILE",
      "fromPhone": "+1YOUR_LINQ_NUMBER"
    }
  }
}
EOF
```

### 5. Run

```bash
claude --dangerously-skip-permissions --dangerously-load-development-channels server:imessage
```

Claude texts you on startup. Text back and it responds via iMessage.

**No Linq account?** Just start Claude Code - it'll walk you through setup in the terminal.

## How It Works

```
Your phone → iMessage → Linq → poller → Claude Code session
Claude reply → Linq API → iMessage → your phone
```

The channel server polls the Linq API every 3 seconds for new messages (like Telegram's long-polling). No webhook URL, no ngrok, no port forwarding needed.

When Claude starts, it automatically texts you to let you know it's online.

## Features

- **Two-way iMessage** - text in, get replies back as iMessages
- **Read receipts** - auto-sent when your message is received
- **Typing indicators** - shows typing while Claude processes
- **Tapback reactions** - Claude can react with like, love, laugh, etc.
- **Contact card** - set a custom name and photo via `POST /v3/contact_card`
- **Sender gating** - restrict who can message your session
- **No ngrok needed** - polling-based, works behind any firewall

## Configuration

### Config file (`~/.linq/config.json`)

```json
{
  "version": 2,
  "profile": "default",
  "profiles": {
    "default": {
      "token": "your-linq-api-token",
      "fromPhone": "+1XXXXXXXXXX"
    }
  }
}
```

### Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LINQ_TOKEN` | Linq API token | from config |
| `LINQ_FROM_PHONE` | Your Linq phone number | from config |
| `LINQ_ALLOWED_SENDERS` | Comma-separated sender allowlist | all |
| `LINQ_POLL_INTERVAL` | Poll interval in ms | `3000` |
| `LINQ_CHANNEL_PORT` | Webhook fallback port | `9998` |
| `LINQ_API_URL` | Custom API URL | `https://api.linqapp.com/v3` |
| `LINQ_PROFILE` | Active config profile | `default` |

### Sender gating

Restrict who can push messages into your session:

```bash
export LINQ_ALLOWED_SENDERS="+12025551234,+12025555678"
```

## Tools

| Tool | Description |
|------|-------------|
| `reply` | Reply to an inbound iMessage conversation |
| `send` | Send an iMessage to any phone number |
| `react` | Tapback reaction (like, love, laugh, dislike, emphasis, question) |

## Plugin Structure

```
claude-code-imessage-channel/
├── .claude-plugin/
│   └── plugin.json          # Plugin manifest
├── .mcp.json                # MCP server config
├── skills/
│   └── imessage/
│       └── SKILL.md         # iMessage skill for Claude
├── src/
│   └── channel.ts           # Channel server (polling + webhook fallback)
├── CLAUDE.md                # Instructions for Claude
├── package.json
└── tsconfig.json
```

## Set Contact Card

Set a custom name and photo that recipients see in iMessage:

```bash
curl -X POST "https://api.linqapp.com/v3/contact_card" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number": "+1XXXXXXXXXX",
    "first_name": "Claude",
    "last_name": "Code",
    "image_url": "https://your-cdn.com/avatar.png"
  }'
```

Then share it with a specific chat:

```bash
curl -X POST "https://api.linqapp.com/v3/chats/CHAT_ID/share_contact_card" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Architecture

This is a [Claude Code channel](https://code.claude.com/docs/en/channels) - an MCP server that pushes events into your session via the `claude/channel` experimental capability.

The server uses **polling** (not webhooks) to check for new messages, similar to how the official Telegram channel works. This means:

- No public URL needed
- Works behind firewalls and NATs
- No ngrok or tunnel setup
- Webhook listener on port 9998 as fallback if you prefer webhooks

## Requirements

- Node.js >= 22
- Claude Code v2.1.80+ with channels support
- A [Linq](https://linqapp.com) account with an API token and phone number

## License

MIT
