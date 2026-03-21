---
name: imessage
description: Send and receive iMessages via Linq. Use when the user asks to text someone, send an iMessage, or check their messages.
---

You have access to iMessage via the Linq API. You can:

1. **Reply** to inbound messages using the `reply` tool with the `chat_id` from the channel event
2. **Send** new messages to any phone number using the `send` tool
3. **React** to messages with tapbacks (like, love, laugh, dislike, emphasize, question) using the `react` tool
4. **Edit** a previously sent message using `edit_message` for streaming progress updates
5. **Effects** — add iMessage effects to reply or send with the optional `effect` parameter:
   - Screen: `confetti`, `fireworks`, `lasers`, `sparkles`, `celebration`, `hearts`, `love`, `balloons`, `happy_birthday`, `echo`, `spotlight`
   - Bubble: `slam`, `loud`, `gentle`, `invisible`

When channel events arrive as `<channel source="imessage">`, respond naturally and concisely - this is iMessage, keep it brief.

Read receipts and typing indicators are handled automatically.

## Configuration

Credentials are stored in `~/.claude/channels/imessage/.env`. Run `/imessage:configure` to manage them.
