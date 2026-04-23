import { invoke } from '@tauri-apps/api/core';
import type { Vault, VaultData, ImportedKey, Settings, ProxyCredential, ProxyRule, ProxyBinding, ProxyProposal, ProxyAgent, ProxyInvite, ProxyRedeemInviteResponse, AuditEntry, ProxyStatus, DiscoverResponse } from './types';

// Vault management
export const vaultList = (): Promise<Vault[]> => invoke('vault_list');
export const vaultSave = (vault: Vault): Promise<void> => invoke('vault_save', { vault });
export const vaultLoad = (id: string): Promise<Vault> => invoke('vault_load', { id });
export const vaultDelete = (id: string): Promise<void> => invoke('vault_delete', { id });
export const vaultExport = (path: string, meta: Vault, data: VaultData): Promise<void> => 
  invoke('vault_export_with_data', { path, meta, data });
export const vaultImport = (path: string): Promise<{ meta: Vault; data: VaultData }> => 
  invoke('vault_import', { path });
export const checkVaultIntegrity = (): Promise<Array<{ id: string; name: string; status: string }>> =>
  invoke('vault_check_integrity');
export const deleteVaults = (ids: string[]): Promise<void> =>
  Promise.all(ids.map(id => invoke('vault_delete', { id }))).then(() => {});

// Crypto
export const argon2KeyDerive = (password: string, salt: string): Promise<string> =>
  invoke('argon2_key_derive', { password, salt });
export const pbkdf2KeyDerive = (password: string, salt: string): Promise<string> =>
  invoke('pbkdf2_key_derive', { password, salt });
export const aesEncrypt = (key: string, plaintext: string): Promise<string> =>
  invoke('aes_encrypt', { key, plaintext });
export const aesDecrypt = (key: string, encrypted: string): Promise<string> =>
  invoke('aes_decrypt', { key, encrypted });
export const generateSalt = (): Promise<string> => invoke('generate_salt_cmd');
export const generateUuid = (): Promise<string> => invoke('generate_uuid');

// SSH
export interface SshKeygenResult {
  public_key: string;
  private_key: string;
  fingerprint: string;
  key_type: string;
}

export interface AgentKey {
  fingerprint: string;
  comment: string;
  key_type: string;
}

export interface RepoConfig {
  path: string;
  remote_url?: string;
  ssh_key_path?: string;
  has_ssh_config: boolean;
}

export const sshGenerateKey = (name: string, keyType: string, comment: string): Promise<SshKeygenResult> =>
  invoke('ssh_generate_key', { name, keyType, comment });
export const sshGetFingerprint = (publicKey: string): Promise<string> =>
  invoke('ssh_get_fingerprint', { publicKey });
export const sshImportKeys = (): Promise<ImportedKey[]> =>
  invoke('ssh_import_keys');
export const sshExportKey = (
  privateKey: string,
  path: string,
  passphrase?: string
): Promise<void> =>
  invoke('ssh_export_key', { privateKey, publicKey: null, path, passphrase });
export const sshAgentAdd = (
  privateKey: string,
  lifetimeSeconds?: number
): Promise<void> =>
  invoke('ssh_agent_add', { privateKey, lifetimeSeconds });
export const sshAgentList = (): Promise<AgentKey[]> =>
  invoke('ssh_agent_list');
export const sshAgentRemove = (fingerprint: string): Promise<void> =>
  invoke('ssh_agent_remove', { fingerprint });
export const sshAgentClear = (): Promise<void> =>
  invoke('ssh_agent_clear');

// Git integration
export const gitSetSshKey = (repoPath: string, keyPath: string): Promise<void> =>
  invoke('git_set_ssh_key', { repoPath, keyPath });
export const gitRemoveSshKey = (repoPath: string): Promise<void> =>
  invoke('git_remove_ssh_key', { repoPath });
export const gitSetupDeployKey = (
  repoPath: string,
  privateKey: string,
  keyName: string
): Promise<string> =>
  invoke('git_setup_deploy_key', { repoPath, privateKey, keyName });

// Settings
export const getSettings = (): Promise<Settings> =>
  invoke('settings_get');
export const setSettings = (settings: Settings): Promise<void> =>
  invoke('settings_set', { settings });
export const resetSettings = (): Promise<Settings> =>
  invoke('settings_reset');

// Biometric
export const biometricAvailable = (): Promise<boolean> => invoke('biometric_available');
export const biometricStoreKey = (vaultId: string, key: string): Promise<void> => 
  invoke('biometric_store_key', { vaultId, key });
export const biometricRetrieveKey = (vaultId: string): Promise<string | null> => 
  invoke('biometric_retrieve_key', { vaultId });
export const biometricDeleteKey = (vaultId: string): Promise<void> => 
  invoke('biometric_delete_key', { vaultId });
export const biometricUnlock = (vaultId: string, reason: string): Promise<string | null> => 
  invoke('biometric_unlock', { vaultId, reason });

// PGP key management
export interface PgpKeyMetadata {
  id: string;
  name: string;
  fingerprint: string;
  key_id: string;
  algorithm: string;
  bit_length: number;
  created: string;
  user_ids: string[];
}

