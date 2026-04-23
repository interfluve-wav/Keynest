import { useState, useEffect } from 'react'
import { Plus, Shield, KeyRound, Search, X } from 'lucide-react'
import { vaultList, vaultDelete } from '../lib/api'
import type { Vault } from '../lib/types'

interface Props {
  onSelect: (vault: Vault) => void
  onCreate: () => void
}

export function VaultList({ onSelect, onCreate }: Props) {
  const [vaults, setVaults] = useState<Vault[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    loadVaults()
  }, [])

  // Keyboard shortcut: Cmd+N = new vault
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        onCreate()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCreate])

  const loadVaults = async () => {
    try {
      const list = await vaultList()
      setVaults(list)
    } catch (e) {
      console.error('Failed to load vaults:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (deleting) return
    setDeleting(id)
    try {
      await vaultDelete(id)
      setVaults(vaults.filter(v => v.id !== id))
    } catch (e) {
      console.error('Failed to delete vault:', e)
    } finally {
      setDeleting(null)
    }
  }

  const filteredVaults = searchQuery
    ? vaults.filter(v => v.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : vaults

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="max-w-5xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Shield className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">SSH Vault</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400">Secure key management</p>
            </div>
          </div>
          <button
            onClick={onCreate}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded-xl transition-all"
          >
            <Plus className="w-5 h-5" />
            New Vault
          </button>
        </div>

        {/* Search */}
        {vaults.length > 3 && (
          <div className="relative mb-6">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search vaults..."
              className="w-full pl-10 pr-10 py-2.5 bg-white border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all text-sm dark:bg-slate-900/50 dark:border-slate-800 dark:text-white dark:placeholder-slate-500"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900 dark:hover:text-white">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Vaults */}
        {loading ? (
          <div className="text-center py-20 text-slate-500">Loading...</div>
        ) : vaults.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-slate-200 border border-slate-300 flex items-center justify-center dark:bg-slate-800/50 dark:border-slate-700">
              <KeyRound className="w-10 h-10 text-slate-500 dark:text-slate-600" />
            </div>
            <h2 className="text-xl font-semibold text-slate-700 dark:text-slate-300 mb-2">No vaults yet</h2>
            <p className="text-slate-600 dark:text-slate-500 mb-6">Create your first vault to store SSH and API keys</p>
            <button
              onClick={onCreate}
              className="px-6 py-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 font-medium rounded-xl hover:bg-emerald-500/20 transition-all dark:text-emerald-400"
            >
              Create your first vault
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredVaults.map((vault) => (
              <div
                key={vault.id}
                onClick={() => onSelect(vault)}
                className="group bg-white border border-slate-200 rounded-xl p-5 hover:border-emerald-500/50 hover:shadow-lg hover:shadow-emerald-500/5 transition-all cursor-pointer dark:bg-slate-900/50 dark:border-slate-800"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-slate-900 dark:text-white mb-1 truncate">{vault.name}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-500">
                      Created {new Date(vault.created).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(vault.id)
                    }}
                    disabled={deleting === vault.id}
                    className="p-2 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-500 transition-all dark:text-slate-400 dark:hover:text-red-400"
                    title="Delete vault"
                  >
                    {deleting === vault.id ? '...' : '×'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Keyboard shortcut hints */}
        <div className="mt-12 text-center text-xs text-slate-400 dark:text-slate-600 space-x-4">
          <span><kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400">⌘N</kbd> New vault</span>
        </div>
      </div>
    </div>
  )
}
