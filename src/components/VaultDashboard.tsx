import { useState, useEffect, useMemo, memo } from 'react'
import {
  Lock, Plus, Copy, Eye, EyeOff, Trash2,
  Key as KeyIcon, Globe, Terminal, Sparkles,
  Check, Search, Fingerprint, Download, Upload,
  Settings, X, Shield, Star
} from 'lucide-react'
import { useVaultStore } from '../lib/store'
import { vaultSave, aesEncrypt, sshGenerateKey, sshImportKeys, biometricAvailable, pgpGenerateKey, pgpImportKey } from '../lib/api'
import type { SshKey, ApiKey, ImportedKey, PgpKey } from '../lib/types'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { ErrorBoundary } from './ErrorBoundary'

// ── Toast System ──────────────────────────────────────────────────────────────

interface Toast {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
}

let toastId = 0
const toastListeners: Set<(t: Toast) => void> = new Set()

export function toast(message: string, type: Toast['type'] = 'info') {
  const t: Toast = { id: `t-${++toastId}`, message, type }
  toastListeners.forEach(fn => fn(t))
  setTimeout(() => {
    const dismiss: Toast = { ...t, id: `d-${t.id}` }
    toastListeners.forEach(fn => fn(dismiss))
  }, 2500)
}

function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const handler = (t: Toast) => {
      if (t.id.startsWith('d-')) {
        setToasts(prev => prev.filter(x => `d-${x.id}` !== t.id))
      } else {
        setToasts(prev => [...prev, t])
      }
    }
    toastListeners.add(handler)
    return () => { toastListeners.delete(handler) }
  }, [])

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={`animate-slideUp px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg pointer-events-auto ${
          t.type === 'success' ? 'bg-emerald-500 text-white' :
          t.type === 'error' ? 'bg-red-500 text-white' :
          'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-white'
        }`}>
          {t.message}
        </div>
      ))}
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export function VaultDashboard({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const { currentVault, vaultData, encryptionKey, lock, setVaultData, touchActivity, autoLockMinutes, togglePinSsh, togglePinApi, togglePinPgp } = useVaultStore()
  const [activeTab, setActiveTab] = useState<'ssh' | 'api' | 'pgp'>('ssh')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showImportPgpModal, setShowImportPgpModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [hasBiometric, setHasBiometric] = useState(false)

  // Auto-lock timer
  useEffect(() => {
    const interval = setInterval(() => {
      if (autoLockMinutes > 0) {
        const elapsed = (Date.now() - useVaultStore.getState().lastActivity) / 60000
        if (elapsed >= autoLockMinutes) {
          lock()
          toast('Vault locked (auto-lock)', 'info')
        }
      }
    }, 10000)
    return () => clearInterval(interval)
  }, [autoLockMinutes, lock])

  // Touch ID availability
  useEffect(() => {
    biometricAvailable().then(setHasBiometric).catch(() => setHasBiometric(false))
  }, [])

  // Touch activity on any interaction
  useEffect(() => {
    const handler = () => touchActivity()
    window.addEventListener('mousemove', handler)
    window.addEventListener('keydown', handler)
    window.addEventListener('click', handler)
    return () => {
      window.removeEventListener('mousemove', handler)
      window.removeEventListener('keydown', handler)
      window.removeEventListener('click', handler)
    }
  }, [touchActivity])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'n') {
        e.preventDefault()
        setShowAddModal(true)
      }
      if (mod && e.key === 'f') {
        e.preventDefault()
        document.getElementById('search-input')?.focus()
      }
      if (mod && e.key === 'l') {
        e.preventDefault()
        lock()
        toast('Vault locked', 'info')
      }
      if (mod && e.key === '1') {
        e.preventDefault()
        setActiveTab('ssh')
      }
      if (mod && e.key === '2') {
        e.preventDefault()
        setActiveTab('api')
      }
      if (mod && e.key === '3') {
        e.preventDefault()
        setActiveTab('pgp')
      }
      if (e.key === 'Escape') {
        setShowAddModal(false)
        setShowImportModal(false)
        setShowImportPgpModal(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lock])

  if (!currentVault || !vaultData || !encryptionKey) {
    return null
  }

  const toggleReveal = (id: string) => {
    const next = new Set(revealedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setRevealedIds(next)
  }

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await writeText(text)
      setCopiedId(id)
      toast('Copied to clipboard', 'success')
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      // Fallback for dev mode
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      toast('Copied to clipboard', 'success')
      setTimeout(() => setCopiedId(null), 2000)
    }
  }

  const saveData = async (data: typeof vaultData) => {
    const ciphertext = await aesEncrypt(encryptionKey, JSON.stringify(data))
    await vaultSave({ ...currentVault, ciphertext })
    setVaultData(data)
  }

  const addSshKey = async (key: Omit<SshKey, 'id' | 'created'>) => {
    const newKey: SshKey = {
      ...key,
      id: crypto.randomUUID(),
      created: new Date().toISOString(),
    }
    await saveData({ ...vaultData, keys: [...vaultData.keys, newKey] })
    setShowAddModal(false)
    toast('SSH key added', 'success')
  }

  const addApiKey = async (key: Omit<ApiKey, 'id' | 'created'>) => {
    const newKey: ApiKey = {
      ...key,
      id: crypto.randomUUID(),
      created: new Date().toISOString(),
    }
    await saveData({ ...vaultData, api_keys: [...vaultData.api_keys, newKey] })
    setShowAddModal(false)
    toast('API key added', 'success')
  }

  const addPgpKey = async (key: Omit<PgpKey, 'id' | 'created'>) => {
    const newKey: PgpKey = {
      ...key,
      id: crypto.randomUUID(),
      created: new Date().toISOString(),
    }
    await saveData({ ...vaultData, pgp_keys: [...(vaultData.pgp_keys || []), newKey] })
    setShowAddModal(false)
    toast('PGP key added', 'success')
  }

  const deleteSshKey = async (id: string) => {
    await saveData({ ...vaultData, keys: vaultData.keys.filter(k => k.id !== id) })
    toast('SSH key deleted', 'info')
  }

  const deleteApiKey = async (id: string) => {
    await saveData({ ...vaultData, api_keys: vaultData.api_keys.filter(k => k.id !== id) })
    toast('API key deleted', 'info')
  }

  const deletePgpKey = async (id: string) => {
    await saveData({ ...vaultData, pgp_keys: (vaultData.pgp_keys || []).filter(k => k.id !== id) })
    toast('PGP key deleted', 'info')
  }

  // Search filtering + sorting (pinned first)
  const filteredSshKeys = useMemo(() => {
    let keys = searchQuery
      ? vaultData.keys.filter(k =>
          k.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          k.key_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
          k.comment.toLowerCase().includes(searchQuery.toLowerCase()) ||
          k.fingerprint.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : vaultData.keys
    // Sort: pinned first, then by name
    return keys.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      return a.name.localeCompare(b.name)
    })
  }, [vaultData.keys, searchQuery])

  const filteredApiKeys = useMemo(() => {
    let keys = searchQuery
      ? vaultData.api_keys.filter(k =>
          k.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          k.provider.toLowerCase().includes(searchQuery.toLowerCase()) ||
          k.notes.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : vaultData.api_keys
    return keys.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      return a.name.localeCompare(b.name)
    })
  }, [vaultData.api_keys, searchQuery])

  const filteredPgpKeys = useMemo(() => {
    const keys = vaultData.pgp_keys || []
    let filtered = searchQuery
      ? keys.filter(k =>
          k.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          k.algorithm.toLowerCase().includes(searchQuery.toLowerCase()) ||
          k.key_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
          k.fingerprint.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : keys
    return filtered.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      return a.name.localeCompare(b.name)
    })
  }, [vaultData.pgp_keys, searchQuery])

  const handleBiometricLock = async () => {
    // Just lock the vault - don't delete the biometric key
    // The key stays in Keychain for next Touch ID unlock
    lock()
    toast('Vault locked', 'info')
  }

  const handleImportKeys = async (keys: ImportedKey[]) => {
    const newSshKeys: SshKey[] = keys.map(k => ({
      id: crypto.randomUUID(),
      name: k.name,
      key_type: k.key_type,
      comment: k.comment,
      fingerprint: k.fingerprint,
      public_key: k.public_key,
      private_key: k.private_key,
      created: new Date().toISOString(),
    }))
    await saveData({ ...vaultData, keys: [...vaultData.keys, ...newSshKeys] })
    setShowImportModal(false)
    toast(`Imported ${keys.length} key${keys.length > 1 ? 's' : ''}`, 'success')
  }

  const exportVault = () => {
    const data = JSON.stringify(vaultData, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${currentVault.name.replace(/\s+/g, '_')}_export.json`
    a.click()
    URL.revokeObjectURL(url)
    toast('Vault exported', 'success')
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">{currentVault.name}</h1>
            <p className="text-xs text-slate-600 dark:text-slate-500">
              {vaultData.keys.length} SSH · {vaultData.api_keys.length} API · {vaultData.pgp_keys?.length || 0} PGP
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasBiometric && (
              <button
                onClick={handleBiometricLock}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
                title="Lock with Touch ID"
              >
                <Fingerprint className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={exportVault}
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800"
              title="Export vault (Cmd+E)"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={() => onOpenSettings?.()}
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={lock}
              className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800"
              title="Lock vault (Cmd+L)"
            >
              <Lock className="w-4 h-4" />
              Lock
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Search bar */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            id="search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search keys... (Cmd+F)"
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all text-sm dark:bg-slate-900/50 dark:border-slate-800 dark:text-white dark:placeholder-slate-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 mb-6">
          <button
            onClick={() => setActiveTab('ssh')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
              activeTab === 'ssh'
                ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 dark:text-emerald-400'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/50'
            }`}
          >
            <Terminal className="w-4 h-4" />
            SSH Keys ({vaultData.keys.length})
          </button>
          <button
            onClick={() => setActiveTab('api')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
              activeTab === 'api'
                ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 dark:text-emerald-400'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/50'
            }`}
          >
            <Globe className="w-4 h-4" />
            API Keys ({vaultData.api_keys.length})
          </button>
          <button
            onClick={() => setActiveTab('pgp')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
              activeTab === 'pgp'
                ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 dark:text-emerald-400'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/50'
            }`}
          >
            <Shield className="w-4 h-4" />
            PGP Keys ({vaultData.pgp_keys?.length || 0})
          </button>
          <div className="flex-1" />
          {activeTab === 'ssh' && (
            <button
              onClick={() => setShowImportModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-medium rounded-lg transition-all dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/50"
            >
              <Upload className="w-4 h-4" />
              Import
            </button>
          )}
          {activeTab === 'pgp' && (
            <button
              onClick={() => setShowImportPgpModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-medium rounded-lg transition-all dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/50"
            >
              <Upload className="w-4 h-4" />
              Import PGP
            </button>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium rounded-lg transition-all"
            title="Add key (Cmd+N)"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>

        {/* SSH Keys */}
        {activeTab === 'ssh' && (
          <div className="space-y-3">
            {filteredSshKeys.length === 0 ? (
              <EmptyState icon={KeyIcon} message={searchQuery ? 'No matching SSH keys' : 'No SSH keys yet'} />
            ) : (
              filteredSshKeys.map(key => (
                <SshKeyRow
                  key={key.id}
                  sshKey={key}
                  revealed={revealedIds.has(key.id)}
                  copied={copiedId === key.id}
                  onToggleReveal={() => toggleReveal(key.id)}
                  onCopy={() => copyToClipboard(key.private_key || '', key.id)}
                  onCopyPublic={() => copyToClipboard(key.public_key, key.id + '-pub')}
                  onDelete={() => deleteSshKey(key.id)}
                  onTogglePin={() => togglePinSsh(key.id)}
                />
              ))
            )}
          </div>
        )}

        {/* API Keys */}
        {activeTab === 'api' && (
          <div className="space-y-3">
            {filteredApiKeys.length === 0 ? (
              <EmptyState icon={Globe} message={searchQuery ? 'No matching API keys' : 'No API keys yet'} />
            ) : (
              filteredApiKeys.map(key => (
                <ApiKeyRow
                  key={key.id}
                  apiKey={key}
                  revealed={revealedIds.has(key.id)}
                  copied={copiedId === key.id}
                  onToggleReveal={() => toggleReveal(key.id)}
                  onCopy={() => copyToClipboard(key.key, key.id)}
                  onDelete={() => deleteApiKey(key.id)}
                  onTogglePin={() => togglePinApi(key.id)}
                />
              ))
            )}
          </div>
        )}

        {/* PGP Keys */}
        {activeTab === 'pgp' && (
          <div className="space-y-3">
            {filteredPgpKeys.length === 0 ? (
              <EmptyState icon={Shield} message="No PGP keys yet" />
            ) : (
              filteredPgpKeys.map(key => (
                <PgpKeyRow
                  key={key.id}
                  pgpKey={key}
                  revealed={revealedIds.has(key.id)}
                  onToggleReveal={() => toggleReveal(key.id)}
                  onCopyPublic={() => key.public_key && copyToClipboard(key.public_key, key.id)}
                  onCopyPrivate={() => key.private_key && copyToClipboard(key.private_key, key.id)}
                  onDelete={() => deletePgpKey(key.id)}
                  onTogglePin={() => togglePinPgp(key.id)}
                />
              ))
            )}
          </div>
        )}
      </main>

      {/* Modals */}
      {showAddModal && (
        <AddKeyModal
          tab={activeTab}
          onClose={() => setShowAddModal(false)}
          onSaveSsh={addSshKey}
          onSaveApi={addApiKey}
          onSavePgp={addPgpKey}
        />
      )}
      {showImportModal && (
        <ImportKeysModal
          onClose={() => setShowImportModal(false)}
          onImport={handleImportKeys}
        />
      )}
      {showImportPgpModal && (
        <ImportPgpModal
          onClose={() => setShowImportPgpModal(false)}
          onImport={async (key) => {
            const newKey: PgpKey = {
              ...key,
              id: crypto.randomUUID(),
              created: new Date().toISOString(),
            }
            await saveData({ ...vaultData, pgp_keys: [...(vaultData.pgp_keys || []), newKey] })
            setShowImportPgpModal(false)
            toast('PGP key imported', 'success')
          }}
        />
      )}

      <ToastContainer />
    </div>
  </ErrorBoundary>
)
}

// ── Memoized Sub-components ────────────────────────────────────────────────────

const EmptyState = memo(function EmptyState({ icon: Icon, message }: { icon: any; message: string }) {
  return (
    <div className="text-center py-16 border-2 border-dashed border-slate-300 rounded-2xl dark:border-slate-700">
      <Icon className="w-12 h-12 mx-auto mb-4 text-slate-400 dark:text-slate-600" />
      <p className="text-slate-600 dark:text-slate-500">{message}</p>
    </div>
  )
})

const SshKeyRow = memo(function SshKeyRow({
  sshKey, revealed, copied, onToggleReveal, onCopy, onCopyPublic, onDelete, onTogglePin
}: {
  sshKey: SshKey
  revealed: boolean
  copied: boolean
  onToggleReveal: () => void
  onCopy: () => void
  onCopyPublic: () => void
  onDelete: () => void
  onTogglePin: () => void
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-300 transition-colors group dark:bg-slate-900/50 dark:border-slate-800 dark:hover:border-slate-700">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900 truncate dark:text-white">{sshKey.name}</h3>
          <p className="text-sm text-slate-600 truncate dark:text-slate-500">{sshKey.key_type} · {sshKey.fingerprint}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-3">
          <button onClick={onTogglePin} className={`p-2 hover:bg-slate-100 rounded-lg transition-colors dark:hover:bg-slate-800 ${sshKey.pinned ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 hover:text-amber-600 dark:text-slate-400 dark:hover:text-amber-400'}`} title={sshKey.pinned ? 'Unpin' : 'Pin'}>
            <Star className="w-4 h-4" fill={sshKey.pinned ? 'currentColor' : 'none'} />
          </button>
          <button onClick={onToggleReveal} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-slate-900 transition-colors dark:hover:bg-slate-800 dark:text-slate-400 dark:hover:text-white" title={revealed ? 'Hide' : 'Reveal'}>
            {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          <button onClick={onCopy} disabled={!sshKey.private_key} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-slate-900 transition-colors disabled:opacity-30 dark:hover:bg-slate-800 dark:text-slate-400 dark:hover:text-white" title="Copy private key">
            {copied ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
          <button onClick={onDelete} className="p-2 hover:bg-red-500/10 rounded-lg text-slate-600 hover:text-red-600 transition-colors opacity-0 group-hover:opacity-100 dark:text-slate-400 dark:hover:text-red-400" title="Delete">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      {sshKey.comment && <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">{sshKey.comment}</p>}
      {revealed && sshKey.private_key && (
        <div className="bg-slate-100 rounded-lg p-4 font-mono text-xs text-slate-700 overflow-x-auto max-h-48 overflow-y-auto dark:bg-slate-950">
          <pre>{sshKey.private_key}</pre>
        </div>
      )}
      {sshKey.public_key && (
        <div className="mt-3 p-3 bg-slate-100 rounded-lg group/pub dark:bg-slate-800/50">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-slate-600 dark:text-slate-500">Public Key</p>
            <button
              onClick={onCopyPublic}
              className="p-1 text-slate-500 hover:text-slate-700 opacity-0 group-hover/pub:opacity-100 transition-all dark:hover:text-white"
              title="Copy public key"
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
          <code className="text-xs text-slate-700 font-mono break-all dark:text-slate-300">{sshKey.public_key}</code>
        </div>
      )}
    </div>
  )
})

const ApiKeyRow = memo(function ApiKeyRow({
  apiKey, revealed, copied, onToggleReveal, onCopy, onDelete, onTogglePin
}: {
  apiKey: ApiKey
  revealed: boolean
  copied: boolean
  onToggleReveal: () => void
  onCopy: () => void
  onDelete: () => void
  onTogglePin: () => void
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-300 transition-colors group dark:bg-slate-900/50 dark:border-slate-800 dark:hover:border-slate-700">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900 truncate dark:text-white">{apiKey.name}</h3>
          <p className="text-sm text-emerald-600 dark:text-emerald-400">{apiKey.provider}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-3">
          <button onClick={onTogglePin} className={`p-2 hover:bg-slate-100 rounded-lg transition-colors dark:hover:bg-slate-800 ${apiKey.pinned ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 hover:text-amber-600 dark:text-slate-400 dark:hover:text-amber-400'}`} title={apiKey.pinned ? 'Unpin' : 'Pin'}>
            <Star className="w-4 h-4" fill={apiKey.pinned ? 'currentColor' : 'none'} />
          </button>
          <button onClick={onToggleReveal} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-slate-900 transition-colors dark:hover:bg-slate-800 dark:text-slate-400 dark:hover:text-white" title={revealed ? 'Hide' : 'Reveal'}>
            {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          <button onClick={onCopy} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-slate-900 transition-colors dark:hover:bg-slate-800 dark:text-slate-400 dark:hover:text-white" title="Copy API key">
            {copied ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
          <button onClick={onDelete} className="p-2 hover:bg-red-500/10 rounded-lg text-slate-600 hover:text-red-600 transition-colors opacity-0 group-hover:opacity-100 dark:text-slate-400 dark:hover:text-red-400" title="Delete">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      {revealed ? (
        <div className="bg-slate-100 rounded-lg p-4 font-mono text-xs text-slate-700 break-all dark:bg-slate-950">
          {apiKey.key}
        </div>
      ) : (
        <div className="bg-slate-100 rounded-lg p-4 font-mono text-xs text-slate-500 break-all dark:bg-slate-950 dark:text-slate-600">
          {'•'.repeat(Math.min(apiKey.key.length, 40))}
        </div>
      )}
      {apiKey.notes && <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">{apiKey.notes}</p>}
    </div>
  )
})

// ── Add Key Modal ─────────────────────────────────────────────────────────────

function AddKeyModal({
  tab, onClose, onSaveSsh, onSaveApi, onSavePgp
}: {
  tab: 'ssh' | 'api' | 'pgp'
  onClose: () => void
  onSaveSsh: (key: Omit<SshKey, 'id' | 'created'>) => void
  onSaveApi: (key: Omit<ApiKey, 'id' | 'created'>) => void
  onSavePgp: (key: Omit<PgpKey, 'id' | 'created'>) => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [keyData, setKeyData] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [comment, setComment] = useState('')
  const [provider, setProvider] = useState('')
  const [notes, setNotes] = useState('')
  const [keyType, setKeyType] = useState('ed25519')
  const [isGenerating, setIsGenerating] = useState(false)
  const [mode, setMode] = useState<'generate' | 'import'>('generate')

  const generateSshKey = async () => {
    if (!name) return
    setIsGenerating(true)
    try {
      const result = await sshGenerateKey(name, keyType, comment || `${name}@ssh-vault`)
      setPublicKey(result.public_key)
      setKeyData(result.private_key)
      setComment(comment || `${name}@ssh-vault`)
      toast('SSH key generated', 'success')
    } catch (err) {
      toast('Failed to generate SSH key', 'error')
      console.error(err)
    } finally {
      setIsGenerating(false)
    }
  }

  const generatePgpKey = async () => {
    if (!name || !email) return
    setIsGenerating(true)
    try {
      const result = await pgpGenerateKey('', name, email, passphrase)
      toast('PGP key generated', 'success')
      onSavePgp({
        name: result.name,
        fingerprint: result.fingerprint,
        key_id: result.key_id,
        algorithm: result.algorithm,
        bit_length: result.bit_length,
        user_ids: result.user_ids,
        public_key: null,
        private_key: null,
      })
      onClose()
    } catch (err) {
      toast(`Failed to generate PGP key: ${err}`, 'error')
      console.error(err)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (tab === 'ssh') {
      onSaveSsh({
        name: name || 'Unnamed Key',
        key_type: keyData.includes('OPENSSH') ? 'OpenSSH' : 'SSH2',
        comment,
        fingerprint: 'manual',
        public_key: publicKey,
        private_key: keyData || null,
      })
    } else if (tab === 'api') {
      onSaveApi({
        name: name || 'Unnamed API Key',
        provider: provider || 'Custom',
        key: keyData,
        notes,
      })
    }
  }

  const title = tab === 'ssh' ? 'SSH Key' : tab === 'api' ? 'API Key' : 'PGP Key'
  const isPgpImport = tab === 'pgp' && mode === 'import'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={onClose}>
      <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-lg shadow-2xl dark:bg-slate-900 dark:border-slate-800" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Add {title}</h2>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-slate-600 dark:hover:text-white">×</button>
        </div>

        {tab === 'pgp' && (
          <div className="flex gap-2 mb-4">
            <button type="button" onClick={() => setMode('generate')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${mode === 'generate' ? 'bg-violet-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'}`}>
              Generate
            </button>
            <button type="button" onClick={() => setMode('import')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${mode === 'import' ? 'bg-violet-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'}`}>
              Import
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder={tab === 'ssh' ? 'My Server Key' : tab === 'api' ? 'OpenAI API' : 'Full Name'}
              autoFocus className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500" />
          </div>

          {tab === 'api' && (
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">Provider</label>
              <input type="text" value={provider} onChange={e => setProvider(e.target.value)} placeholder="OpenAI"
                className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500" />
            </div>
          )}

          {tab === 'pgp' && mode === 'generate' && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@example.com"
                  className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">Passphrase (optional)</label>
                <input type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} placeholder="Leave empty for no passphrase"
                  className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500" />
              </div>
              <button type="button" onClick={generatePgpKey} disabled={!name || !email || isGenerating}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-500 hover:bg-violet-400 disabled:bg-slate-200 dark:disabled:bg-slate-700 text-white rounded-lg font-semibold transition-all">
                <Sparkles className="w-4 h-4" />
                {isGenerating ? 'Generating RSA-4096 key...' : 'Generate PGP Key (RSA-4096)'}
              </button>
            </>
          )}

          {tab === 'pgp' && mode === 'import' && (
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                Armored Private Key <span className="text-red-600 dark:text-red-400">*</span>
              </label>
              <textarea value={keyData} onChange={e => setKeyData(e.target.value)}
                placeholder="-----BEGIN PGP PRIVATE KEY BLOCK-----"
                required rows={6}
                className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all font-mono text-xs resize-none dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500" />
            </div>
          )}

          {tab === 'ssh' && mode === 'generate' && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">Key Type</label>
                <div className="flex gap-2 mb-3">
                  {['ed25519', 'ecdsa', 'rsa'].map(type => (
                    <button key={type} type="button" onClick={() => setKeyType(type)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-mono transition-all ${keyType === type ? 'bg-emerald-500 text-slate-950' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'}`}>
                      {type}
                    </button>
                  ))}
                  <button type="button" onClick={generateSshKey} disabled={!name || isGenerating}
                    className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-violet-500 hover:bg-violet-400 disabled:bg-slate-700 text-white rounded-lg text-sm transition-all">
                    <Sparkles className="w-4 h-4" />
                    {isGenerating ? 'Generating...' : 'Generate'}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Private Key <span className="text-red-600 dark:text-red-400">*</span>
                </label>
                <textarea value={keyData} onChange={e => setKeyData(e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  required rows={4} className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all font-mono text-xs resize-none dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">Public Key (optional)</label>
                <textarea value={publicKey} onChange={e => setPublicKey(e.target.value)} placeholder="ssh-ed25519 AAAA..."
                  rows={2} className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all font-mono text-xs resize-none dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">Comment (optional)</label>
                <input type="text" value={comment} onChange={e => setComment(e.target.value)} placeholder="user@host"
                  className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500" />
              </div>
            </>
          )}

          {tab === 'api' && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  API Key <span className="text-red-600 dark:text-red-400">*</span>
                </label>
                <textarea value={keyData} onChange={e => setKeyData(e.target.value)} placeholder="sk-..."
                  required rows={4} className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all font-mono text-xs resize-none dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">Notes (optional)</label>
                <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Production key"
                  className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500" />
              </div>
            </>
          )}

          {(tab !== 'pgp' || isPgpImport) && (
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg transition-colors dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-white">Cancel</button>
              <button type="submit" disabled={!keyData} className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 dark:disabled:text-slate-500 text-slate-950 font-semibold rounded-lg transition-colors">Save</button>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
// ── Import Keys Modal ─────────────────────────────────────────────────────────

function ImportKeysModal({
  onClose, onImport
}: {
  onClose: () => void
  onImport: (keys: ImportedKey[]) => void
}) {
  const [keys, setKeys] = useState<ImportedKey[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    sshImportKeys()
      .then(k => {
        setKeys(k)
        setSelected(new Set(k.map(i => i.name)))
        setLoading(false)
      })
      .catch(() => {
        setError('Failed to scan ~/.ssh')
        setLoading(false)
      })
  }, [])

  const toggleSelect = (name: string) => {
    const next = new Set(selected)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setSelected(next)
  }

  const handleImport = () => {
    const toImport = keys.filter(k => selected.has(k.name))
    if (toImport.length > 0) {
      onImport(toImport)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={onClose}>
      <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col dark:bg-slate-900 dark:border-slate-800" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Import from ~/.ssh</h2>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-slate-600 dark:hover:text-white">×</button>
        </div>
        {loading ? (
          <div className="text-center py-8 text-slate-500 dark:text-slate-400">Scanning ~/.ssh...</div>
        ) : error ? (
          <div className="text-center py-8 text-red-600 dark:text-red-400">{error}</div>
        ) : keys.length === 0 ? (
          <div className="text-center py-8 text-slate-500 dark:text-slate-400">No SSH keys found in ~/.ssh</div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto space-y-2 mb-4">
              {keys.map(k => (
                <label key={k.name} className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${selected.has(k.name) ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-slate-100 border border-slate-200 hover:bg-slate-200 dark:bg-slate-800/50 dark:border-slate-700 dark:hover:bg-slate-800'}`}>
                  <input
                    type="checkbox"
                    checked={selected.has(k.name)}
                    onChange={() => toggleSelect(k.name)}
                    className="accent-emerald-500 w-4 h-4"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 text-sm truncate dark:text-white">{k.name}</p>
                    <p className="text-xs text-slate-600 dark:text-slate-500">{k.key_type} · {k.fingerprint}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg transition-colors dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-white">Cancel</button>
              <button onClick={handleImport} disabled={selected.size === 0} className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 dark:disabled:text-slate-500 text-slate-950 font-semibold rounded-lg transition-colors">
                Import {selected.size} key{selected.size !== 1 ? 's' : ''}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}


// ── PGP Key Row ───────────────────────────────────────────────────────────────

const PgpKeyRow = memo(function PgpKeyRow({
  pgpKey, revealed, onToggleReveal, onCopyPublic, onCopyPrivate, onDelete, onTogglePin
}: {
  pgpKey: PgpKey
  revealed: boolean
  onToggleReveal: () => void
  onCopyPublic: () => void
  onCopyPrivate: () => void
  onDelete: () => void
  onTogglePin: () => void
}) {
  const [justCopied, setJustCopied] = useState<'pub' | 'priv' | null>(null)

  const handleCopyPrivate = () => {
    onCopyPrivate()
    setJustCopied('priv')
    setTimeout(() => setJustCopied(null), 2000)
  }

  const handleCopyPublic = () => {
    onCopyPublic()
    setJustCopied('pub')
    setTimeout(() => setJustCopied(null), 2000)
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-300 transition-colors group dark:bg-slate-900/50 dark:border-slate-800 dark:hover:border-slate-700">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-amber-500 shrink-0" />
            <h3 className="font-semibold text-slate-900 truncate dark:text-white">{pgpKey.name}</h3>
            <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/20 text-amber-600 border border-amber-500/30 dark:text-amber-400">
              PGP
            </span>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-500 mt-0.5">
            {pgpKey.algorithm} · {pgpKey.bit_length}-bit · {pgpKey.key_id}
          </p>
          {pgpKey.user_ids.length > 0 && (
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 truncate">{pgpKey.user_ids.join(', ')}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-3">
          <button onClick={onTogglePin} className={`p-2 hover:bg-slate-100 rounded-lg transition-colors dark:hover:bg-slate-800 ${pgpKey.pinned ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 hover:text-amber-600 dark:text-slate-400 dark:hover:text-amber-400'}`} title={pgpKey.pinned ? 'Unpin' : 'Pin'}>
            <Star className="w-4 h-4" fill={pgpKey.pinned ? 'currentColor' : 'none'} />
          </button>
          <button onClick={onToggleReveal} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-slate-900 transition-colors dark:hover:bg-slate-800 dark:text-slate-400 dark:hover:text-white" title={revealed ? 'Hide' : 'Reveal'}>
            {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          {pgpKey.public_key && (
            <button onClick={handleCopyPublic} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-slate-900 transition-colors dark:hover:bg-slate-800 dark:text-slate-400 dark:hover:text-white" title="Copy public key">
              {justCopied === 'pub' ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          )}
          {pgpKey.private_key && (
            <button onClick={handleCopyPrivate} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-slate-900 transition-colors dark:hover:bg-slate-800 dark:text-slate-400 dark:hover:text-white" title="Copy private key">
              {justCopied === 'priv' ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          )}
          <button onClick={onDelete} className="p-2 hover:bg-red-500/10 rounded-lg text-slate-600 hover:text-red-600 transition-colors opacity-0 group-hover:opacity-100 dark:text-slate-400 dark:hover:text-red-400" title="Delete">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-600 font-mono break-all mb-2">{pgpKey.fingerprint}</p>
      {revealed && pgpKey.public_key && (
        <div className="bg-slate-100 rounded-lg p-3 dark:bg-slate-950">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-slate-600 dark:text-slate-500">Public Key</p>
            <button onClick={handleCopyPublic} className="p-1 text-slate-500 hover:text-slate-700 opacity-0 group-hover:opacity-100 transition-all dark:hover:text-white">
              {justCopied === 'pub' ? <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
          <code className="text-xs text-slate-700 font-mono break-all dark:text-slate-300">{pgpKey.public_key}</code>
        </div>
      )}
      {revealed && pgpKey.private_key && (
        <div className="bg-slate-100 rounded-lg p-3 mt-2 dark:bg-slate-950">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-red-600 dark:text-red-400">Private Key</p>
            <button onClick={handleCopyPrivate} className="p-1 text-slate-500 hover:text-slate-700 opacity-0 group-hover:opacity-100 transition-all dark:hover:text-white">
              {justCopied === 'priv' ? <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
          <code className="text-xs text-slate-700 font-mono break-all dark:text-slate-300">{pgpKey.private_key}</code>
        </div>
      )}
    </div>
  )
})

// ── Import PGP Modal ──────────────────────────────────────────────────────────

function ImportPgpModal({
  onClose, onImport
}: {
  onClose: () => void
  onImport: (key: Omit<PgpKey, 'id' | 'created'>) => void
}) {
  const [armoredKey, setArmoredKey] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState('')

  const handleImport = async () => {
    if (!armoredKey.trim()) return
    setIsImporting(true)
    setError('')
    try {
      const parsed = await pgpImportKey('', armoredKey)
      onImport({
        name: parsed.name,
        fingerprint: parsed.fingerprint,
        key_id: parsed.key_id,
        algorithm: parsed.algorithm,
        bit_length: parsed.bit_length,
        user_ids: parsed.user_ids,
        public_key: null,
        private_key: armoredKey.trim(),
      })
    } catch (err: any) {
      setError(err?.toString() || 'Failed to parse PGP key')
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={onClose}>
      <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-lg shadow-2xl dark:bg-slate-900 dark:border-slate-800" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Import PGP Key</h2>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-slate-600 dark:hover:text-white">×</button>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
          Paste your armored PGP public or private key below. Supports RSA, ECC, EdDSA and other OpenPGP algorithms.
        </p>
        <div>
          <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">
            Armored PGP Key <span className="text-red-600 dark:text-red-400">*</span>
          </label>
          <textarea
            value={armoredKey}
            onChange={(e) => setArmoredKey(e.target.value)}
            placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----&#10;&#10;or&#10;&#10;-----BEGIN PGP PRIVATE KEY BLOCK-----"
            rows={8}
            className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all font-mono text-xs resize-none dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500"
          />
        </div>
        {error && (
          <div className="mt-3 flex items-center gap-2 text-red-600 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 dark:text-red-400">
            <Shield className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg transition-colors dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-white">Cancel</button>
          <button
            onClick={handleImport}
            disabled={!armoredKey.trim() || isImporting}
            className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 dark:disabled:text-slate-500 text-slate-950 font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {isImporting ? (
              <><Sparkles className="w-4 h-4 animate-spin" /> Importing...</>
            ) : (
              <><Shield className="w-4 h-4" /> Import PGP Key</>
            )}
          </button>
        </div>
      </div>
    </div>
)
}
