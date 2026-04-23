import { useState, useEffect, useRef, useMemo } from 'react'
import { listen } from '@tauri-apps/api/event'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { useVaultStore } from '../lib/store'
import { toast } from './VaultDashboard'
import { Search, Key, Lock, Globe, Shield } from 'lucide-react'
import type { SshKey, ApiKey, PgpKey } from '../lib/types'

type KeyType = 'ssh' | 'api' | 'pgp'

interface SearchableItem {
  id: string
  name: string
  keyType: KeyType
  subtitle: string
  // The value to copy
  copyValue: string
  // Optional extra detail line
  detail?: string
}

export function QuickPicker() {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { currentVault, vaultData } = useVaultStore()

  // Listen for global shortcut
  useEffect(() => {
    let unlisten: (() => void) | null = null

    const setupListener = async () => {
      unlisten = await listen('global-shortcut', () => {
        if (!currentVault) return
        setIsOpen(true)
        setSearchQuery('')
        setSelectedIndex(0)
      })
    }

    setupListener()

    return () => {
      if (unlisten) unlisten()
    }
  }, [currentVault])

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  // Build unified searchable list from all key types
  const allItems = useMemo<SearchableItem[]>(() => {
    if (!vaultData) return []

    const sshItems: SearchableItem[] = (vaultData.keys || []).map((k: SshKey) => ({
      id: `ssh-${k.id}`,
      name: k.name,
      keyType: 'ssh' as KeyType,
      subtitle: k.key_type,
      copyValue: k.private_key || k.public_key || '',
      detail: k.comment || undefined,
    }))

    const apiItems: SearchableItem[] = (vaultData.api_keys || []).map((k: ApiKey) => ({
      id: `api-${k.id}`,
      name: k.name,
      keyType: 'api' as KeyType,
      subtitle: k.provider,
      copyValue: k.key,
    }))

    const pgpItems: SearchableItem[] = (vaultData.pgp_keys || []).map((k: PgpKey) => ({
      id: `pgp-${k.id}`,
      name: k.name,
      keyType: 'pgp' as KeyType,
      subtitle: k.algorithm,
      copyValue: k.private_key || k.public_key || '',
      detail: k.fingerprint,
    }))

    return [...sshItems, ...apiItems, ...pgpItems]
  }, [vaultData])

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return allItems
    const q = searchQuery.toLowerCase()
    return allItems.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        (item.detail && item.detail.toLowerCase().includes(q))
    )
  }, [allItems, searchQuery])

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [searchQuery])

  const handleSelect = async (item: SearchableItem) => {
    if (!item.copyValue) return

    try {
      await writeText(item.copyValue)
      toast(`Copied ${item.name} to clipboard`, 'success')
      setIsOpen(false)
    } catch {
      toast('Failed to copy', 'error')
    }
  }

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setIsOpen(false)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, filteredItems.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = filteredItems[selectedIndex]
        if (item) handleSelect(item)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen, filteredItems, selectedIndex])

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  if (!isOpen) return null

  const typeBadge = (type: KeyType) => {
    if (type === 'ssh') {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
          SSH
        </span>
      )
    }
    if (type === 'api') {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-violet-500/20 text-violet-400 border border-violet-500/30">
          API
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
        PGP
      </span>
    )
  }

  const typeIcon = (type: KeyType) => {
    if (type === 'ssh') return <Key className="w-4 h-4 text-cyan-400" />
    if (type === 'api') return <Globe className="w-4 h-4 text-violet-400" />
    return <Shield className="w-4 h-4 text-amber-400" />
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh] bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden dark:bg-slate-900 dark:border-slate-700">
        {/* Search header */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-200 dark:border-slate-700">
          <Search className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search SSH keys, API keys, PGP keys..."
            className="flex-1 bg-transparent text-slate-900 placeholder-slate-400 outline-none dark:text-white dark:placeholder-slate-500"
          />
          <div className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
            <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded dark:bg-slate-800 dark:border-slate-700">ESC</kbd>
            <span>to close</span>
          </div>
        </div>

        {/* Keys list */}
        <div className="max-h-[50vh] overflow-y-auto">
          {!currentVault ? (
            <div className="p-8 text-center text-slate-600 dark:text-slate-500">
              <Lock className="w-8 h-8 mx-auto mb-3 opacity-50" />
              <p>Unlock a vault to use quick picker</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="p-8 text-center text-slate-600 dark:text-slate-500">
              {searchQuery ? 'No keys found' : 'Vault is empty'}
            </div>
          ) : (
            filteredItems.map((item, index) => (
              <button
                key={item.id}
                onClick={() => handleSelect(item)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                  index === selectedIndex
                    ? 'bg-emerald-500/20 border-l-2 border-emerald-500'
                    : 'hover:bg-slate-100 border-l-2 border-transparent dark:hover:bg-slate-800'
                }`}
              >
                {typeIcon(item.keyType)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-slate-900 truncate dark:text-white">{item.name}</p>
                    {typeBadge(item.keyType)}
                  </div>
                  <p className="text-xs text-slate-600 truncate dark:text-slate-400">
                    {item.detail || item.subtitle}
                  </p>
                </div>
                {index === selectedIndex && (
                  <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-xs text-slate-600 shrink-0 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400">
                    ↵
                  </kbd>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-xs text-slate-600 flex items-center justify-between dark:bg-slate-950 dark:border-slate-800 dark:text-slate-500">
          <span>{filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}</span>
          <div className="flex items-center gap-2">
            <span>Use</span>
            <kbd className="px-1 bg-slate-100 border border-slate-200 rounded dark:bg-slate-800 dark:border-slate-700">↑</kbd>
            <kbd className="px-1 bg-slate-100 border border-slate-200 rounded dark:bg-slate-800 dark:border-slate-700">↓</kbd>
            <span>and</span>
            <kbd className="px-1 bg-slate-100 border border-slate-200 rounded dark:bg-slate-800 dark:border-slate-700">Enter</kbd>
          </div>
        </div>
      </div>
    </div>
  )
}
