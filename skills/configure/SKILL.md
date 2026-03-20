---
name: configure
description: Set up the iMessage channel with your Linq credentials. Run this if you need to configure or reconfigure your token and phone number.
disable-model-invocation: true
---

# Configure iMessage Channel

Help the user set up their Linq credentials for the iMessage channel.

## If they don't have a Linq account:

1. Check if the `linq` CLI is installed by running `which linq` or `linq --version`
2. If not installed, tell them to run: `curl -fsSL https://raw.githubusercontent.com/linq-team/linq-cli/main/install.sh | sh`
3. Then run: `linq signup` (authenticates via GitHub, provisions a sandbox number)
4. After signup, run: `linq profile` to see their token and phone number

## If they have credentials:

Write the config file:

```bash
mkdir -p ~/.linq
cat > ~/.linq/config.json << 'EOF'
{
  "version": 2,
  "profile": "default",
  "profiles": {
    "default": {
      "token": "THEIR_TOKEN",
      "fromPhone": "+1THEIR_LINQ_NUMBER"
    }
  }
}
EOF
```

## Then ask for their personal phone number:

"What's your phone number? I'll text you to confirm everything works."

Set it as `LINQ_DEFAULT_RECIPIENT` in the `.mcp.json` env vars, or remember it for the session.

## Restart:

Tell them to restart Claude Code with:
```
claude --dangerously-skip-permissions --dangerously-load-development-channels server:imessage
```