export const pgpGenerateKey = (vaultId: string, name: string, email: string, passphrase: string): Promise<PgpKeyMetadata> =>
  invoke('pgp_generate_key', { vaultId, name, email, passphrase });
export const pgpImportKey = (vaultId: string, armoredKey: string): Promise<PgpKeyMetadata> =>
  invoke('pgp_import_key', { vaultId, armoredKey });
export const pgpDeleteKey = (vaultId: string, keyId: string): Promise<void> =>
  invoke('pgp_delete_key', { vaultId, keyId });
export const pgpListKeys = (vaultId: string): Promise<PgpKeyMetadata[]> =>
  invoke('pgp_list_keys', { vaultId });

// Agent Chest proxy commands
export const proxyStart = (proxyPort?: number, mgmtPort?: number): Promise<ProxyStatus> =>
  invoke('proxy_start', { proxyPort, mgmtPort });
export const proxyStop = (): Promise<void> =>
  invoke('proxy_stop');
export const proxyGetStatus = (mgmtPort?: number): Promise<ProxyStatus> =>
  invoke('proxy_status', { mgmtPort });
export const proxyListCredentials = (mgmtPort?: number): Promise<ProxyCredential[]> =>
  invoke('proxy_list_credentials', { mgmtPort });
export const proxyAddCredential = (credential: ProxyCredential, mgmtPort?: number): Promise<ProxyCredential> =>
  invoke('proxy_add_credential', { mgmtPort, credential });
export const proxyDeleteCredential = (id: string, mgmtPort?: number): Promise<void> =>
  invoke('proxy_delete_credential', { id, mgmtPort });
export const proxyListRules = (mgmtPort?: number): Promise<ProxyRule[]> =>
  invoke('proxy_list_rules', { mgmtPort });
export const proxyAddRule = (rule: ProxyRule, mgmtPort?: number): Promise<ProxyRule> =>
  invoke('proxy_add_rule', { mgmtPort, rule });
export const proxyDeleteRule = (id: string, mgmtPort?: number): Promise<void> =>
  invoke('proxy_delete_rule', { id, mgmtPort });
export const proxyListBindings = (mgmtPort?: number): Promise<ProxyBinding[]> =>
  invoke('proxy_list_bindings', { mgmtPort });
export const proxyAddBinding = (vaultId: string, credentialIds: string[], ruleIds: string[], mgmtPort?: number): Promise<ProxyBinding> =>
  invoke('proxy_add_binding', { vaultId, credentialIds, ruleIds, mgmtPort });
export const proxyDeleteBinding = (id: string, mgmtPort?: number): Promise<void> =>
  invoke('proxy_delete_binding', { id, mgmtPort });
export const proxyListProposals = (mgmtPort?: number, vaultId?: string, status?: string): Promise<ProxyProposal[]> =>
  invoke('proxy_list_proposals', { mgmtPort, vaultId, status });
export const proxyCreateProposal = (proposal: ProxyProposal, mgmtPort?: number): Promise<ProxyProposal> =>
  invoke('proxy_create_proposal', { mgmtPort, proposal });
export const proxyApproveProposal = (id: string, mgmtPort?: number): Promise<ProxyProposal> =>
  invoke('proxy_approve_proposal', { id, mgmtPort });
export const proxyDenyProposal = (id: string, mgmtPort?: number): Promise<ProxyProposal> =>
  invoke('proxy_deny_proposal', { id, mgmtPort });
export const proxyListAgents = (mgmtPort?: number, vaultId?: string): Promise<ProxyAgent[]> =>
  invoke('proxy_list_agents', { mgmtPort, vaultId });
export const proxyRotateAgentToken = (id: string, mgmtPort?: number): Promise<ProxyAgent> =>
  invoke('proxy_rotate_agent_token', { id, mgmtPort });
export const proxyRevokeAgent = (id: string, mgmtPort?: number): Promise<ProxyAgent> =>
  invoke('proxy_revoke_agent', { id, mgmtPort });
export const proxyListInvites = (mgmtPort?: number, vaultId?: string): Promise<ProxyInvite[]> =>
  invoke('proxy_list_invites', { mgmtPort, vaultId });
export const proxyCreateInvite = (vaultId: string, name: string, mgmtPort?: number): Promise<ProxyInvite> =>
  invoke('proxy_create_invite', { vaultId, name, mgmtPort });
export const proxyRedeemInvite = (code: string, name?: string, mgmtPort?: number): Promise<ProxyRedeemInviteResponse> =>
  invoke('proxy_redeem_invite', { code, name, mgmtPort });
export const proxyAuditLog = (limit?: number, offset?: number, mgmtPort?: number): Promise<AuditEntry[]> =>
  invoke('proxy_audit_log', { limit, offset, mgmtPort });
export const proxyDiscover = (mgmtPort?: number, vaultId?: string): Promise<DiscoverResponse> =>
  invoke('proxy_discover', { mgmtPort, vaultId });
