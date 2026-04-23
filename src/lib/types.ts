export interface Vault {
  id: string
  name: string
  salt: string
  ciphertext: string
  created: string
}

export interface VaultData {
  keys: SshKey[]
  api_keys: ApiKey[]
  notes: Note[]
  pgp_keys: PgpKey[]
}

export interface SshKey {
  id: string
  name: string
  key_type: string
  comment: string
  fingerprint: string
  public_key: string
  private_key: string | null
  created: string
  // Legacy field for backwards compatibility
  last_copied?: string | null
  // New analytics fields
  copied_count?: number
  last_copied_at?: string | null
  last_used_at?: string | null
  // Favorites / pinning
  pinned?: boolean
}

export interface ApiKey {
  id: string
  name: string
  provider: string
  key: string
  notes: string
  created: string
  pinned?: boolean
}

export interface PgpKey {
  id: string
  name: string
  fingerprint: string
  key_id: string
  algorithm: string
  bit_length: number
  created: string
  user_ids: string[]
  public_key: string | null
  private_key: string | null
  pinned?: boolean
}

export interface Note {
  id: string
  name: string  // Note: using `name` (not `title`) to match Rust/DB
  content: string
  created: string
  tags?: string[]
}

export interface Settings {
  auto_lock_minutes: number
  theme: string
  default_ssh_key_type: string
}

export interface ImportedKey {
  name: string
  key_type: string
  public_key: string
  private_key: string | null
  fingerprint: string
  comment: string
}

export function emptyVaultData(): VaultData {
  return { keys: [], api_keys: [], notes: [], pgp_keys: [] }
}
