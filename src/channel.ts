#!/usr/bin/env node
/**
 * iMessage Channel for Claude Code
 * Powered by Linq (https://linqapp.com)
 *
 * Two-way bridge: text your Linq number from iMessage and it pushes
 * into your Claude Code session. Claude replies back via iMessage.
 *
 * Setup:
 *   1. Get a Linq API token from https://zero.linqapp.com/api-tooling/
 *   2. Set LINQ_TOKEN and LINQ_FROM_PHONE environment variables
 *   3. Create a webhook subscription pointing to this server's port
 *   4. Start Claude Code with --dangerously-load-development-channels server:imessage
 *
 * Architecture:
 *   iMessage -> Linq -> webhook POST -> this server -> Claude Code session
 *   Claude reply -> Linq API -> iMessage -> your phone
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
  allowedSenders: Set<string>
}

function loadChannelConfig(): ChannelConfig {
  // Try config file first, then env vars
  let token = process.env.LINQ_TOKEN || ''
  let fromPhone = process.env.LINQ_FROM_PHONE || ''
  let apiUrl = process.env.LINQ_API_URL || 'https://api.linqapp.com/v3'

  const configPath = path.join(process.env.HOME || '', '.linq', 'config.json')
  if (fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      const profileName = process.env.LINQ_PROFILE || raw.profile || 'default'
      const profile = raw.profiles?.[profileName]
      if (profile) {
        token = token || profile.token || ''
        fromPhone = fromPhone || profile.fromPhone || ''
        if (profile.apiUrl) apiUrl = profile.apiUrl
      }
    } catch {}
  }

  return {
    token,
    fromPhone,
    apiUrl,
    webhookPort: parseInt(process.env.LINQ_CHANNEL_PORT || '9998', 10),
    allowedSenders: new Set(
      (process.env.LINQ_ALLOWED_SENDERS || '').split(',').filter(Boolean)
    ),
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
      // Stop typing before sending
      await stopTyping(chat_id)
      const resp = await linqApiCall(`chats/${chat_id}/messages`, {
        message: { parts: [{ type: 'text', value: text }] },
      })
      if (!resp.ok) {
        const err = await resp.text()
        return { content: [{ type: 'text' as const, text: `Failed: ${err}` }], isError: true }
      }
      return { content: [{ type: 'text' as const, text: 'sent via iMessage' }] }
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

        // Sender gating
        if (config.allowedSenders.size > 0 && !config.allowedSenders.has(sender)) {
          console.error(`[imessage] Dropped message from ${sender} (not in allowlist)`)
          continue
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

    if (config.allowedSenders.size > 0 && !config.allowedSenders.has(sender)) {
      res.writeHead(200); res.end('ok'); return
    }

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

webhookServer.listen(config.webhookPort, '127.0.0.1', () => {
  console.error(`[imessage] Channel ready`)
  console.error(`[imessage]   Polling: every ${POLL_INTERVAL}ms`)
  console.error(`[imessage]   Webhook: http://127.0.0.1:${config.webhookPort} (fallback)`)
  console.error(`[imessage]   From:    ${config.fromPhone}`)
  console.error(`[imessage]   API:     ${config.apiUrl}`)
  if (config.allowedSenders.size > 0) {
    console.error(`[imessage]   Allowed: ${[...config.allowedSenders].join(', ')}`)
  }

  // Start polling loop
  setInterval(pollForMessages, POLL_INTERVAL)
  console.error(`[imessage]   Polling started`)

  // Notify Claude that the channel is ready so it can greet the user
  setTimeout(async () => {
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: 'Channel connected. Send a greeting to the user via iMessage to let them know you are online and ready.',
        meta: { sender: 'system', event_type: 'channel_ready' },
      },
    })
  }, 2000)
})
