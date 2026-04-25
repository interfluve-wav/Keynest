import { useState, useEffect } from 'react'
import {
  ArrowLeft, Moon, Sun, Clock, Key, Download, Upload,
  Palette, Shield, Trash2, AlertTriangle, FileJson, Fingerprint,
  Eye
} from 'lucide-react'
import { useVaultStore } from '../lib/store'
import {
  argon2KeyDerive,
  biometricAvailable,
  biometricDeleteKey,
  getSettings,
  setSettings,
  unwrapDataKey,
  vaultChangePassword,
  vaultExport,
  vaultSave,
} from '../lib/api'
import type { Settings as SettingsType, VaultData } from '../lib/types'
import { save } from '@tauri-apps/plugin-dialog'
import { toast } from './VaultDashboard'
import { ErrorBoundary } from './ErrorBoundary'

interface SettingsProps {
  onBack: () => void
}

export function Settings({ onBack }: SettingsProps) {
  const {
    settings,
    setSettings: updateStoreSettings,
    currentVault,
    vaultData,
    setVaultData,
    encryptionKey,
    setCurrentVault,
  } = useVaultStore()
  const [localSettings, setLocalSettings] = useState<SettingsType>(settings)
  const [showImportConfirm, setShowImportConfirm] = useState(false)
  const [pendingImport, setPendingImport] = useState<VaultData | null>(null)
  const [hasBiometric, setHasBiometric] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [currentPass, setCurrentPass] = useState('')
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [changePassError, setChangePassError] = useState('')
  const [isChangingPass, setIsChangingPass] = useState(false)

  // Check biometric availability on mount
  useEffect(() => {
    biometricAvailable().then(setHasBiometric).catch(() => setHasBiometric(false))
  }, [])

  // Load settings from backend on mount
  useEffect(() => {
    getSettings()
      .then((s) => {
        setLocalSettings(s)
        updateStoreSettings(s)
      })
      .catch(() => toast('Failed to load settings', 'error'))
  }, [updateStoreSettings])

  // Apply theme on mount and when it changes
  useEffect(() => {
    applyTheme(localSettings.theme)
  }, [localSettings.theme])

  const applyTheme = (theme: string) => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else if (theme === 'light') {
      root.classList.remove('dark')
    } else {
      // System - check prefers-color-scheme
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      if (prefersDark) {
        root.classList.add('dark')
      } else {
        root.classList.remove('dark')
      }
    }
  }

  const saveSettings = async (newSettings: SettingsType) => {
    try {
      await setSettings(newSettings)
      setLocalSettings(newSettings)
      updateStoreSettings(newSettings)
      toast('Settings saved', 'success')
    } catch {
      toast('Failed to save settings', 'error')
    }
  }

  const handleAutoLockChange = (minutes: number) => {
    const updated = { ...localSettings, auto_lock_minutes: minutes }
    saveSettings(updated)
  }

  const handleThemeChange = (theme: string) => {
    const updated = { ...localSettings, theme }
    saveSettings(updated)
    applyTheme(theme)
  }

  const handleDefaultKeyTypeChange = (keyType: string) => {
    const updated = { ...localSettings, default_ssh_key_type: keyType }
    saveSettings(updated)
  }

  const handleClearBiometric = async () => {
    if (!currentVault) return
    try {
      await biometricDeleteKey(currentVault.id)
      toast('Touch ID cleared. You\'ll need to enter your password next time.', 'success')
    } catch {
      toast('No Touch ID was set for this vault', 'info')
    }
  }

  const canChangePassword =
    Boolean(currentVault && encryptionKey && currentVault.wrapped_dek && (currentVault.version ?? 1) >= 2)

  const handleChangePassword = async () => {
    if (!currentVault || !encryptionKey) return
    if (!currentVault.wrapped_dek) {
      toast('This vault must be upgraded first. Unlock it with your passphrase once.', 'info')
      return
    }

    if (newPass.length < 8) {
      setChangePassError('New passphrase must be at least 8 characters')
      return
    }
    if (newPass !== confirmPass) {
      setChangePassError('New passphrases do not match')
      return
    }

    setChangePassError('')
    setIsChangingPass(true)
    try {
      const kek = await argon2KeyDerive(currentPass, currentVault.salt)
      const unwrapped = await unwrapDataKey(currentVault.wrapped_dek, kek)
      if (unwrapped !== encryptionKey) {
        setChangePassError('Current passphrase is incorrect')
        setIsChangingPass(false)
        return
      }

      const updated = await vaultChangePassword(currentVault, encryptionKey, newPass)
      await vaultSave(updated)
      setCurrentVault(updated)

      setShowChangePassword(false)
      setCurrentPass('')
      setNewPass('')
      setConfirmPass('')
      toast('Passphrase updated', 'success')
    } catch (e) {
      console.error('Failed to change passphrase:', e)
      setChangePassError('Failed to change passphrase')
    } finally {
      setIsChangingPass(false)
    }
  }

  const handleExportVault = async () => {
    if (!currentVault || !vaultData) return
    
    try {
      const filePath = await save({
        defaultPath: `${currentVault.name.replace(/\s+/g, '_')}_export.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      
      if (filePath) {
        await vaultExport(filePath, currentVault, vaultData)
        toast('Vault exported successfully', 'success')
      }
    } catch (err) {
      console.error(err)
      toast('Failed to export vault', 'error')
    }
  }

  const handleImportVault = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const data = JSON.parse(text)
      // Validate structure
      if (!data.keys || !data.api_keys || !data.notes) {
        throw new Error('Invalid vault format')
      }
      setPendingImport(data)
      setShowImportConfirm(true)
      toast(`Import preview: ${data.keys.length} SSH keys, ${data.api_keys.length} API keys, ${data.notes.length} notes`, 'info')
    } catch {
      toast('Invalid vault file', 'error')
    } finally {
      e.target.value = ''
    }
  }

  const confirmImport = async () => {
    if (!pendingImport || !vaultData) return

    // Merge imported data with current vault
    const merged: VaultData = {
      keys: [...vaultData.keys, ...pendingImport.keys.filter((k: { id: string }) => !vaultData.keys.some(vk => vk.id === k.id))],
      api_keys: [...vaultData.api_keys, ...pendingImport.api_keys.filter((k: { id: string }) => !vaultData.api_keys.some(vk => vk.id === k.id))],
      notes: [...vaultData.notes, ...pendingImport.notes.filter((n: { id: string }) => !vaultData.notes.some(vn => vn.id === n.id))],
      pgp_keys: [...(vaultData.pgp_keys || []), ...(pendingImport.pgp_keys || []).filter((k: { id: string }) => !(vaultData.pgp_keys || []).some((vk: { id: string }) => vk.id === k.id))],
    }
    
    setVaultData(merged)
    setShowImportConfirm(false)
    setPendingImport(null)
    toast('Import completed successfully', 'success')
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Settings</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8">
        <div className="space-y-6">
          {/* Security Section */}
          <section className="bg-white border border-slate-200 rounded-2xl p-6 dark:bg-slate-900/50 dark:border-slate-800">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-emerald-500/10 rounded-lg dark:bg-emerald-500/20">
                <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Security</h2>
            </div>

            {/* Auto-lock */}
            <div className="space-y-4">
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                  <Clock className="w-4 h-4 text-slate-500" />
                  Auto-lock timeout
                </label>
                <input
                  type="range"
                  min="0"
                  max="60"
                  step="5"
                  value={localSettings.auto_lock_minutes}
                  onChange={(e) => handleAutoLockChange(Number(e.target.value))}
                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-500 dark:bg-slate-700"
                />
                <div className="flex justify-between mt-2 text-xs text-slate-600 dark:text-slate-500">
                  <span>Never</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                    {localSettings.auto_lock_minutes === 0
                      ? 'Disabled'
                      : localSettings.auto_lock_minutes === 1
                      ? '1 minute'
                      : `${localSettings.auto_lock_minutes} minutes`}
                  </span>
                  <span>60 min</span>
                </div>
              </div>

              {/* Touch ID Management */}
              {hasBiometric && currentVault && (
                <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                    <Fingerprint className="w-4 h-4 text-slate-500" />
                    Touch ID
                  </label>
                  <button
                    onClick={handleClearBiometric}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all text-left dark:bg-slate-800 dark:hover:bg-slate-700"
                  >
                    <Trash2 className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white">Clear Touch ID</p>
                      <p className="text-xs text-slate-600 dark:text-slate-500">Remove stored key for this vault</p>
                    </div>
                  </button>
                </div>
              )}

              {/* Passphrase management */}
              {currentVault && (
                <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                    <Key className="w-4 h-4 text-slate-500" />
                    Passphrase
                  </label>
                  <button
                    onClick={() => {
                      if (!canChangePassword) {
                        toast('Unlock this vault with your passphrase once to enable passphrase changes.', 'info')
                        return
                      }
                      setShowChangePassword(true)
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all text-left dark:bg-slate-800 dark:hover:bg-slate-700"
                  >
                    <Key className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white">Change passphrase</p>
                      <p className="text-xs text-slate-600 dark:text-slate-500">
                        {canChangePassword ? 'Re-wraps your vault key (no re-encryption)' : 'Requires one passphrase unlock to upgrade'}
                      </p>
                    </div>
                  </button>
                </div>
              )}

              {/* Reveal on Hover */}
              <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-slate-500" />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Reveal private keys on hover</span>
                  </div>
                  <button
                    onClick={() => {
                      const updated = { ...localSettings, reveal_on_hover: !localSettings.reveal_on_hover }
                      saveSettings(updated)
                    }}
                    className={`relative w-11 h-6 rounded-full transition-colors ${
                      localSettings.reveal_on_hover ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                    role="switch"
                    aria-checked={localSettings.reveal_on_hover}
                  >
                    <span
                      className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                        localSettings.reveal_on_hover ? 'translate-x-5' : ''
                      }`}
                    />
                  </button>
                </label>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-500">
                  When enabled, hovering over a private key shows the last 8 characters. Click to reveal full key.
                </p>
              </div>

              {/* Strict No File Write */}
              <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-slate-500" />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Strict No File Write mode
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      const updated = {
                        ...localSettings,
                        strict_no_file_write_mode: !localSettings.strict_no_file_write_mode,
                      }
                      saveSettings(updated)
                    }}
                    className={`relative w-11 h-6 rounded-full transition-colors ${
                      localSettings.strict_no_file_write_mode ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                    role="switch"
                    aria-checked={localSettings.strict_no_file_write_mode}
                  >
                    <span
                      className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                        localSettings.strict_no_file_write_mode ? 'translate-x-5' : ''
                      }`}
                    />
                  </button>
                </label>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-500">
                  Enabled by default. Blocks launcher script/env file generation so KeyChest never writes agent setup files to disk.
                </p>
              </div>
            </div>
          </section>

          {/* Appearance Section */}
          <section className="bg-white border border-slate-200 rounded-2xl p-6 dark:bg-slate-900/50 dark:border-slate-800">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-violet-500/10 rounded-lg dark:bg-violet-500/20">
                <Palette className="w-5 h-5 text-violet-600 dark:text-violet-400" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Appearance</h2>
            </div>

            {/* Theme Toggle */}
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3 block">Theme</label>
              <div className="flex gap-3">
                <button
                  onClick={() => handleThemeChange('dark')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border transition-all ${
                    localSettings.theme === 'dark'
                      ? 'bg-slate-800 border-emerald-500/50 text-white dark:bg-slate-800'
                      : 'bg-slate-100 border-slate-200 text-slate-600 hover:border-slate-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600'
                  }`}
                >
                  <Moon className="w-4 h-4" />
                  Dark
                </button>
                <button
                  onClick={() => handleThemeChange('light')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border transition-all ${
                    localSettings.theme === 'light'
                      ? 'bg-white border-emerald-500/50 text-slate-900'
                      : 'bg-slate-100 border-slate-200 text-slate-600 hover:border-slate-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600'
                  }`}
                >
                  <Sun className="w-4 h-4" />
                  Light
                </button>
                <button
                  onClick={() => handleThemeChange('system')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border transition-all ${
                    localSettings.theme === 'system'
                      ? 'bg-slate-800 border-emerald-500/50 text-white dark:bg-slate-800'
                      : 'bg-slate-100 border-slate-200 text-slate-600 hover:border-slate-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600'
                  }`}
                >
                  <span className="text-xs">Auto</span>
                </button>
              </div>
            </div>
          </section>

          {/* SSH Key Defaults */}
          <section className="bg-white border border-slate-200 rounded-2xl p-6 dark:bg-slate-900/50 dark:border-slate-800">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-blue-500/10 rounded-lg dark:bg-blue-500/20">
                <Key className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">SSH Key Defaults</h2>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3 block">Default Key Type</label>
              <div className="flex gap-2">
                {['ed25519', 'ecdsa', 'rsa'].map((type) => (
                  <button
                    key={type}
                    onClick={() => handleDefaultKeyTypeChange(type)}
                    className={`px-4 py-2 rounded-lg font-mono text-sm transition-all ${
                      localSettings.default_ssh_key_type === type
                        ? 'bg-emerald-500 text-slate-950'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-500">
                ed25519 is recommended for new keys - it's modern, secure, and produces small signatures.
              </p>
            </div>
          </section>

          {/* Import/Export */}
          <section className="bg-white border border-slate-200 rounded-2xl p-6 dark:bg-slate-900/50 dark:border-slate-800">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-amber-500/10 rounded-lg dark:bg-amber-500/20">
                <FileJson className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Backup & Restore</h2>
            </div>

            <div className="space-y-4">
              <button
                onClick={handleExportVault}
                disabled={!currentVault}
                className="w-full flex items-center gap-3 px-4 py-3 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all text-left dark:bg-slate-800 dark:hover:bg-slate-700"
              >
                <Download className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">Export Vault</p>
                  <p className="text-xs text-slate-600 dark:text-slate-500">Save your vault as an encrypted JSON backup</p>
                </div>
              </button>

              <label className="w-full flex items-center gap-3 px-4 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all text-left cursor-pointer dark:bg-slate-800 dark:hover:bg-slate-700">
                <Upload className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">Import Vault</p>
                  <p className="text-xs text-slate-600 dark:text-slate-500">Restore from a backup or merge with current vault</p>
                </div>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImportVault}
                  className="hidden"
                />
              </label>
            </div>
          </section>

          {/* Danger Zone */}
          <section className="bg-red-500/5 border border-red-500/20 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-red-500/10 rounded-lg dark:bg-red-500/20">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <h2 className="text-lg font-semibold text-red-600 dark:text-red-400">Danger Zone</h2>
            </div>

            <button
              onClick={() => {
                if (confirm('Are you sure? This will lock the vault immediately.')) {
                  onBack() // Go back first
                  useVaultStore.getState().lock()
                }
              }}
              className="w-full flex items-center gap-3 px-4 py-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-xl transition-all text-left"
            >
              <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />
              <div>
                <p className="font-medium text-red-600 dark:text-red-400">Lock Vault</p>
                <p className="text-xs text-red-600/70 dark:text-red-400/70">Immediately lock and clear all data from memory</p>
              </div>
            </button>
          </section>
        </div>
      </main>

      {/* Change Passphrase Modal */}
      {showChangePassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 dark:bg-slate-900 dark:border-slate-800">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">Change passphrase</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
              This re-wraps your vault data key. Your encrypted data stays unchanged.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Current passphrase</label>
                <input
                  type="password"
                  value={currentPass}
                  onChange={(e) => setCurrentPass(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">New passphrase</label>
                <input
                  type="password"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Confirm new passphrase</label>
                <input
                  type="password"
                  value={confirmPass}
                  onChange={(e) => setConfirmPass(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500"
                />
              </div>

              {changePassError && (
                <div className="text-red-600 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 dark:text-red-400">
                  {changePassError}
                </div>
              )}

              <div className="pt-2 flex gap-3">
                <button
                  onClick={() => {
                    setShowChangePassword(false)
                    setChangePassError('')
                    setCurrentPass('')
                    setNewPass('')
                    setConfirmPass('')
                  }}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all text-slate-900 font-medium dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-white"
                  disabled={isChangingPass}
                >
                  Cancel
                </button>
                <button
                  onClick={handleChangePassword}
                  className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-400 rounded-xl transition-all text-slate-950 font-semibold disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 dark:disabled:text-slate-500"
                  disabled={isChangingPass || !currentPass || !newPass || !confirmPass}
                >
                  {isChangingPass ? 'Updating...' : 'Update'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Confirm Modal */}
      {showImportConfirm && pendingImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-md shadow-2xl dark:bg-slate-900 dark:border-slate-800">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Import Vault Data</h3>
            </div>
            <p className="text-slate-600 dark:text-slate-400 mb-2">
              This will merge the following items with your current vault:
            </p>
            <ul className="text-sm text-slate-700 dark:text-slate-300 mb-6 space-y-1">
              <li>• {pendingImport.keys.length} SSH keys</li>
              <li>• {pendingImport.api_keys.length} API keys</li>
              <li>• {pendingImport.notes.length} secure notes</li>
            </ul>
            <p className="text-xs text-slate-600 dark:text-slate-500 mb-6">
              Duplicate items (same ID) will be skipped. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowImportConfirm(false)
                  setPendingImport(null)
                }}
                className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg transition-colors dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-white"
              >
                Cancel
              </button>
              <button
                onClick={confirmImport}
                className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded-lg transition-colors"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  </ErrorBoundary>
)
}
