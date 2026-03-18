const { app, BrowserWindow, ipcMain, session, systemPreferences } = require('electron')
const { ElectronBlocker } = require('@cliqz/adblocker-electron')
const { exec } = require('child_process')
const path = require('path')

const DEFAULT_WHITELIST = [
  "youtube.com", "www.youtube.com", "youtu.be",
  "twitter.com", "x.com", "www.x.com",
  "twimg.com", "t.co",
  "reddit.com", "www.reddit.com", "redd.it",
  "instagram.com", "www.instagram.com",
  "facebook.com", "www.facebook.com",
]

const userWhitelist = new Set()

const VPN_PROVIDERS = {
  proton:     { name: 'ProtonVPN',   icon: '🟣' },
  nord:       { name: 'NordVPN',     icon: '🔵' },
  expressvpn: { name: 'ExpressVPN',  icon: '🔴' },
  mullvad:    { name: 'Mullvad',     icon: '⚪' },
}

const EXPRESSVPN_PROFILE = 'ExpressVPN Lightway'

let currentProvider = 'proton'

const COUNTRIES = [
  { code: 'us', name: 'USA',         flag: '🇺🇸' },
  { code: 'gb', name: 'UK',          flag: '🇬🇧' },
  { code: 'de', name: 'Germany',     flag: '🇩🇪' },
  { code: 'nl', name: 'Netherlands', flag: '🇳🇱' },
  { code: 'jp', name: 'Japan',       flag: '🇯🇵' },
]

function run(cmd) {
  return new Promise(resolve => exec(cmd, (err, stdout) => resolve(err ? '' : stdout.trim())))
}

// ── Auth ─────────────────────────────────────────────────────
ipcMain.handle('auth-check', () => {
  try {
    return systemPreferences.canPromptTouchID()
  } catch {
    return false
  }
})

ipcMain.handle('auth-fingerprint', async () => {
  try {
    await systemPreferences.promptTouchID('unlock BR0WSR')
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('vpn-countries', () => COUNTRIES)

ipcMain.handle('vpn-providers', () => {
  return Object.entries(VPN_PROVIDERS).map(([id, p]) => ({ id, name: p.name, icon: p.icon }))
})

ipcMain.handle('vpn-get-provider', () => currentProvider)

ipcMain.handle('vpn-set-provider', (_, providerId) => {
  if (VPN_PROVIDERS[providerId]) {
    currentProvider = providerId
    return 'ok'
  }
  return 'error'
})

ipcMain.handle('vpn-status', async () => {
  switch (currentProvider) {
    case 'proton': {
      const out = await run('protonvpn-cli status')
      if (out.includes('Connected') || out.includes('Status:     Connected')) return 'Connected'
      if (out.includes('Connecting')) return 'Connecting'
      return 'Disconnected'
    }
    case 'nord': {
      const out = await run('nordvpn status')
      if (out.includes('Connected') || out.includes('Status: Connected')) return 'Connected'
      if (out.includes('Connecting')) return 'Connecting'
      return 'Disconnected'
    }
    case 'expressvpn': {
      const out = await run('scutil --nc list')
      for (const line of out.split('\n')) {
        if (line.includes(EXPRESSVPN_PROFILE)) {
          if (line.includes('(Connected)'))     return 'Connected'
          if (line.includes('(Connecting)'))    return 'Connecting'
          if (line.includes('(Disconnecting)')) return 'Disconnecting'
        }
      }
      return 'Disconnected'
    }
    case 'mullvad': {
      const out = await run('mullvad status')
      if (out.includes('Connected')) return 'Connected'
      if (out.includes('Connecting')) return 'Connecting'
      return 'Disconnected'
    }
    default:
      return 'Disconnected'
  }
})

ipcMain.handle('vpn-connect', async (_, countryCode) => {
  switch (currentProvider) {
    case 'proton':
      await run(`protonvpn-cli connect --cc ${countryCode.toUpperCase()}`)
      break
    case 'nord':
      await run(`nordvpn connect ${countryCode.toUpperCase()}`)
      break
    case 'expressvpn':
      await run(`open "expressvpn://"`)
      await new Promise(r => setTimeout(r, 800))
      await run(`scutil --nc start "${EXPRESSVPN_PROFILE}"`)
      break
    case 'mullvad':
      await run(`mullvad relay set location ${countryCode.toLowerCase()}`)
      await run('mullvad connect')
      break
  }
})

ipcMain.handle('vpn-disconnect', async () => {
  switch (currentProvider) {
    case 'proton':
      await run('protonvpn-cli disconnect')
      break
    case 'nord':
      await run('nordvpn disconnect')
      break
    case 'expressvpn':
      await run(`scutil --nc stop "${EXPRESSVPN_PROFILE}"`)
      break
    case 'mullvad':
      await run('mullvad disconnect')
      break
  }
})

// ── Blocker whitelist ────────────────────────────────────────
ipcMain.handle('blocker-get-whitelist', () => [...userWhitelist])

ipcMain.handle('blocker-add-site', (_, domain) => {
  userWhitelist.add(domain)
  return 'ok'
})

ipcMain.handle('blocker-remove-site', (_, domain) => {
  userWhitelist.delete(domain)
  return 'ok'
})

ipcMain.handle('blocker-is-whitelisted', (_, domain) => {
  if (DEFAULT_WHITELIST.some(d => domain === d || domain.endsWith('.' + d))) return true
  if ([...userWhitelist].some(d => domain === d || domain.endsWith('.' + d))) return true
  return false
})

let win

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1200, height: 800,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js'),
    }
  })

  win.loadFile('index.html')

  ElectronBlocker.fromPrebuiltAdsAndTracking(fetch).then(blocker => {
    // Single webRequest handler: whitelist passes through, everything else checked by blocker
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      try {
        const host = new URL(details.url).hostname
        const isWhitelisted =
          DEFAULT_WHITELIST.some(d => host === d || host.endsWith('.' + d)) ||
          [...userWhitelist].some(d => host === d || host.endsWith('.' + d))
        if (isWhitelisted) { callback({ cancel: false }); return }
        const { match } = blocker.match({ type: 'main_frame', url: details.url, originUrl: details.referrer || '' })
        callback({ cancel: !!match })
      } catch {
        callback({ cancel: false })
      }
    })
    app.on('session-created', s => blocker.enableBlockingInSession(s))
    console.log('[blocker] active with whitelist support')
  }).catch(err => console.error('[blocker] error:', err))
})

app.on('window-all-closed', () => app.quit())
