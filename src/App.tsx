import { useState, useEffect } from 'react'
import { VaultList } from './components/VaultList'
import { CreateVault } from './components/CreateVault'
import { UnlockVault } from './components/UnlockVault'
import { VaultDashboard } from './components/VaultDashboard'
import { Settings } from './components/Settings'
import { QuickPicker } from './components/QuickPicker'
import { useVaultStore } from './lib/store'
import { getSettings, checkVaultIntegrity, deleteVaults } from './lib/api'
import type { Vault } from './lib/types'

type View = 'list' | 'create' | 'unlock' | 'dashboard' | 'settings'

interface IntegrityWarning {
  id: string
  name: string
  status: string
}

// Apply theme from settings on app startup
function applyTheme(theme: string) {
  const root = document.documentElement
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', prefersDark)
  } else {
    root.classList.toggle('dark', theme === 'dark')
  }
}

export function App() {
  const [view, setView] = useState<View>('list')
  const [selectedVault, setSelectedVault] = useState<Vault | null>(null)
  const { isUnlocked, settings, setSettings } = useVaultStore()
  const [integrityWarnings, setIntegrityWarnings] = useState<IntegrityWarning[]>([])
  const [showIntegrityModal, setShowIntegrityModal] = useState(false)

  // Load settings from backend on app mount and apply theme
  useEffect(() => {
    getSettings()
      .then((s) => {
        setSettings(s)
        applyTheme(s.theme)
      })
      .catch(() => {
        // Fall back to default dark theme
        applyTheme('dark')
      })
  }, [setSettings])

  // Run vault integrity check on startup (before any unlock attempt)
  useEffect(() => {
    checkVaultIntegrity()
      .then((results) => {
        const bad = results.filter((r) => r.status !== 'ok')
        if (bad.length > 0) {
          setIntegrityWarnings(bad)
          setShowIntegrityModal(true)
        }
      })
      .catch(() => {}) // non-fatal
  }, [])

  async function handleNukeCorrupted() {
    const badIds = integrityWarnings.map((w) => w.id)
    try {
      await deleteVaults(badIds)
      setIntegrityWarnings([])
      setShowIntegrityModal(false)
    } catch (e) {
      console.error('Failed to delete corrupted vaults:', e)
    }
  }

  // Re-apply theme whenever settings change (e.g., after Settings save)
  useEffect(() => {
    applyTheme(settings.theme)
  }, [settings.theme])

  // Reset view to list when vault locks (prevents white screen on lock)
  useEffect(() => {
    if (!isUnlocked) {
      setView('list')
      setSelectedVault(null)
    }
  }, [isUnlocked])

  // QuickPicker is always mounted to listen for global shortcut
  const appContent = () => {
    // If vault is unlocked but we're not showing settings, show dashboard
    if (isUnlocked && view !== 'settings') {
      return (
        <VaultDashboard 
          onOpenSettings={() => setView('settings')} 
        />
      )
    }

    // Handle view transitions
    switch (view) {
      case 'create':
        return (
          <CreateVault
            onBack={() => setView('list')}
            onCreated={() => {
              // Vault is now unlocked, will show dashboard
              setView('dashboard')
            }}
          />
        )

      case 'unlock':
        if (!selectedVault) {
          setView('list')
          return null
        }
        return (
          <UnlockVault
            vault={selectedVault}
            onBack={() => {
              setSelectedVault(null)
              setView('list')
            }}
          />
        )
      case 'dashboard':
        // dashboard is handled by the isUnlocked guard above; this prevents
        // falling through to VaultList if view drifts to dashboard.
        return null
      case 'settings':
        return <Settings onBack={() => setView(isUnlocked ? 'dashboard' : 'list')} />

      default:
        return (
          <VaultList
            onSelect={(vault) => {
              setSelectedVault(vault)
              setView('unlock')
            }}
            onCreate={() => setView('create')}
          />
        )
    }
  }

  return (
    <>
      {appContent()}
      <QuickPicker />

      {/* Vault integrity warning modal — shown on startup if corruption detected */}
      {showIntegrityModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white border border-red-200 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl dark:bg-red-950 dark:border-red-800">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-3xl">⚠️</span>
              <h2 className="text-xl font-bold text-red-700 dark:text-red-200">Corrupted Vault Data</h2>
            </div>
            <p className="text-red-600 dark:text-red-300 text-sm mb-5 leading-relaxed">
              {integrityWarnings.length} vault{integrityWarnings.length > 1 ? 's' : ''} have
              unreadable or truncated ciphertext and cannot be decrypted. Delete them to start fresh?
            </p>
            <div className="bg-red-50 dark:bg-red-950/50 rounded-lg p-3 mb-5 max-h-40 overflow-y-auto space-y-2">
              {integrityWarnings.map((w) => (
                <div key={w.id} className="flex items-start gap-2">
                  <span className="text-red-500 dark:text-red-400 mt-0.5">•</span>
                  <div>
                    <span className="text-red-700 dark:text-red-200 font-medium">{w.name}</span>
                    <span className="text-red-600 dark:text-red-500 text-xs ml-2">({w.status})</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowIntegrityModal(false)}
                className="px-4 py-2 rounded-lg text-red-600 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900/50 transition-colors text-sm"
              >
                Dismiss
              </button>
              <button
                onClick={handleNukeCorrupted}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium transition-colors text-sm dark:bg-red-700 dark:hover:bg-red-600"
              >
                Delete Corrupted Vaults
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
