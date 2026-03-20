# iMessage Channel for Claude Code

Text your Claude Code session from iMessage. Two-way: send a text, Claude reads it and replies back via iMessage.

Powered by [Linq](https://linqapp.com) - iMessage API infrastructure.

## How it works

```
Your phone (iMessage) → Linq → webhook → this channel → Claude Code session
Claude reply → Linq API → iMessage → your phone
```

## Setup

### 1. Get a Linq account

Sign up at [linqapp.com](https://linqapp.com) and get your API token from [Integration Details](https://zero.linqapp.com/api-tooling/).

### 2. Clone and build

```bash
git clone https://github.com/linq-team/claude-code-imessage-channel.git
cd claude-code-imessage-channel
npm install
npm run build
```

### 3. Configure

```bash
mkdir -p ~/.linq
cat > ~/.linq/config.json << 'EOF'
{
  "version": 2,
  "profile": "default",
  "profiles": {
    "default": {
      "token": "YOUR_LINQ_API_TOKEN",
      "fromPhone": "+1XXXXXXXXXX"
    }
  }
}
EOF
```

Or use environment variables:

```bash
export LINQ_TOKEN="your-api-token"
export LINQ_FROM_PHONE="+1XXXXXXXXXX"
```

### 4. Run with Claude Code

```bash
claude --dangerously-load-development-channels server:imessage
```

Text your Linq number from your phone. The message appears in your Claude Code session. Claude replies back via iMessage.

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

| Variable | Description |
|----------|-------------|
| `LINQ_TOKEN` | Linq API token (overrides config file) |
| `LINQ_FROM_PHONE` | Your Linq phone number |
| `LINQ_API_URL` | Custom API URL (default: `https://api.linqapp.com/v3`) |
| `LINQ_CHANNEL_PORT` | Webhook listener port (default: `9998`) |
| `LINQ_ALLOWED_SENDERS` | Comma-separated phone numbers allowed to message (sender gating) |
| `LINQ_PROFILE` | Active config profile name |

### Sender gating

Restrict who can push messages into your session:

```bash
export LINQ_ALLOWED_SENDERS="+19178034541,+12025551234"
```

Only messages from these numbers will be forwarded to Claude. All others are silently dropped.

## Tools

The channel exposes two tools to Claude:

| Tool | Description |
|------|-------------|
| `reply` | Reply to an inbound iMessage conversation |
| `send` | Send an iMessage to any phone number |

## Architecture

This is a [Claude Code channel](https://code.claude.com/docs/en/channels) - an MCP server that pushes events into your session.

1. **Inbound**: Linq receives an iMessage to your number, fires a webhook to the local listener, which pushes a `<channel>` event into Claude Code
2. **Outbound**: Claude calls the `reply` or `send` tool, which hits the Linq API to send an iMessage

The channel runs as a subprocess spawned by Claude Code, communicating over stdio.

## Webhook setup

For inbound messages to reach your session, you need a webhook subscription in Linq pointing to your channel's local port. Use [ngrok](https://ngrok.com) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) to expose the local port:

```bash
# Start a tunnel
ngrok http 9998

# Create webhook subscription via Linq API or dashboard
# pointing to your ngrok URL
```

## Requirements

- Node.js >= 22
- A [Linq](https://linqapp.com) account with API access
- Claude Code v2.1.80+ with channels support

## License

MIT
