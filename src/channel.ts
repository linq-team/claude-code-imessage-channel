#!/usr/bin/env node
/**
 * iMessage Channel for Claude Code
 * Powered by Linq (https://linqapp.com)
 *
 * Two-way bridge: text your Linq number from iMessage and it pushes
 * into your Claude Code session. Claude replies back via iMessage.
 *
 * Setup:
 *   /plugin install imessage@linq-team-claude-code-imessage-channel
 *   /imessage:configure <token>
 *   /imessage:configure <phone>
 *   claude --channels plugin:imessage@linq-team-claude-code-imessage-channel
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

// --- Configuration ---

interface ChannelConfig {
  token: string
  fromPhone: string
  apiUrl: string
  webhookPort: number
  defaultRecipient: string
  allowedSenders: Set<string>
}

interface AccessConfig {
  dmPolicy: 'pairing' | 'allowlist' | 'open' | 'disabled'
  allowFrom: string[]
  defaultRecipient?: string
  pendingPairings: Record<string, { phone: string; createdAt: string }>
  ackReaction?: string
  pollInterval?: number
}

const ACCESS_FILE = path.join(process.env.HOME || '', '.claude', 'channels', 'imessage', 'access.json')

function loadAccessConfig(): AccessConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(ACCESS_FILE, 'utf-8'))
    return {
      dmPolicy: raw.dmPolicy || 'pairing',
      allowFrom: raw.allowFrom || [],
      defaultRecipient: raw.defaultRecipient,
      pendingPairings: raw.pendingPairings || {},
      ackReaction: raw.ackReaction,
      pollInterval: raw.pollInterval,
    }
  } catch {
    return { dmPolicy: 'pairing', allowFrom: [], pendingPairings: {} }
  }
}

function saveAccessConfig(access: AccessConfig): void {
  const dir = path.dirname(ACCESS_FILE)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(ACCESS_FILE, JSON.stringify(access, null, 2) + '\n')
}

function generatePairingCode(): string {
  return Math.random().toString(36).substring(2, 8)
}

const CHANNEL_DIR = path.join(process.env.HOME || '', '.claude', 'channels', 'imessage')

function parseEnvFile(filePath: string): Record<string, string> {
  const vars: Record<string, string> = {}
  try {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
    }
  } catch {}
  return vars
}

function loadChannelConfig(): ChannelConfig {
  // Priority: env vars > ~/.claude/channels/imessage/.env + config.json > ~/.linq/config.json (legacy)
  let token = process.env.LINQ_TOKEN || ''
  let fromPhone = process.env.LINQ_FROM_PHONE || ''
  let apiUrl = process.env.LINQ_API_URL || 'https://api.linqapp.com/v3'
  let defaultRecipient = process.env.LINQ_DEFAULT_RECIPIENT || ''
  let allowedSenders = process.env.LINQ_ALLOWED_SENDERS || ''

  // Read from ~/.claude/channels/imessage/
  const envVars = parseEnvFile(path.join(CHANNEL_DIR, '.env'))
  token = token || envVars.LINQ_TOKEN || ''
  fromPhone = fromPhone || envVars.LINQ_FROM_PHONE || ''
  if (envVars.LINQ_API_URL) apiUrl = envVars.LINQ_API_URL
  defaultRecipient = defaultRecipient || envVars.LINQ_DEFAULT_RECIPIENT || ''
  allowedSenders = allowedSenders || envVars.LINQ_ALLOWED_SENDERS || ''

  // Read optional config.json for non-secret settings
  const configJsonPath = path.join(CHANNEL_DIR, 'config.json')
  try {
    const cfg = JSON.parse(fs.readFileSync(configJsonPath, 'utf-8'))
    defaultRecipient = defaultRecipient || cfg.defaultRecipient || ''
    allowedSenders = allowedSenders || (cfg.allowedSenders || []).join(',')
    if (cfg.apiUrl) apiUrl = cfg.apiUrl
  } catch {}

  // Legacy fallback: ~/.linq/config.json
  if (!token || !fromPhone) {
    const legacyPath = path.join(process.env.HOME || '', '.linq', 'config.json')
    if (fs.existsSync(legacyPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'))
        const profileName = process.env.LINQ_PROFILE || raw.profile || 'default'
        const profile = raw.profiles?.[profileName]
        if (profile) {
          if (!token && profile.token) {
            token = profile.token
            console.error('[imessage] using legacy ~/.linq/config.json — run /imessage:configure to migrate')
          }
          fromPhone = fromPhone || profile.fromPhone || ''
          defaultRecipient = defaultRecipient || profile.defaultRecipient || ''
        }
      } catch {}
    }
  }

  return {
    token,
    fromPhone,
    apiUrl,
    webhookPort: parseInt(process.env.LINQ_CHANNEL_PORT || '9998', 10),
    defaultRecipient,
    allowedSenders: new Set(allowedSenders.split(',').filter(Boolean)),
  }
}

const config = loadChannelConfig()

// --- MCP Channel Server ---

const mcp = new Server(
  { name: 'imessage', version: '0.1.0' },
  {
    capabilities: {
      experimental: { 'claude/channel': {} },
      tools: {},
    },
    instructions: `You are connected to iMessage via Linq. Messages arrive as <channel source="imessage" sender="..." chat_id="...">.

When you receive a message:
- Read it and respond helpfully
- Reply using the reply tool, passing the chat_id from the tag
- Use the react tool to add tapback reactions (like, love, laugh, etc) when appropriate
- For longer tasks, stream your progress: send a short initial message with reply (e.g. "On it..."), then call edit_message with the message_id to update it as you work. The message edits in-place on their phone.
- You can also send messages to new numbers using the send tool
- Read receipts and typing indicators are sent automatically

The person texting you is your operator. Follow their instructions. Be concise in replies - this is iMessage, not email.
Your iMessage number: ${config.fromPhone}`,
  },
)

// --- Tools ---

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Reply to an iMessage conversation',
      inputSchema: {
        type: 'object' as const,
        properties: {
          chat_id: { type: 'string', description: 'Chat ID from the inbound message' },
          text: { type: 'string', description: 'Message to send' },
        },
        required: ['chat_id', 'text'],
      },
    },
    {
      name: 'edit_message',
      description: 'Edit a previously sent message. Use this for streaming: send an initial short message with reply, then call edit_message to update it as you work. The message updates in-place on their phone (iOS 16+).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          message_id: { type: 'string', description: 'ID of the message to edit (returned from reply or send)' },
          text: { type: 'string', description: 'New text content to replace the message with' },
        },
        required: ['message_id', 'text'],
      },
    },
    {
      name: 'react',
      description: 'React to a message with a tapback (like, love, dislike, laugh, emphasis, question)',
      inputSchema: {
        type: 'object' as const,
        properties: {
          chat_id: { type: 'string', description: 'Chat ID' },
          message_id: { type: 'string', description: 'Message ID to react to' },
          reaction: { type: 'string', description: 'Reaction type: like, love, dislike, laugh, emphasis, question' },
        },
        required: ['chat_id', 'message_id', 'reaction'],
      },
    },
    {
      name: 'send',
      description: 'Send an iMessage to a phone number',
      inputSchema: {
        type: 'object' as const,
        properties: {
          to: { type: 'string', description: 'Phone number (e.g. +12025551234)' },
          text: { type: 'string', description: 'Message to send' },
        },
        required: ['to', 'text'],
      },
    },
  ],
}))

async function linqApiCall(endpoint: string, body: object, method = 'POST'): Promise<Response> {
  return fetch(`${config.apiUrl}/${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

// Auto read receipt + typing indicator helpers
async function markRead(chatId: string): Promise<void> {
  try {
    await linqApiCall(`chats/${chatId}/read`, {})
  } catch {}
}

async function startTyping(chatId: string): Promise<void> {
  try {
    await linqApiCall(`chats/${chatId}/typing`, {})
  } catch {}
}

async function stopTyping(chatId: string): Promise<void> {
  try {
    await fetch(`${config.apiUrl}/chats/${chatId}/typing`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${config.token}` },
    })
  } catch {}
}

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params

  if (name === 'reply') {
    const { chat_id, text } = args as { chat_id: string; text: string }
    try {
      await stopTyping(chat_id)
      const resp = await linqApiCall(`chats/${chat_id}/messages`, {
        message: { parts: [{ type: 'text', value: text }] },
      })
      if (!resp.ok) {
        const err = await resp.text()
        return { content: [{ type: 'text' as const, text: `Failed: ${err}` }], isError: true }
      }
      const data = await resp.json() as any
      const messageId = data.message?.id || data.id || ''
      return { content: [{ type: 'text' as const, text: `sent via iMessage (message_id: ${messageId})` }] }
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true }
    }
  }

  if (name === 'edit_message') {
    const { message_id, text } = args as { message_id: string; text: string }
    try {
      const resp = await fetch(`${config.apiUrl}/messages/${message_id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ part_index: 0, text }),
      })
      if (!resp.ok) {
        const err = await resp.text()
        return { content: [{ type: 'text' as const, text: `Failed to edit: ${err}` }], isError: true }
      }
      return { content: [{ type: 'text' as const, text: 'message edited' }] }
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true }
    }
  }

  if (name === 'react') {
    const { chat_id, message_id, reaction } = args as { chat_id: string; message_id: string; reaction: string }
    try {
      const resp = await linqApiCall(`chats/${chat_id}/messages/${message_id}/react`, {
        reaction,
      })
      if (!resp.ok) {
        const err = await resp.text()
        return { content: [{ type: 'text' as const, text: `Failed: ${err}` }], isError: true }
      }
      return { content: [{ type: 'text' as const, text: `reacted with ${reaction}` }] }
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true }
    }
  }

  if (name === 'send') {
    const { to, text } = args as { to: string; text: string }
    try {
      const resp = await linqApiCall('chats', {
        to: [to],
        from: config.fromPhone,
        message: { parts: [{ type: 'text', value: text }] },
      })
      if (!resp.ok) {
        const err = await resp.text()
        return { content: [{ type: 'text' as const, text: `Failed: ${err}` }], isError: true }
      }
      return { content: [{ type: 'text' as const, text: `sent to ${to}` }] }
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true }
    }
  }

  throw new Error(`unknown tool: ${name}`)
})

// --- Connect to Claude Code ---

await mcp.connect(new StdioServerTransport())

// --- Message Polling (like Telegram's long-polling approach) ---
// No ngrok needed - we poll the Linq API for new messages every few seconds

const POLL_INTERVAL = parseInt(process.env.LINQ_POLL_INTERVAL || '3000', 10)
const seenMessageIds = new Set<string>()
let lastPollTime = new Date().toISOString()

async function pollForMessages(): Promise<void> {
  try {
    // Get chats for this phone number
    const chatsResp = await fetch(`${config.apiUrl}/chats?from=${encodeURIComponent(config.fromPhone)}&limit=10`, {
      headers: { 'Authorization': `Bearer ${config.token}` },
    })
    if (!chatsResp.ok) return

    const chatsData = await chatsResp.json() as any
    const chats = chatsData.chats || []

    for (const chat of chats) {
      const chatId = chat.id
      // Get recent messages in this chat
      const msgsResp = await fetch(`${config.apiUrl}/chats/${chatId}/messages?limit=5`, {
        headers: { 'Authorization': `Bearer ${config.token}` },
      })
      if (!msgsResp.ok) continue

      const msgsData = await msgsResp.json() as any
      const messages = msgsData.messages || []

      for (const msg of messages) {
        // Skip if already seen
        if (seenMessageIds.has(msg.id)) continue
        seenMessageIds.add(msg.id)

        // Skip our own outbound messages
        if (msg.is_from_me) continue

        // Skip old messages (before channel started)
        const msgTime = new Date(msg.sent_at || msg.created_at || 0)
        const startTime = new Date(lastPollTime)
        if (msgTime < startTime) continue

        // Text is in parts[0].value, not msg.text
        const messageText = msg.parts?.[0]?.value || msg.text || ''
        if (!messageText) continue

        // Extract sender
        const sender = msg.from || msg.from_handle?.handle || chat.handles?.find((h: any) => !h.is_me)?.handle || ''

        // Access control — re-read on every message so skill changes take effect live
        const access = loadAccessConfig()

        if (access.dmPolicy === 'disabled') {
          console.error(`[imessage] Dropped (policy: disabled)`)
          continue
        }

        const isAllowed = access.dmPolicy === 'open' ||
          access.allowFrom.includes(sender) ||
          (config.allowedSenders.size > 0 && config.allowedSenders.has(sender))

        if (!isAllowed) {
          if (access.dmPolicy === 'pairing') {
            // Generate pairing code and reply
            const code = generatePairingCode()
            access.pendingPairings[code] = { phone: sender, createdAt: new Date().toISOString() }
            saveAccessConfig(access)
            // Reply with pairing code via Linq API
            try {
              await linqApiCall(`chats/${chatId}/messages`, {
                message: { parts: [{ type: 'text', value: `Pairing code: ${code}\nGive this to the Claude Code operator to approve your access.` }] },
              })
            } catch {}
            console.error(`[imessage] Pairing code ${code} sent to ${sender}`)
          } else {
            console.error(`[imessage] Dropped message from ${sender} (not in allowlist)`)
          }
          continue
        }

        // Ack reaction
        if (access.ackReaction && msg.id) {
          try {
            await linqApiCall(`chats/${chatId}/messages/${msg.id}/react`, { reaction: access.ackReaction })
          } catch {}
        }

        // Auto read receipt + typing indicator
        markRead(chatId)
        startTyping(chatId)

        // Push to Claude Code
        await mcp.notification({
          method: 'notifications/claude/channel',
          params: {
            content: messageText,
            meta: {
              sender,
              chat_id: chatId,
              message_id: msg.id,
            },
          },
        })

        console.error(`[imessage] ${sender}: ${messageText.substring(0, 80)}`)
      }
    }

    // Cap the seen set size
    if (seenMessageIds.size > 1000) {
      const arr = [...seenMessageIds]
      arr.splice(0, arr.length - 500)
      seenMessageIds.clear()
      arr.forEach(id => seenMessageIds.add(id))
    }
  } catch (e: any) {
    console.error(`[imessage] Poll error: ${e.message}`)
  }
}

// --- Auto Contact Card Setup ---

const CLAUDE_CODE_LOGO = 'https://storage.googleapis.com/sm-artworks/be75b541-e429-4b61-a058-6a04bc35f712/customer_file_small.png'

async function setupContactCard(): Promise<void> {
  if (!config.fromPhone || !config.token) return

  try {
    // Check if contact card already exists
    const getResp = await fetch(
      `${config.apiUrl}/contact_card?phone_number=${encodeURIComponent(config.fromPhone)}`,
      { headers: { 'Authorization': `Bearer ${config.token}` } }
    )

    if (getResp.ok) {
      const data = await getResp.json() as any
      const cards = data.contact_cards || []
      const existing = cards.find((c: any) => c.phone_number === config.fromPhone && c.is_active)

      if (existing && existing.first_name === 'Claude' && existing.last_name === 'Code') {
        console.error(`[imessage]   Contact card already set: Claude Code`)
        return
      }
    }

    // Create or update contact card
    const resp = await fetch(`${config.apiUrl}/contact_card`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone_number: config.fromPhone,
        first_name: 'Claude',
        last_name: 'Code',
        image_url: CLAUDE_CODE_LOGO,
      }),
    })

    if (resp.ok) {
      console.error(`[imessage]   Contact card set: Claude Code`)
    } else {
      const err = await resp.text()
      console.error(`[imessage]   Contact card setup failed: ${err}`)
    }
  } catch (e: any) {
    console.error(`[imessage]   Contact card setup error: ${e.message}`)
  }
}

// Also keep the webhook listener as a fallback
const webhookServer = http.createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end('Method not allowed')
    return
  }

  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const body = Buffer.concat(chunks).toString()

  try {
    const event = JSON.parse(body)
    const data = event.data || event
    const messageText = data.message?.text || data.text || ''
    const sender = data.message?.from || data.from || ''
    const chatId = data.chat?.id || data.chat_id || ''
    const messageId = data.message?.id || ''

    if (!messageText) { res.writeHead(200); res.end('ok'); return }
    if (messageId) seenMessageIds.add(messageId) // prevent duplicate from polling

    const access = loadAccessConfig()
    if (access.dmPolicy === 'disabled') { res.writeHead(200); res.end('ok'); return }
    const isAllowed = access.dmPolicy === 'open' || access.allowFrom.includes(sender)
    if (!isAllowed) { res.writeHead(200); res.end('ok'); return }

    if (chatId) { markRead(chatId); startTyping(chatId) }

    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: messageText,
        meta: { sender, chat_id: chatId, message_id: messageId },
      },
    })
    console.error(`[imessage] webhook: ${sender}: ${messageText.substring(0, 80)}`)
  } catch (e: any) {
    console.error(`[imessage] Webhook error: ${e.message}`)
  }

  res.writeHead(200)
  res.end('ok')
})

webhookServer.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[imessage]   Webhook: port ${config.webhookPort} in use, skipping (polling still active)`)
  } else {
    console.error(`[imessage]   Webhook error: ${err.message}`)
  }
})

webhookServer.listen(config.webhookPort, '127.0.0.1', () => {
  console.error(`[imessage]   Webhook: http://127.0.0.1:${config.webhookPort} (fallback)`)
})

// --- Startup (runs regardless of webhook) ---

const startupAccess = loadAccessConfig()

console.error(`[imessage] Channel ready`)
console.error(`[imessage]   Policy:  ${startupAccess.dmPolicy}`)
console.error(`[imessage]   Polling: every ${startupAccess.pollInterval || POLL_INTERVAL}ms`)
console.error(`[imessage]   From:    ${config.fromPhone}`)
console.error(`[imessage]   API:     ${config.apiUrl}`)
if (startupAccess.allowFrom.length > 0) {
  console.error(`[imessage]   Allowed: ${startupAccess.allowFrom.join(', ')}`)
}

setupContactCard()

setInterval(pollForMessages, startupAccess.pollInterval || POLL_INTERVAL)
console.error(`[imessage]   Polling started`)

setTimeout(async () => {
  const recipient = config.defaultRecipient || startupAccess.defaultRecipient || (startupAccess.allowFrom.length > 0 ? startupAccess.allowFrom[0] : '')
  if (recipient) {
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: `Channel connected. Send a greeting NOW by calling the send tool with to="${recipient}" and a brief message like "Hey, Claude Code is online. Text me anything."`,
        meta: {
          sender: 'system',
          event_type: 'channel_ready',
          recipient,
        },
      },
    })
  } else if (!config.token || !config.fromPhone) {
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: 'Channel connected but Linq is not configured. Tell the user to run:\n1. /imessage:configure <token> — set their Linq API token\n2. /imessage:configure <phone> — set their Linq phone number\nGet a token at https://zero.linqapp.com/api-tooling/ or run `linq signup` for a sandbox.',
        meta: { sender: 'system', event_type: 'setup_required' },
      },
    })
  } else {
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: 'Channel connected but no recipient phone number is configured. Ask the user: "What\'s your phone number? I\'ll text you to confirm the connection." Then use the send tool with their number. Remember the number for future messages.',
        meta: { sender: 'system', event_type: 'channel_ready_no_recipient' },
      },
    })
  }
}, 2000)
