import { create } from 'zustand'
import type { Vault, VaultData, Note, Settings, ProxyCredential, ProxyRule, ProxyBinding, ProxyProposal, ProxyAgent, ProxyInvite, AuditEntry, ProxyStatus } from './types'

interface VaultState {
  currentVault: Vault | null
  vaultData: VaultData | null
  encryptionKey: string | null
  isUnlocked: boolean
  lastActivity: number
  autoLockMinutes: number
  // Settings from backend
  settings: Settings
  // SSH Agent state
  agentKeys: { fingerprint: string; comment: string; key_type: string }[]
  isAgentLoading: boolean

  unlock: (vault: Vault, data: VaultData, key: string) => void
  lock: () => void
  setVaultData: (data: VaultData) => void
  setCurrentVault: (vault: Vault | null) => void
  touchActivity: () => void
  setAutoLockMinutes: (minutes: number) => void
  setSettings: (settings: Settings) => void
  setAgentKeys: (keys: { fingerprint: string; comment: string; key_type: string }[]) => void
  setAgentLoading: (loading: boolean) => void

  // Notes CRUD
  addNote: (note: Omit<Note, 'id' | 'created'>) => void
  updateNote: (id: string, updates: Partial<Note>) => void
  deleteNote: (id: string) => void

  // SSH Key analytics tracking
  recordKeyCopy: (keyId: string) => void
  recordKeyUsage: (keyId: string) => void

  // PGP Key CRUD
  addPgpKey: (key: import('./types').PgpKey) => void
  deletePgpKey: (id: string) => void

  // Favorites / pinning
  togglePinSsh: (id: string) => void
  togglePinApi: (id: string) => void
  togglePinPgp: (id: string) => void

  // Agent Chest proxy state
  proxyStatus: ProxyStatus | null
  proxyCredentials: ProxyCredential[]
  proxyRules: ProxyRule[]
  proxyBindings: ProxyBinding[]
  proxyProposals: ProxyProposal[]
  proxyAgents: ProxyAgent[]
  proxyInvites: ProxyInvite[]
  proxyAuditLog: AuditEntry[]
  setProxyStatus: (status: ProxyStatus | null) => void
  setProxyCredentials: (creds: ProxyCredential[]) => void
  setProxyRules: (rules: ProxyRule[]) => void
  setProxyBindings: (bindings: ProxyBinding[]) => void
  setProxyProposals: (proposals: ProxyProposal[]) => void
  setProxyAgents: (agents: ProxyAgent[]) => void
  setProxyInvites: (invites: ProxyInvite[]) => void
  setProxyAuditLog: (entries: AuditEntry[]) => void
}

const defaultSettings: Settings = {
  auto_lock_minutes: 5,
  theme: 'dark',
  default_ssh_key_type: 'ed25519',
  reveal_on_hover: false,
  strict_no_file_write_mode: true,
}

