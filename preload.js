const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('browser', {
  onBlockerReady: (cb) => ipcRenderer.on('blocker-ready', () => cb()),
  auth: {
    check:       ()     => ipcRenderer.invoke('auth-check'),
    fingerprint: ()     => ipcRenderer.invoke('auth-fingerprint'),
  },
  vpn: {
    providers:   ()     => ipcRenderer.invoke('vpn-providers'),
    getProvider: ()     => ipcRenderer.invoke('vpn-get-provider'),
    setProvider: (id)   => ipcRenderer.invoke('vpn-set-provider', id),
    countries:   ()     => ipcRenderer.invoke('vpn-countries'),
    status:      ()     => ipcRenderer.invoke('vpn-status'),
    connect:     (code) => ipcRenderer.invoke('vpn-connect', code),
    disconnect:  ()     => ipcRenderer.invoke('vpn-disconnect'),
  },
  blocker: {
    getWhitelist:  ()       => ipcRenderer.invoke('blocker-get-whitelist'),
    addSite:       (domain) => ipcRenderer.invoke('blocker-add-site', domain),
    removeSite:    (domain) => ipcRenderer.invoke('blocker-remove-site', domain),
    isWhitelisted: (domain) => ipcRenderer.invoke('blocker-is-whitelisted', domain),
  }
})
