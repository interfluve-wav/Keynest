import { useState } from 'react'
import { Shield, Loader2, ArrowLeft } from 'lucide-react'
import { vaultSave, generateSalt, generateUuid, pbkdf2KeyDerive, aesEncrypt, aesDecrypt } from '../lib/api'
import type { Vault } from '../lib/types'
import { useVaultStore } from '../lib/store'
import { ErrorBoundary } from './ErrorBoundary'

interface Props {
  onBack: () => void
  onCreated: (vault: Vault) => void
}

export function CreateVault({ onBack, onCreated }: Props) {
  const [name, setName] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const { unlock } = useVaultStore()

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!name.trim()) {
      setError('Please enter a vault name')
      return
    }
    if (passphrase.length < 8) {
      setError('Passphrase must be at least 8 characters')
      return
    }
    if (passphrase !== confirm) {
      setError('Passphrases do not match')
      return
    }

    setError('')
    setIsLoading(true)

    try {
      const id = await generateUuid()
      const salt = await generateSalt()
      const key = await pbkdf2KeyDerive(passphrase, salt)

      // Pre-verify: encrypt with the derived key, then immediately decrypt.
      // If this fails, the vault cannot be recovered. Catch it BEFORE saving.
      const emptyData = JSON.stringify({ keys: [], api_keys: [], notes: [], pgp_keys: [] })
      let ciphertext: string
      try {
        ciphertext = await aesEncrypt(key, emptyData)
        const verified = await aesDecrypt(key, ciphertext)
        if (verified !== emptyData) throw new Error('Pre-verify roundtrip mismatch')
      } catch (e) {
        setError('Cryptographic error — please try a different passphrase')
        console.error('Vault pre-verify failed:', e)
        setIsLoading(false)
        return
      }

      const vault: Vault = {
        id,
        name: name.trim(),
        salt,
        ciphertext,
        created: new Date().toISOString(),
      }

      await vaultSave(vault)
      unlock(vault, { keys: [], api_keys: [], notes: [], pgp_keys: [] }, key)
      onCreated(vault)
    } catch (err) {
      setError('Failed to create vault')
      console.error(err)
    } finally {
      setIsLoading(false)
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
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Shield className="w-8 h-8 text-emerald-400" />
          </div>

          <h1 className="text-xl font-bold text-slate-900 dark:text-white text-center mb-2">
            Create New Vault
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-center mb-8">
            Choose a name and a strong passphrase
          </p>

          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Vault Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Personal Keys"
                autoFocus
                className="w-full px-4 py-3 bg-white border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Passphrase
              </label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Minimum 8 characters"
                className="w-full px-4 py-3 bg-white border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Confirm Passphrase
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat passphrase"
                className="w-full px-4 py-3 bg-white border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500"
              />
            </div>

            {error && (
              <div className="text-red-600 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 dark:text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 dark:disabled:text-slate-500 text-slate-950 font-semibold rounded-xl transition-all"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Vault'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  </ErrorBoundary>
  )
}
