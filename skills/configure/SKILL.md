---
name: configure
description: Configure the iMessage channel with your Linq credentials. Accepts a token, phone number, or 'clear' to reset.
disable-model-invocation: true
---

# Configure iMessage Channel

Manage credentials stored in `~/.claude/channels/imessage/.env`.

## Parse the argument

The user runs `/imessage:configure` with an optional argument. Detect what they passed:

- **No argument**: Read `~/.claude/channels/imessage/.env` and report status. Show whether `LINQ_TOKEN` and `LINQ_FROM_PHONE` are set (mask the token, show only last 4 chars). If neither is set, guide them to get a token at https://zero.linqapp.com/api-tooling/ or run `linq signup` for a free sandbox.

- **`clear`**: Delete `~/.claude/channels/imessage/.env` and confirm credentials removed.

- **Starts with `+` or is all digits (phone number)**: Normalize to E.164 format (prepend +1 if 10 digits). Write or update `LINQ_FROM_PHONE=<number>` in the `.env` file, preserving other lines.

- **Anything else (token)**: Write or update `LINQ_TOKEN=<value>` in the `.env` file, preserving other lines.

## Writing the .env file

1. Create the directory if it doesn't exist: `mkdir -p ~/.claude/channels/imessage`
2. Read the existing `.env` file if present
3. Update or append the relevant line (`LINQ_TOKEN=...` or `LINQ_FROM_PHONE=...`)
4. Write back with permissions `600`: `chmod 600 ~/.claude/channels/imessage/.env`

## After writing

Report what was saved. If both `LINQ_TOKEN` and `LINQ_FROM_PHONE` are now set, tell the user:

"Credentials saved. Restart Claude Code with the channel flag to connect:"
```
claude --channels plugin:imessage@linq-team-claude-code-imessage-channel
```

If only one is set, tell them what's still missing.

## Setting default recipient

If the user runs `/imessage:configure recipient +1234567890`, write a `config.json` file at `~/.claude/channels/imessage/config.json`:
```json
{ "defaultRecipient": "+1234567890" }
```
This is the number Claude will text on startup to confirm the connection.
