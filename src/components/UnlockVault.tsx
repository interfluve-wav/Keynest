import { useState, useEffect } from 'react'
import { Lock, ArrowLeft, ShieldAlert, Loader2, Fingerprint, KeyRound } from 'lucide-react'
import { pbkdf2KeyDerive, aesDecrypt, biometricAvailable, biometricUnlock, biometricStoreKey } from '../lib/api'
import type { Vault } from '../lib/types'
import { useVaultStore } from '../lib/store'
import { ErrorBoundary } from './ErrorBoundary'

interface Props {
  vault: Vault
  onBack: () => void
}

interface UnlockState {
  mode: 'checking' | 'biometric' | 'password' | 'error'
  message: string
}

export function UnlockVault({ vault, onBack }: Props) {
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [unlockState, setUnlockState] = useState<UnlockState>({ mode: 'checking', message: '' })
  const [biometricEnabled, setBiometricEnabled] = useState(false)
  const { unlock } = useVaultStore()

  // Check biometric availability on mount
  useEffect(() => {
    checkBiometricAvailability()
  }, [vault.id])

  const checkBiometricAvailability = async () => {
    try {
      const available = await biometricAvailable()
      if (!available) {
        setUnlockState({ mode: 'password', message: '' })
        return
      }

      setBiometricEnabled(true)
      setUnlockState({ mode: 'biometric', message: 'Touch ID ready' })
    } catch {
      setUnlockState({ mode: 'password', message: '' })
    }
  }

  const handleBiometricUnlock = async () => {
    setUnlockState({ mode: 'checking', message: 'Authenticating...' })
    setIsLoading(true)
    setError('')

    try {
      const key = await biometricUnlock(vault.id, `Unlock vault "${vault.name}"`)

      if (key) {
        const decrypted = await aesDecrypt(key, vault.ciphertext)
        const data = JSON.parse(decrypted)
        unlock(vault, data, key)
      } else {
        setUnlockState({
          mode: 'password',
          message: 'Enter your passphrase — Touch ID will be enabled for next time'
        })
      }
    } catch (err: any) {
      const errorMsg = err?.toString?.() || 'Biometric authentication failed'
      if (errorMsg.includes('cancel') || errorMsg.includes('cancelled')) {
        setUnlockState({ mode: 'biometric', message: 'Touch ID ready' })
      } else {
        setError(errorMsg)
        setUnlockState({ mode: 'password', message: 'Biometric failed — use password' })
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handlePasswordUnlock = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!passphrase) return

    setError('')
    setIsLoading(true)

    try {
      // Derive key with PBKDF2 (fast, ~100ms)
      let key: string
      try {
        key = await pbkdf2KeyDerive(passphrase, vault.salt)
      } catch (e) {
        console.error('[Unlock] pbkdf2KeyDerive failed:', e)
        throw e
      }

      // Decrypt
      let decrypted: string
      try {
        decrypted = await aesDecrypt(key, vault.ciphertext)
      } catch (e) {
        console.error('[Unlock] aesDecrypt FAILED. vault id:', vault.id, '| salt len:', vault.salt.length, '| ct len:', vault.ciphertext.length, '| derived key len:', key.length, '| derived key (b64):', key)
        throw e
      }

      // Parse JSON
      let data: import('../lib/types').VaultData
      try {
        data = JSON.parse(decrypted)
      } catch (e) {
        console.error('[Unlock] JSON parse FAILED. Decrypted plaintext (first 200 chars):', decrypted.slice(0, 200))
        throw e
      }

      // Success — unlock the vault FIRST, then store key for biometric
      // so a keychain failure doesn't lock the user out.
      unlock(vault, data, key)

      if (biometricEnabled) {
        try {
          await biometricStoreKey(vault.id, key)
        } catch (storeErr) {
          console.warn('Failed to store key for biometric:', storeErr)
        }
      }
    } catch (err) {
      // Show detailed error for debugging
      setError(`Unlock failed — check browser console (Cmd+Option+J)`)
      console.error('[Unlock] FULL ERROR:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const renderContent = () => {
    switch (unlockState.mode) {
      case 'checking':
        return (
          <div className="text-center">
            <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-4" />
            <p className="text-slate-600 dark:text-slate-400">{unlockState.message}</p>
          </div>
        )

      case 'biometric':
        return (
          <div className="text-center space-y-6">
            <div className="w-20 h-20 mx-auto rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Fingerprint className="w-10 h-10 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white text-center mb-2">
                Unlock {vault.name}
              </h1>
              <p className="text-slate-600 dark:text-slate-400 text-center">
                {unlockState.message}
              </p>
            </div>
            <button
              onClick={handleBiometricUnlock}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-200 dark:disabled:bg-slate-700 text-slate-950 font-semibold rounded-xl transition-all"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Fingerprint className="w-5 h-5" />
              )}
              {isLoading ? 'Authenticating...' : 'Unlock with Touch ID'}
            </button>
            <button
              onClick={() => setUnlockState({ mode: 'password', message: '' })}
              className="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-500 dark:hover:text-white transition-colors"
            >
              Use password instead
            </button>
          </div>
        )

      case 'password':
      default:
        return (
          <>
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              {biometricEnabled ? (
                <KeyRound className="w-8 h-8 text-emerald-400" />
              ) : (
                <Lock className="w-8 h-8 text-emerald-400" />
              )}
            </div>

            <h1 className="text-xl font-bold text-slate-900 dark:text-white text-center mb-2">
              Unlock {vault.name}
            </h1>
            {unlockState.message ? (
              <p className="text-sm text-emerald-400 text-center mb-4">
                {unlockState.message}
              </p>
            ) : (
              <p className="text-slate-600 dark:text-slate-400 text-center mb-8">
                {biometricEnabled ? 'Enter your passphrase to unlock' : 'Enter your passphrase to decrypt your keys'}
              </p>
            )}

            <form onSubmit={handlePasswordUnlock} className="space-y-4">
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter passphrase"
                autoFocus
                className="w-full px-4 py-3 bg-white border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500"
              />

              {error && (
                <div className="flex items-center gap-2 text-red-600 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 dark:text-red-400">
                  <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading || !passphrase}
                className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 dark:disabled:text-slate-500 text-slate-950 font-semibold rounded-xl transition-all"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Unlocking...
                  </>
                ) : (
                  'Unlock Vault'
                )}
              </button>
            </form>

            {biometricEnabled && (
              <button
                onClick={() => setUnlockState({ mode: 'biometric', message: 'Touch ID ready' })}
                className="mt-4 text-sm text-slate-600 hover:text-emerald-600 dark:text-slate-500 dark:hover:text-emerald-400 transition-colors flex items-center gap-2 mx-auto"
              >
                <Fingerprint className="w-4 h-4" />
                Try Touch ID
              </button>
            )}
          </>
        )
    }
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to vaults
        </button>

        <div className="bg-white border border-slate-200 rounded-2xl p-8 dark:bg-slate-900/50 dark:border-slate-800">
          {renderContent()}
        </div>
      </div>
    </div>
  </ErrorBoundary>

)
}