export const useVaultStore = create<VaultState>((set, get) => ({
  currentVault: null,
  vaultData: null,
  encryptionKey: null,
  isUnlocked: false,
  lastActivity: Date.now(),
  autoLockMinutes: 5,
  settings: defaultSettings,
  agentKeys: [],
  isAgentLoading: false,

  proxyStatus: null,
  proxyCredentials: [],
  proxyRules: [],
  proxyBindings: [],
  proxyProposals: [],
  proxyAgents: [],
  proxyInvites: [],
  proxyAuditLog: [],

  unlock: (vault, data, key) => set({
    currentVault: vault,
    vaultData: data,
    encryptionKey: key,
    isUnlocked: true,
    lastActivity: Date.now(),
  }),

  lock: () => set({
    currentVault: null,
    vaultData: null,
    encryptionKey: null,
    isUnlocked: false,
    agentKeys: [],
  }),

  setVaultData: (data: VaultData) => {
    // Ensure pgp_keys is always defined (for old vault data)
    if (!data.pgp_keys) {
      data.pgp_keys = []
    }
    set({ vaultData: data, lastActivity: Date.now() })
  },
  setCurrentVault: (vault) => set({ currentVault: vault }),
  touchActivity: () => set({ lastActivity: Date.now() }),
  setAutoLockMinutes: (minutes) => set({ autoLockMinutes: minutes }),
  setSettings: (settings) => set({ settings }),
  setAgentKeys: (keys) => set({ agentKeys: keys }),
  setAgentLoading: (loading) => set({ isAgentLoading: loading }),

  // Notes CRUD operations
  addNote: (note) => {
    const { vaultData } = get()
    if (!vaultData) return
    const newNote: Note = {
      ...note,
      id: crypto.randomUUID(),
      created: new Date().toISOString(),
    }
    set({
      vaultData: { ...vaultData, notes: [...vaultData.notes, newNote] },
      lastActivity: Date.now(),
    })
  },

  updateNote: (id, updates) => {
    const { vaultData } = get()
    if (!vaultData) return
    set({
      vaultData: {
        ...vaultData,
        notes: vaultData.notes.map((n) =>
          n.id === id ? { ...n, ...updates } : n
        ),
      },
      lastActivity: Date.now(),
    })
  },

  deleteNote: (id) => {
    const { vaultData } = get()
    if (!vaultData) return
    set({
      vaultData: {
        ...vaultData,
        notes: vaultData.notes.filter((n) => n.id !== id),
      },
      lastActivity: Date.now(),
    })
  },

  // SSH Key analytics
  recordKeyCopy: (keyId) => {
    const { vaultData } = get()
    if (!vaultData) return
    set({
      vaultData: {
        ...vaultData,
        keys: vaultData.keys.map((k) =>
          k.id === keyId
            ? {
                ...k,
                copied_count: (k.copied_count || 0) + 1,
                last_copied_at: new Date().toISOString(),
              }
            : k
        ),
      },
      lastActivity: Date.now(),
    })
  },

  recordKeyUsage: (keyId) => {
    const { vaultData } = get()
    if (!vaultData) return
    set({
      vaultData: {
        ...vaultData,
        keys: vaultData.keys.map((k) =>
          k.id === keyId
            ? { ...k, last_used_at: new Date().toISOString() }
            : k
        ),
      },
      lastActivity: Date.now(),
    })
  },

  // PGP Key CRUD
  addPgpKey: (key) => {
    const { vaultData } = get()
    if (!vaultData) return
    const pgp_keys = vaultData.pgp_keys || []
    set({
      vaultData: { ...vaultData, pgp_keys: [...pgp_keys, key] },
      lastActivity: Date.now(),
    })
  },

  deletePgpKey: (id) => {
    const { vaultData } = get()
    if (!vaultData) return
    set({
      vaultData: {
        ...vaultData,
        pgp_keys: (vaultData.pgp_keys || []).filter((k) => k.id !== id),
      },
      lastActivity: Date.now(),
    })
  },

  // Favorites / pinning
  togglePinSsh: (id: string) => {
    const { vaultData } = get()
    if (!vaultData) return
    set({
      vaultData: {
        ...vaultData,
        keys: vaultData.keys.map((k) =>
          k.id === id ? { ...k, pinned: !k.pinned } : k
        ),
      },
      lastActivity: Date.now(),
    })
  },

  togglePinApi: (id: string) => {
    const { vaultData } = get()
    if (!vaultData) return
    set({
      vaultData: {
        ...vaultData,
        api_keys: vaultData.api_keys.map((k) =>
          k.id === id ? { ...k, pinned: !k.pinned } : k
        ),
      },
      lastActivity: Date.now(),
    })
  },

  togglePinPgp: (id: string) => {
    const { vaultData } = get()
    if (!vaultData) return
    set({
      vaultData: {
        ...vaultData,
        pgp_keys: (vaultData.pgp_keys || []).map((k) =>
          k.id === id ? { ...k, pinned: !k.pinned } : k
        ),
      },
      lastActivity: Date.now(),
    })
  },

  setProxyStatus: (status) => set({ proxyStatus: status }),
  setProxyCredentials: (creds) => set({ proxyCredentials: creds }),
  setProxyRules: (rules) => set({ proxyRules: rules }),
  setProxyBindings: (bindings) => set({ proxyBindings: bindings }),
  setProxyProposals: (proposals) => set({ proxyProposals: proposals }),
  setProxyAgents: (agents) => set({ proxyAgents: agents }),
  setProxyInvites: (invites) => set({ proxyInvites: invites }),
  setProxyAuditLog: (entries) => set({ proxyAuditLog: entries }),
}))
