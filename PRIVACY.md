# Privacy Policy

**iMessage Channel Plugin for Claude Code**
Powered by [Linq](https://linqapp.com)

Last updated: March 23, 2026

## Overview

This plugin connects your Claude Code session to iMessage via the Linq API. This policy explains what data the plugin handles and how it's processed.

## What data is collected

### Messages

- **Inbound messages**: text messages sent to your Linq phone number are polled from the Linq API and forwarded to your local Claude Code session.
- **Outbound messages**: messages you send through Claude Code are transmitted via the Linq API to the recipient's phone.
- **Message metadata**: chat IDs, message IDs, sender phone numbers, timestamps, and delivery status.

### Attachments

- **Inbound photos and files**: downloaded from the Linq API and stored locally at `~/.claude/channels/imessage/inbox/` on your machine.
- **Outbound files**: uploaded to the Linq API via presigned URLs for delivery to the recipient.

### Credentials

- **Linq API token**: stored locally at `~/.claude/channels/imessage/.env` on your machine. Never transmitted except to authenticate with the Linq API.
- **Phone numbers**: your Linq phone number and recipient phone numbers are used for message routing.

### Access control

- **Allowlist and pairing data**: stored locally at `~/.claude/channels/imessage/access.json` on your machine.

## Where data is stored

| Data | Location |
|------|----------|
| Credentials (`.env`) | Local machine only |
| Access control (`access.json`) | Local machine only |
| Downloaded attachments (`inbox/`) | Local machine only |
| Messages in transit | Linq API servers |
| Delivered messages | Recipient's device (iMessage/SMS/RCS) |

## How data is processed

- The plugin runs entirely on your local machine as a Node.js process.
- All API communication is over HTTPS to `api.linqapp.com`.
- The plugin does not send data to any service other than the Linq API.
- No analytics, tracking, or telemetry is collected by this plugin.
- Claude Code processes messages locally: message content is sent to Anthropic's API as part of your Claude Code session context.

## Data retention

- **Local files** (credentials, access config, downloaded attachments) persist on your machine until you delete them. Run `/imessage:configure clear` to remove credentials.
- **Messages sent via Linq** are subject to [Linq's Privacy Policy](https://linqapp.com/policies/privacy-policy) and their retention practices.
- **Claude Code session data** is subject to [Anthropic's Privacy Policy](https://www.anthropic.com/privacy).

## Third-party services

This plugin relies on two third-party services:

1. **Linq**: messaging API for iMessage, SMS, and RCS delivery. See [Linq's Privacy Policy](https://linqapp.com/policies/privacy-policy).
2. **Anthropic (Claude Code)**: AI assistant that processes messages in your session. See [Anthropic's Privacy Policy](https://www.anthropic.com/privacy).

## Your rights

- You can delete all local plugin data at any time by removing `~/.claude/channels/imessage/`.
- You can revoke API access by regenerating your Linq token.
- For data held by Linq, contact [privacy@linqapp.com](mailto:privacy@linqapp.com).
- For data held by Anthropic, see [Anthropic's Privacy Policy](https://www.anthropic.com/privacy).

## Contact

For questions about this plugin's privacy practices:

- **Plugin**: [GitHub Issues](https://github.com/linq-team/claude-code-imessage-channel/issues)
- **Linq platform**: [privacy@linqapp.com](mailto:privacy@linqapp.com)
- **Linq App Inc.**, Attn: Data Privacy Officer, 1904 1st Ave. N, Suite 200, Birmingham, AL 35203
