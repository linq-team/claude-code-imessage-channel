#!/usr/bin/env node
/**
 * Post-build: set up Linq credentials (if missing) and register
 * the iMessage channel in Claude Code's global MCP config.
 *
 * Runs automatically after `npm run build`.
 * Zero external dependencies — uses the same APIs as linq-cli directly.
 */
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const HOME = process.env.HOME || process.env.USERPROFILE || ''
const LINQ_CONFIG_PATH = path.join(HOME, '.linq', 'config.json')
const CLAUDE_SETTINGS_PATH = path.join(HOME, '.claude', 'settings.json')
const CHANNEL_ENTRYPOINT = path.resolve('dist/channel.js')

const GITHUB_CLIENT_ID = 'Ov23lifn0bcZx3W7pmqr'
const SANDBOX_API_URL = 'https://webhook.linqapp.com/sandbox'

// --- Helpers ---

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()) }))
}

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function saveJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n')
}

function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

// --- Linq Config ---

function hasLinqCreds() {
  const config = loadJson(LINQ_CONFIG_PATH)
  if (!config?.profiles) return false
  const profileName = config.profile || 'default'
  const profile = config.profiles[profileName] || config.profiles.sandbox
  return !!(profile?.token && profile?.fromPhone)
}

// --- GitHub Device OAuth ---

async function githubDeviceAuth() {
  const codeRes = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: 'read:user user:email' }),
  })

  if (!codeRes.ok) throw new Error('failed to start github auth')
  const { device_code, user_code, verification_uri, interval } = await codeRes.json()

  console.log(`\n[imessage] open this URL: ${verification_uri}`)
  console.log(`[imessage] enter code:    ${user_code}\n`)

  try {
    const { exec } = await import('node:child_process')
    exec(`open "${verification_uri}"`)
  } catch {}

  const deadline = Date.now() + 10 * 60 * 1000
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, (interval || 5) * 1000))

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })

    const data = await tokenRes.json()
    if (data.access_token) return data.access_token
    if (data.error === 'authorization_pending' || data.error === 'slow_down') continue
    if (data.error === 'expired_token' || data.error === 'access_denied') break
  }

  throw new Error('github auth timed out or was denied')
}

// --- Sandbox Signup ---

async function createSandbox(githubToken, phone) {
  const res = await fetch(`${SANDBOX_API_URL}/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ githubToken, phone }),
  })

  if (!res.ok) {
    let msg = 'sandbox creation failed'
    try {
      const err = await res.json()
      msg = err.message || err.error || msg
    } catch {}
    throw new Error(msg)
  }

  return await res.json()
}

// --- Sign In (existing API token) ---

async function doSignIn() {
  const token = await prompt('[imessage] API token: ')
  if (!token) throw new Error('token required')

  const fromPhone = await prompt('[imessage] your Linq phone number (e.g. +12025551234): ')
  if (!fromPhone) throw new Error('phone number required')
  const normalized = normalizePhone(fromPhone)

  const rawRecipient = await prompt('[imessage] your personal phone number (to receive texts): ')
  const recipient = rawRecipient ? normalizePhone(rawRecipient) : ''

  const config = loadJson(LINQ_CONFIG_PATH) || { version: 2, profile: 'default', profiles: {} }
  config.profiles = config.profiles || {}
  config.profiles.default = {
    token: token.trim(),
    fromPhone: normalized,
    ...(recipient && { defaultRecipient: recipient }),
  }
  config.profile = 'default'
  saveJson(LINQ_CONFIG_PATH, config)

  console.log(`[imessage] saved to ~/.linq/config.json\n`)
  return recipient
}

// --- Sign Up (sandbox via GitHub) ---

async function doSignup() {
  const githubToken = await githubDeviceAuth()
  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${githubToken}` },
  })
  const ghUser = await userRes.json()
  console.log(`[imessage] authenticated as @${ghUser.login}\n`)

  const rawPhone = await prompt('[imessage] your phone number (e.g. +12025551234): ')
  if (!rawPhone) throw new Error('phone number required')
  const phone = normalizePhone(rawPhone)

  console.log('[imessage] creating sandbox...')
  const data = await createSandbox(githubToken, phone)

  const config = loadJson(LINQ_CONFIG_PATH) || { version: 2, profile: 'sandbox', profiles: {} }
  config.profiles = config.profiles || {}
  config.profiles.sandbox = {
    token: data.token,
    fromPhone: data.sandboxPhone,
    partnerId: data.partnerId,
    expiresAt: data.expiresAt,
    githubLogin: data.githubLogin,
    defaultRecipient: phone,
  }
  config.profile = 'sandbox'
  saveJson(LINQ_CONFIG_PATH, config)

  console.log(`[imessage] sandbox number: ${data.sandboxPhone}`)
  console.log(`[imessage] expires: ${new Date(data.expiresAt).toLocaleTimeString()}`)
  console.log(`[imessage] saved to ~/.linq/config.json\n`)

  return phone
}

// --- Auth Menu ---

async function doAuth() {
  console.log('[imessage] no linq credentials found\n')
  console.log('  1) Sign up  — get a free sandbox number via GitHub (3hr expiry)')
  console.log('  2) Sign in  — use an existing API token\n')

  const choice = await prompt('[imessage] choose (1 or 2): ')

  if (choice === '2') {
    return await doSignIn()
  }
  return await doSignup()
}

// --- Claude Code MCP Registration ---

function registerMcpServer() {
  let settings = loadJson(CLAUDE_SETTINGS_PATH) || {}
  if (!settings.mcpServers) settings.mcpServers = {}

  const existing = settings.mcpServers.imessage
  if (existing && existing.args?.[0] === CHANNEL_ENTRYPOINT) {
    console.log('[imessage] already registered in ~/.claude/settings.json')
    return
  }

  settings.mcpServers.imessage = {
    command: 'node',
    args: [CHANNEL_ENTRYPOINT],
  }

  saveJson(CLAUDE_SETTINGS_PATH, settings)
  console.log(`[imessage] registered in ~/.claude/settings.json`)
  console.log(`[imessage]   entrypoint: ${CHANNEL_ENTRYPOINT}`)
}

// --- Main ---

async function main() {
  let defaultRecipient = ''

  if (!hasLinqCreds()) {
    try {
      defaultRecipient = await doAuth()
    } catch (e) {
      console.error(`[imessage] signup failed: ${e.message}`)
      console.error('[imessage] you can configure manually later — see /imessage:configure')
    }
  } else {
    console.log('[imessage] linq credentials found')
  }

  registerMcpServer()
}

main()
