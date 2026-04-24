export interface Vault {
  id: string
  name: string
  salt: string
  ciphertext: string
  version?: number
  kdf?: 'argon2id' | 'pbkdf2' | null
  wrapped_dek?: string | null
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
  reveal_on_hover: boolean
}

export interface ImportedKey {
  name: string
  key_type: string
  public_key: string
  private_key: string | null
  fingerprint: string
  comment: string
}

// Agent Chest proxy types
export interface ProxyCredential {
  id: string
  name: string
  vault_id: string
  target_host: string
  target_prefix: string
  auth_type: 'bearer' | 'api_key_header' | 'basic_auth'
  header_name: string
  header_value: string
  encrypted_key?: string
  created_at: string
}

export interface ProxyRule {
  id: string
  vault_id: string
  name: string
  host_match: string
  path_match: string
  methods: string[]
  action: 'allow' | 'deny'
  created_at: string
}

export interface ProxyBinding {
  id: string
  vault_id: string
  credential_ids: string[]
  rule_ids: string[]
  created_at: string
}

export interface ProxyProposal {
  id: string
  vault_id: string
  host: string
  path: string
  method: string
  reason: string
  agent_id: string
  status: 'pending' | 'approved' | 'denied'
  created_rule_id?: string
  created_at: string
  resolved_at?: string
}

export interface ProxyAgent {
  id: string
  vault_id: string
  name: string
  status: 'active' | 'revoked'
  token?: string
  expires_at?: string
  created_at: string
  updated_at: string
}

export interface ProxyInvite {
  id: string
  code: string
  vault_id: string
  name: string
  status: 'pending' | 'redeemed'
  redeemed_by?: string
  created_at: string
  redeemed_at?: string
}

export interface ProxyRedeemInviteResponse {
  invite: ProxyInvite
  agent: ProxyAgent
  token: string
}

export interface AuditEntry {
  timestamp: string
  agent_id: string
  vault_id: string
  method: string
  target: string
  path: string
  action: string
  status_code: number
  credential_id: string
  rule: string
  source_ip: string
  user_agent: string
  duration_ms: number
}

export interface ProxyStatus {
  running: boolean
  proxy_port: number
  mgmt_port: number
}

export interface ProxyDiagnostics {
  running: boolean
  proxy_port: number
  mgmt_port: number
  mgmt_reachable: boolean
  proxy_listener_pids: number[]
  mgmt_listener_pids: number[]
  log_path: string
  log_tail: string
}

export interface DiscoverService {
  host: string
  description: string
}

export interface DiscoverResponse {
  vault: string
  services: DiscoverService[]
  available_credential_keys: string[]
}

export interface ProxyRuleTestRequest {
  vault_id: string
  host: string
  path: string
  method: string
}

export interface ProxyRuleTestResponse {
  allow: boolean
  reason: string
  matched_rule?: ProxyRule
  host: string
  path: string
  method: string
}

export interface ProxyPolicyTemplate {
  id: string
  name: string
  description: string
  rules: ProxyRule[]
}

export function emptyVaultData(): VaultData {
  return { keys: [], api_keys: [], notes: [], pgp_keys: [] }
}
