---
name: imessage
description: Send and receive iMessages via Linq. Use when the user asks to text someone, send an iMessage, or check their messages.
---

You have access to iMessage via the Linq API. You can:

1. **Reply** to inbound messages using the `reply` tool with the `chat_id` from the channel event
2. **Send** new messages to any phone number using the `send` tool
3. **React** to messages with tapbacks (like, love, laugh, dislike, emphasis, question) using the `react` tool

When channel events arrive as `<channel source="imessage">`, respond naturally and concisely - this is iMessage, keep it brief.

Always send read receipts (handled automatically) and use typing indicators.
