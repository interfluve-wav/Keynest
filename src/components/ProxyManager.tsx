import { useState, useEffect, useCallback } from 'react'
import {
  Shield, Play, Square, Plus, Trash2, RefreshCw,
  Server, Lock, Eye, EyeOff,
  FileText, Key as KeyIcon, Filter, Link, Compass
} from 'lucide-react'
import { useVaultStore } from '../lib/store'
import {
  proxyStart, proxyStop, proxyGetStatus,
  proxyListCredentials, proxyAddCredential, proxyDeleteCredential,
  proxyListRules, proxyAddRule, proxyDeleteRule,
  proxyListBindings, proxyAddBinding, proxyDeleteBinding,
  proxyAuditLog, proxyDiscover
} from '../lib/api'
import type { ProxyCredential, ProxyRule, ProxyBinding, AuditEntry, DiscoverService } from '../lib/types'
import { ErrorBoundary } from './ErrorBoundary'

type ProxyTab = 'discover' | 'credentials' | 'rules' | 'bindings' | 'audit'

export function ProxyManager() {
  const {
    proxyStatus, proxyCredentials, proxyRules, proxyBindings, proxyAuditLog: proxyAuditEntries,
    setProxyStatus, setProxyCredentials, setProxyRules, setProxyBindings, setProxyAuditLog: setProxyAuditEntries,
    currentVault
  } = useVaultStore()

  const [activeTab, setActiveTab] = useState<ProxyTab>('discover')
  const [showAddCred, setShowAddCred] = useState(false)
  const [showAddRule, setShowAddRule] = useState(false)
  const [showAddBinding, setShowAddBinding] = useState(false)
  const [loading, setLoading] = useState(false)
  const [discoverData, setDiscoverData] = useState<{ services: DiscoverService[]; available_credential_keys: string[] } | null>(null)

  const refreshAll = useCallback(async () => {
    const status = await proxyGetStatus().catch(() => null)
    setProxyStatus(status)
    if (status?.running) {
      const creds = await proxyListCredentials().catch(() => [])
      setProxyCredentials(creds)
      const rules = await proxyListRules().catch(() => [])
      setProxyRules(rules)
      const bindings = await proxyListBindings().catch(() => [])
      setProxyBindings(bindings)
      const audit = await proxyAuditLog(50).catch(() => [])
      setProxyAuditEntries(audit)
      const disco = await proxyDiscover(undefined, currentVault?.id).catch(() => null)
      if (disco) {
        setDiscoverData({ services: disco.services, available_credential_keys: disco.available_credential_keys })
      }
    }
  }, [setProxyStatus, setProxyCredentials, setProxyRules, setProxyBindings, setProxyAuditEntries])

  useEffect(() => { refreshAll() }, [refreshAll])

  const handleStart = async () => {
    setLoading(true)
    try {
      const status = await proxyStart(8080, 8081)
      setProxyStatus(status)
      await refreshAll()
    } catch (e: any) {
      console.error('Failed to start proxy:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleStop = async () => {
    setLoading(true)
    try {
      await proxyStop()
      setProxyStatus(null)
      setProxyCredentials([])
      setProxyRules([])
      setProxyBindings([])
      setProxyAuditEntries([])
    } catch (e: any) {
      console.error('Failed to stop proxy:', e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ErrorBoundary>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${proxyStatus?.running ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">Agent Chest Proxy</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {proxyStatus?.running
                  ? `Running on port ${proxyStatus.proxy_port} (mgmt: ${proxyStatus.mgmt_port})`
                  : 'Not running'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!proxyStatus?.running ? (
              <button
                onClick={handleStart}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-slate-950 font-medium rounded-lg transition-all"
              >
                <Play className="w-4 h-4" />
                {loading ? 'Starting...' : 'Start Proxy'}
              </button>
            ) : (
              <>
                <button
                  onClick={refreshAll}
                  className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800"
                  title="Refresh"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  onClick={handleStop}
                  className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-400 text-white font-medium rounded-lg transition-all"
                >
                  <Square className="w-4 h-4" />
                  Stop
                </button>
              </>
            )}
          </div>
        </div>

        {proxyStatus?.running && (
          <>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 dark:bg-emerald-950/30 dark:border-emerald-800">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                <div className="text-sm text-emerald-800 dark:text-emerald-200">
                  <p className="font-medium">Proxy Active</p>
                  <p className="mt-1 text-emerald-700 dark:text-emerald-300">
                    Configure your agent to use <code className="bg-emerald-100 dark:bg-emerald-900/50 px-1.5 py-0.5 rounded text-xs font-mono">HTTPS_PROXY=http://127.0.0.1:{proxyStatus.proxy_port}</code> and set <code className="bg-emerald-100 dark:bg-emerald-900/50 px-1.5 py-0.5 rounded text-xs font-mono">X-Vault-ID: {currentVault?.id || '&lt;vault-id&gt;'}</code> header. Credentials are brokered at the proxy — agents never touch raw keys.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <TabButton active={activeTab === 'discover'} onClick={() => setActiveTab('discover')} icon={<Compass className="w-4 h-4" />} label="Discover" />
              <TabButton active={activeTab === 'credentials'} onClick={() => setActiveTab('credentials')} icon={<KeyIcon className="w-4 h-4" />} label={`Credentials (${proxyCredentials.length})`} />
              <TabButton active={activeTab === 'rules'} onClick={() => setActiveTab('rules')} icon={<Filter className="w-4 h-4" />} label={`Rules (${proxyRules.length})`} />
              <TabButton active={activeTab === 'bindings'} onClick={() => setActiveTab('bindings')} icon={<Link className="w-4 h-4" />} label={`RBAC (${proxyBindings.length})`} />
              <TabButton active={activeTab === 'audit'} onClick={() => setActiveTab('audit')} icon={<FileText className="w-4 h-4" />} label="Audit" />
              <div className="flex-1" />
              {activeTab === 'credentials' && (
                <button onClick={() => setShowAddCred(true)} className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium rounded-lg transition-all">
                  <Plus className="w-4 h-4" /> Add
                </button>
              )}
              {activeTab === 'rules' && (
                <button onClick={() => setShowAddRule(true)} className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium rounded-lg transition-all">
                  <Plus className="w-4 h-4" /> Add Rule
                </button>
              )}
              {activeTab === 'bindings' && (
                <button onClick={() => setShowAddBinding(true)} className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium rounded-lg transition-all">
                  <Plus className="w-4 h-4" /> Bind
                </button>
              )}
              {activeTab === 'audit' && (
                <button onClick={refreshAll} className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800">
                  <RefreshCw className="w-4 h-4" />
                </button>
              )}
            </div>

            {activeTab === 'discover' && <DiscoverTab data={discoverData} onRefresh={refreshAll} />}
            {activeTab === 'credentials' && <CredentialsList creds={proxyCredentials} onDelete={async (id) => { await proxyDeleteCredential(id); await refreshAll() }} />}
            {activeTab === 'rules' && <RulesList rules={proxyRules} onDelete={async (id) => { await proxyDeleteRule(id); await refreshAll() }} />}
            {activeTab === 'bindings' && <BindingsList bindings={proxyBindings} credentials={proxyCredentials} rules={proxyRules} onDelete={async (id) => { await proxyDeleteBinding(id); await refreshAll() }} />}
            {activeTab === 'audit' && <AuditLog entries={proxyAuditEntries} />}
          </>
        )}

        {!proxyStatus?.running && (
          <div className="text-center py-12 border-2 border-dashed border-slate-300 rounded-2xl dark:border-slate-700">
            <Lock className="w-12 h-12 mx-auto mb-4 text-slate-400 dark:text-slate-600" />
            <p className="text-slate-600 dark:text-slate-500 mb-2">Agent Chest Proxy is not running</p>
            <p className="text-sm text-slate-500 dark:text-slate-600">Start the proxy to broker credentials for AI agents.</p>
          </div>
        )}

        {showAddCred && currentVault && (
          <AddCredentialModal
            vaultId={currentVault.id}
            onClose={() => setShowAddCred(false)}
            onSaved={async (cred) => {
              await proxyAddCredential(cred)
              setShowAddCred(false)
              await refreshAll()
            }}
          />
        )}
        {showAddRule && currentVault && (
          <AddRuleModal
            vaultId={currentVault.id}
            onClose={() => setShowAddRule(false)}
            onSaved={async (rule) => {
              await proxyAddRule(rule)
              setShowAddRule(false)
              await refreshAll()
            }}
          />
        )}
        {showAddBinding && currentVault && (
          <AddBindingModal
            vaultId={currentVault.id}
            credentials={proxyCredentials}
            rules={proxyRules}
            onClose={() => setShowAddBinding(false)}
            onSaved={async (vaultId, credIds, ruleIds) => {
              await proxyAddBinding(vaultId, credIds, ruleIds)
              setShowAddBinding(false)
              await refreshAll()
            }}
          />
        )}
      </div>
    </ErrorBoundary>
  )
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
        active
          ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 dark:text-emerald-400'
          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/50'
      }`}
    >
      {icon} {label}
    </button>
  )
}

function CredentialsList({ creds, onDelete }: { creds: ProxyCredential[]; onDelete: (id: string) => void }) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set())

  if (creds.length === 0) {
    return (
      <div className="text-center py-8 border-2 border-dashed border-slate-300 rounded-xl dark:border-slate-700">
        <KeyIcon className="w-8 h-8 mx-auto mb-3 text-slate-400 dark:text-slate-600" />
        <p className="text-slate-600 dark:text-slate-500">No credentials stored in the proxy</p>
        <p className="text-sm text-slate-500 dark:text-slate-600 mt-1">Add credentials for the APIs your agents need to access.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {creds.map(c => (
        <div key={c.id} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition-colors group dark:bg-slate-900/50 dark:border-slate-800 dark:hover:border-slate-700">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-slate-900 truncate dark:text-white">{c.name}</h4>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono mr-2 ${
                  c.auth_type === 'bearer' ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' :
                  c.auth_type === 'basic_auth' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' :
                  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                }`}>{c.auth_type}</span>
                {c.target_host}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0 ml-3">
              <button
                onClick={() => { const next = new Set(revealed); next.has(c.id) ? next.delete(c.id) : next.add(c.id); setRevealed(next) }}
                className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-slate-900 transition-colors dark:hover:bg-slate-800 dark:text-slate-400 dark:hover:text-white"
                title={revealed.has(c.id) ? 'Hide' : 'Reveal'}
              >
                {revealed.has(c.id) ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button
                onClick={() => onDelete(c.id)}
                className="p-2 hover:bg-red-500/10 rounded-lg text-slate-600 hover:text-red-600 transition-colors opacity-0 group-hover:opacity-100 dark:text-slate-400 dark:hover:text-red-400"
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          {revealed.has(c.id) && c.header_value && (
            <div className="mt-3 bg-slate-100 rounded-lg p-3 font-mono text-xs text-slate-700 dark:bg-slate-950 dark:text-slate-300 break-all">
              {c.header_value}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function RulesList({ rules, onDelete }: { rules: ProxyRule[]; onDelete: (id: string) => void }) {
  if (rules.length === 0) {
    return (
      <div className="text-center py-8 border-2 border-dashed border-slate-300 rounded-xl dark:border-slate-700">
        <Filter className="w-8 h-8 mx-auto mb-3 text-slate-400 dark:text-slate-600" />
        <p className="text-slate-600 dark:text-slate-500">No access rules configured</p>
        <p className="text-sm text-slate-500 dark:text-slate-600 mt-1">Rules control which hosts and paths agents can access.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {rules.map(r => (
        <div key={r.id} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition-colors group dark:bg-slate-900/50 dark:border-slate-800 dark:hover:border-slate-700">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h4 className="font-semibold text-slate-900 dark:text-white">{r.name}</h4>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                  r.action === 'allow' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                }`}>{r.action}</span>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                <span className="font-mono">{r.host_match}</span>
                {r.path_match && r.path_match !== '*' && <span className="font-mono">{r.path_match}</span>}
                {r.methods.length > 0 && <span className="ml-2 text-xs">({r.methods.join(', ')})</span>}
              </p>
            </div>
            <button
              onClick={() => onDelete(r.id)}
              className="p-2 hover:bg-red-500/10 rounded-lg text-slate-600 hover:text-red-600 transition-colors opacity-0 group-hover:opacity-100 dark:text-slate-400 dark:hover:text-red-400"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function BindingsList({ bindings, credentials, rules, onDelete }: {
  bindings: ProxyBinding[]
  credentials: ProxyCredential[]
  rules: ProxyRule[]
  onDelete: (id: string) => void
}) {
  if (bindings.length === 0) {
    return (
      <div className="text-center py-8 border-2 border-dashed border-slate-300 rounded-xl dark:border-slate-700">
        <Link className="w-8 h-8 mx-auto mb-3 text-slate-400 dark:text-slate-600" />
        <p className="text-slate-600 dark:text-slate-500">No RBAC bindings configured</p>
        <p className="text-sm text-slate-500 dark:text-slate-600 mt-1">Bindings map vaults to credentials and rules.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {bindings.map(b => (
        <div key={b.id} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition-colors group dark:bg-slate-900/50 dark:border-slate-800 dark:hover:border-slate-700">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-4 h-4 text-violet-500" />
                <span className="font-mono text-xs text-slate-600 dark:text-slate-400">vault: {b.vault_id.slice(0, 8)}...</span>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  <span className="font-medium">Credentials:</span> {b.credential_ids.length === 0 ? 'none' : b.credential_ids.map(id => {
                    const c = credentials.find(cred => cred.id === id)
                    return c ? c.name : id.slice(0, 8)
                  }).join(', ')}
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  <span className="font-medium">Rules:</span> {b.rule_ids.length === 0 ? 'none' : b.rule_ids.map(id => {
                    const r = rules.find(rule => rule.id === id)
                    return r ? r.name : id.slice(0, 8)
                  }).join(', ')}
                </p>
              </div>
            </div>
            <button
              onClick={() => onDelete(b.id)}
              className="p-2 hover:bg-red-500/10 rounded-lg text-slate-600 hover:text-red-600 transition-colors opacity-0 group-hover:opacity-100 dark:text-slate-400 dark:hover:text-red-400"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function DiscoverTab({ data, onRefresh }: { data: { services: DiscoverService[]; available_credential_keys: string[] } | null; onRefresh: () => void }) {
  if (!data) {
    return (
      <div className="text-center py-8 border-2 border-dashed border-slate-300 rounded-xl dark:border-slate-700">
        <Compass className="w-8 h-8 mx-auto mb-3 text-slate-400 dark:text-slate-600" />
        <p className="text-slate-600 dark:text-slate-500">No discover data available</p>
        <p className="text-sm text-slate-500 dark:text-slate-600 mt-1">Start the proxy and configure credentials/rules to see available services.</p>
        <button onClick={onRefresh} className="mt-3 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium rounded-lg transition-all text-sm">
          Refresh
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-500" /> Network Guard
        </h4>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          The proxy blocks requests to private IPs (RFC1918), loopback addresses, link-local addresses, and cloud metadata endpoints (169.254.169.254) by default to prevent SSRF attacks. Use <code className="bg-slate-200 dark:bg-slate-800 px-1 rounded">--network-mode=private</code> to allow private IPs in trusted networks.
        </p>
      </div>

      <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
          <Compass className="w-4 h-4 text-emerald-500" /> Available Services
        </h4>
        {data.services.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No services configured yet. Add credentials and rules to define available hosts.</p>
        ) : (
          <div className="space-y-2">
            {data.services.map((s, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                <div>
                  <span className="font-mono text-sm text-slate-900 dark:text-white">{s.host}</span>
                  {s.description && <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{s.description}</span>}
                </div>
                <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">allowed</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
          <KeyIcon className="w-4 h-4 text-emerald-500" /> Available Credential Keys
        </h4>
        {data.available_credential_keys.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No credentials stored yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.available_credential_keys.map((k, i) => (
              <span key={i} className="px-2 py-1 text-xs font-mono rounded bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400">{k}</span>
            ))}
          </div>
        )}
      </div>

      <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
          <Server className="w-4 h-4 text-emerald-500" /> Agent Connection
        </h4>
        <div className="space-y-2 text-xs text-slate-600 dark:text-slate-400 font-mono">
          <p><span className="text-slate-400">HTTPS_PROXY</span>=http://127.0.0.1:8080</p>
          <p><span className="text-slate-400">X-Vault-ID</span>: &lt;your-vault-id&gt;</p>
          <p className="text-slate-500 dark:text-slate-500 pt-1">Or use the explicit proxy endpoint:</p>
          <p>GET http://127.0.0.1:8081/proxy/&#123;target_host&#125;/&#123;path&#125;</p>
        </div>
      </div>
    </div>
  )
}

function AuditLog({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-8 border-2 border-dashed border-slate-300 rounded-xl dark:border-slate-700">
        <FileText className="w-8 h-8 mx-auto mb-3 text-slate-400 dark:text-slate-600" />
        <p className="text-slate-600 dark:text-slate-500">No audit entries yet</p>
        <p className="text-sm text-slate-500 dark:text-slate-600 mt-1">Audit logs will appear here as agents make proxied requests.</p>
      </div>
    )
  }

  return (
    <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 dark:text-slate-400">Time</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 dark:text-slate-400">Method</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 dark:text-slate-400">Target</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 dark:text-slate-400">Action</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 dark:text-slate-400">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 dark:text-slate-400">Rule</th>
            </tr>
          </thead>
          <tbody>
            {entries.slice().reverse().map((e, i) => (
              <tr key={i} className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-100/50 dark:hover:bg-slate-800/30">
                <td className="px-4 py-2.5 font-mono text-xs text-slate-600 dark:text-slate-400">{new Date(e.timestamp).toLocaleTimeString()}</td>
                <td className="px-4 py-2.5"><span className="font-mono text-xs">{e.method}</span></td>
                <td className="px-4 py-2.5 font-mono text-xs">{e.target}{e.path !== '/' ? e.path : ''}</td>
                <td className="px-4 py-2.5">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono ${
                    e.action === 'broker' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' :
                    e.action === 'deny' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
                    'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}>{e.action}</span>
                </td>
                <td className="px-4 py-2.5 font-mono text-xs">{e.status_code}</td>
                <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-400 max-w-[200px] truncate">{e.rule || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AddCredentialModal({ vaultId, onClose, onSaved }: { vaultId: string; onClose: () => void; onSaved: (cred: ProxyCredential) => Promise<void> }) {
  const [name, setName] = useState('')
  const [targetHost, setTargetHost] = useState('')
  const [authType, setAuthType] = useState<'bearer' | 'api_key_header' | 'basic_auth'>('bearer')
  const [headerName, setHeaderName] = useState('')
  const [headerValue, setHeaderValue] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await onSaved({
        id: '',
        name: name || 'Unnamed Credential',
        vault_id: vaultId,
        target_host: targetHost || '*',
        target_prefix: '',
        auth_type: authType,
        header_name: authType === 'api_key_header' ? (headerName || 'X-API-Key') : '',
        header_value: headerValue,
        created_at: new Date().toISOString(),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={onClose}>
      <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-lg shadow-2xl dark:bg-slate-900 dark:border-slate-800" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Add Credential</h2>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-slate-600 dark:hover:text-white">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="OpenAI API Key"
              className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Target Host</label>
            <input type="text" value={targetHost} onChange={e => setTargetHost(e.target.value)} placeholder="api.openai.com"
              className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Auth Type</label>
            <div className="flex gap-2">
              {(['bearer', 'api_key_header', 'basic_auth'] as const).map(t => (
                <button key={t} type="button" onClick={() => setAuthType(t)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-mono transition-all ${authType === t ? 'bg-emerald-500 text-slate-950' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'}`}>
                  {t === 'bearer' ? 'Bearer' : t === 'api_key_header' ? 'API Key' : 'Basic'}
                </button>
              ))}
            </div>
          </div>
          {authType === 'api_key_header' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Header Name</label>
              <input type="text" value={headerName} onChange={e => setHeaderName(e.target.value)} placeholder="steel-api-key"
                className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all font-mono text-sm dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500" />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {authType === 'bearer' ? 'Token' : authType === 'api_key_header' ? 'API Key Value' : 'Base64(user:pass)'}
            </label>
            <input type="password" value={headerValue} onChange={e => setHeaderValue(e.target.value)}
              placeholder={authType === 'bearer' ? 'sk-...' : authType === 'api_key_header' ? 'x-api-key:value' : 'dXNlcjpwYXNz'}
              className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all font-mono text-sm dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg transition-colors dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-white">Cancel</button>
            <button type="submit" disabled={!headerValue || saving} className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 dark:disabled:text-slate-500 text-slate-950 font-semibold rounded-lg transition-colors">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AddRuleModal({ vaultId, onClose, onSaved }: { vaultId: string; onClose: () => void; onSaved: (rule: ProxyRule) => Promise<void> }) {
  const [name, setName] = useState('')
  const [hostMatch, setHostMatch] = useState('*')
  const [pathMatch, setPathMatch] = useState('*')
  const [methods, setMethods] = useState<string[]>(['*'])
  const [action, setAction] = useState<'allow' | 'deny'>('allow')
  const [saving, setSaving] = useState(false)

  const toggleMethod = (m: string) => {
    setMethods(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await onSaved({
        id: '',
        vault_id: vaultId,
        name: name || 'Unnamed Rule',
        host_match: hostMatch,
        path_match: pathMatch,
        methods: methods.length === 0 ? ['*'] : methods,
        action,
        created_at: new Date().toISOString(),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={onClose}>
      <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-lg shadow-2xl dark:bg-slate-900 dark:border-slate-800" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Add Access Rule</h2>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-slate-600 dark:hover:text-white">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Rule Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Allow OpenAI API"
              className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Host Match Pattern</label>
            <input type="text" value={hostMatch} onChange={e => setHostMatch(e.target.value)} placeholder="*.openai.com"
              className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all font-mono text-sm dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Path Match Pattern</label>
            <input type="text" value={pathMatch} onChange={e => setPathMatch(e.target.value)} placeholder="/v1/*"
              className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all font-mono text-sm dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Methods</label>
            <div className="flex gap-2 flex-wrap">
              {['*', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map(m => (
                <button key={m} type="button" onClick={() => toggleMethod(m)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-mono transition-all ${methods.includes(m) ? 'bg-emerald-500 text-slate-950' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Action</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setAction('allow')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${action === 'allow' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'}`}>
                Allow
              </button>
              <button type="button" onClick={() => setAction('deny')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${action === 'deny' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'}`}>
                Deny
              </button>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg transition-colors dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-white">Cancel</button>
            <button type="submit" disabled={!name || saving} className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 text-slate-950 font-semibold rounded-lg transition-colors">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AddBindingModal({ vaultId, credentials, rules, onClose, onSaved }: {
  vaultId: string
  credentials: ProxyCredential[]
  rules: ProxyRule[]
  onClose: () => void
  onSaved: (vaultId: string, credIds: string[], ruleIds: string[]) => Promise<void>
}) {
  const [selectedCreds, setSelectedCreds] = useState<Set<string>>(new Set())
  const [selectedRules, setSelectedRules] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await onSaved(vaultId, Array.from(selectedCreds), Array.from(selectedRules))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn" onClick={onClose}>
      <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-lg shadow-2xl dark:bg-slate-900 dark:border-slate-800 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Create RBAC Binding</h2>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-slate-600 dark:hover:text-white">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 flex-1 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Credentials</label>
            {credentials.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No credentials available. Add some first.</p>
            ) : (
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {credentials.map(c => (
                  <label key={c.id} className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-all ${selectedCreds.has(c.id) ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-slate-100 border border-slate-200 hover:bg-slate-200 dark:bg-slate-800/50 dark:border-slate-700 dark:hover:bg-slate-800'}`}>
                    <input type="checkbox" checked={selectedCreds.has(c.id)} onChange={() => { const next = new Set(selectedCreds); next.has(c.id) ? next.delete(c.id) : next.add(c.id); setSelectedCreds(next) }} className="accent-emerald-500 w-4 h-4" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-slate-900 dark:text-white truncate">{c.name}</p>
                      <p className="text-xs text-slate-600 dark:text-slate-500">{c.target_host} · {c.auth_type}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Rules</label>
            {rules.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No rules available. Add some first.</p>
            ) : (
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {rules.map(r => (
                  <label key={r.id} className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-all ${selectedRules.has(r.id) ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-slate-100 border border-slate-200 hover:bg-slate-200 dark:bg-slate-800/50 dark:border-slate-700 dark:hover:bg-slate-800'}`}>
                    <input type="checkbox" checked={selectedRules.has(r.id)} onChange={() => { const next = new Set(selectedRules); next.has(r.id) ? next.delete(r.id) : next.add(r.id); setSelectedRules(next) }} className="accent-emerald-500 w-4 h-4" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-slate-900 dark:text-white">{r.name}</p>
                      <p className="text-xs text-slate-600 dark:text-slate-500">{r.host_match} · {r.action}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg transition-colors dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-white">Cancel</button>
            <button type="submit" disabled={(selectedCreds.size === 0 && selectedRules.size === 0) || saving} className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 text-slate-950 font-semibold rounded-lg transition-colors">
              {saving ? 'Creating...' : 'Create Binding'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}