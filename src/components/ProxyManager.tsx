import { useState, useEffect, useCallback } from 'react'
import {
  Shield, Play, Square, Plus, Trash2, RefreshCw,
  Server, Lock, Eye, EyeOff, Check, XCircle,
  FileText, Key as KeyIcon, Filter, Link, Compass, FlaskConical, BookTemplate, Sparkles,
  Activity, RotateCcw, AlertTriangle, CircleDot, Terminal
} from 'lucide-react'
import { useVaultStore } from '../lib/store'
import {
  proxyStart, proxyStop, proxyGetStatus, proxyForceReset, proxyDiagnostics,
  proxyListCredentials, proxyAddCredential, proxyDeleteCredential,
  proxyListRules, proxyAddRule, proxyDeleteRule,
  proxyListBindings, proxyAddBinding, proxyDeleteBinding,
  proxyAuditLog, proxyDiscover, proxyListProposals, proxyApproveProposal, proxyDenyProposal,
  proxyListAgents, proxyRotateAgentTokenWithTtl, proxyRevokeAgent, proxyListInvites, proxyCreateInvite, proxyRedeemInviteWithTtl,
  proxyRuleTest, proxyListPolicyTemplates, proxyApplyPolicyTemplate, proxyDetectTools, proxyWriteToolLauncher
} from '../lib/api'
import type { ProxyCredential, ProxyRule, ProxyBinding, ProxyProposal, ProxyAgent, ProxyInvite, ProxyRedeemInviteResponse, AuditEntry, DiscoverService, ProxyRuleTestResponse, ProxyPolicyTemplate, ProxyDiagnostics, ProxyToolDetection, ProxyToolLauncherWriteResult } from '../lib/types'
import type { ProxyStatus } from '../lib/types'
import { ErrorBoundary } from './ErrorBoundary'
import { toast } from './VaultDashboard'

type ProxyTab = 'discover' | 'credentials' | 'rules' | 'bindings' | 'proposals' | 'agents' | 'rule_tester' | 'templates' | 'audit'

function formatError(err: unknown): string {
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'toString' in err) return String(err)
  return 'Unexpected error'
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: any
  const timeout = new Promise<T>((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    clearTimeout(t)
  }
}

function formatRemaining(expiresAt: string, nowMs: number): string {
  const delta = new Date(expiresAt).getTime() - nowMs
  if (Number.isNaN(delta) || delta <= 0) return 'expired'
  const totalSec = Math.floor(delta / 1000)
  const hours = Math.floor(totalSec / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`
  return `${mins}m ${secs}s`
}

export function ProxyManager() {
  const {
    proxyStatus, proxyCredentials, proxyRules, proxyBindings, proxyProposals, proxyAgents, proxyInvites, proxyAuditLog: proxyAuditEntries,
    setProxyStatus, setProxyCredentials, setProxyRules, setProxyBindings, setProxyProposals, setProxyAgents, setProxyInvites, setProxyAuditLog: setProxyAuditEntries,
    currentVault, settings
  } = useVaultStore()

  const [activeTab, setActiveTab] = useState<ProxyTab>('discover')
  const [showAddCred, setShowAddCred] = useState(false)
  const [showAddRule, setShowAddRule] = useState(false)
  const [showAddBinding, setShowAddBinding] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [onboardingTesting, setOnboardingTesting] = useState(false)
  const [onboardingMessage, setOnboardingMessage] = useState('')
  const [discoverData, setDiscoverData] = useState<{ services: DiscoverService[]; available_credential_keys: string[] } | null>(null)
  const [ruleTestResult, setRuleTestResult] = useState<ProxyRuleTestResponse | null>(null)
  const [policyTemplates, setPolicyTemplates] = useState<ProxyPolicyTemplate[]>([])
  const [diagnostics, setDiagnostics] = useState<ProxyDiagnostics | null>(null)
  const [panicking, setPanicking] = useState(false)

  const refreshAll = useCallback(async () => {
    const status = await proxyGetStatus().catch(() => null)
    const diag = await proxyDiagnostics(8080, 8081).catch(() => null)
    setDiagnostics(diag)
    setProxyStatus(status)
    if (status?.running) {
      const creds = await proxyListCredentials().catch(() => [])
      setProxyCredentials(creds)
      const rules = await proxyListRules().catch(() => [])
      setProxyRules(rules)
      const bindings = await proxyListBindings().catch(() => [])
      setProxyBindings(bindings)
      const proposals = await proxyListProposals(undefined, currentVault?.id).catch(() => [])
      setProxyProposals(proposals)
      const agents = await proxyListAgents(undefined, currentVault?.id).catch(() => [])
      setProxyAgents(agents)
      const invites = await proxyListInvites(undefined, currentVault?.id).catch(() => [])
      setProxyInvites(invites)
      const audit = await proxyAuditLog(50).catch(() => [])
      setProxyAuditEntries(audit)
      const disco = await proxyDiscover(undefined, currentVault?.id).catch(() => null)
      const templates = await proxyListPolicyTemplates().catch(() => [])
      if (disco) {
        setDiscoverData({ services: disco.services, available_credential_keys: disco.available_credential_keys })
      }
      setPolicyTemplates(templates)
    }
  }, [currentVault?.id, setProxyStatus, setProxyCredentials, setProxyRules, setProxyBindings, setProxyProposals, setProxyAgents, setProxyInvites, setProxyAuditEntries])

  useEffect(() => { refreshAll() }, [refreshAll])

  const handleStart = async () => {
    setLoading(true)
    try {
      let status: ProxyStatus
      try {
        status = await withTimeout(proxyStart(8080, 8081), 12000, 'Starting proxy')
      } catch (e: any) {
        const msg = formatError(e)
        // Common: stale running proxy (app restart) or raced stop/start.
        if (msg.includes('already running')) {
          try {
            await withTimeout(proxyStop(), 5000, 'Stopping existing proxy')
            await sleep(300)
            status = await withTimeout(proxyStart(8080, 8081), 12000, 'Restarting proxy')
          } catch (e2: any) {
            throw new Error(`${msg} (auto-restart failed: ${formatError(e2)})`)
          }
        } else {
          // If UI timeout fires but backend completed startup, recover gracefully.
          const maybeStatus = await proxyGetStatus().catch(() => null)
          if (maybeStatus?.running) {
            status = maybeStatus
          } else {
            throw e
          }
        }
      }

      setProxyStatus(status)
      await refreshAll()
      toast(`Proxy started (ports ${status.proxy_port}/${status.mgmt_port})`, 'success')
    } catch (e: any) {
      console.error('Failed to start proxy:', e)
      toast(`Failed to start proxy: ${formatError(e)}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleStop = async () => {
    setLoading(true)
    try {
      await withTimeout(proxyStop(), 5000, 'Stopping proxy')
      // Wait for status to flip before clearing the UI, otherwise stop/start can race.
      for (let i = 0; i < 10; i++) {
        const s = await withTimeout(proxyGetStatus().catch(() => null), 2000, 'Checking proxy status')
        if (!s?.running) break
        await sleep(150)
      }

      setProxyStatus(null)
      setProxyCredentials([])
      setProxyRules([])
      setProxyBindings([])
      setProxyProposals([])
      setProxyAgents([])
      setProxyInvites([])
      setProxyAuditEntries([])
      toast('Proxy stopped', 'info')
    } catch (e: any) {
      console.error('Failed to stop proxy:', e)
      toast(`Failed to stop proxy: ${formatError(e)}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleForceReset = async () => {
    setResetting(true)
    try {
      await withTimeout(proxyForceReset(8080, 8081), 7000, 'Force resetting proxy')
      setProxyStatus(null)
      setProxyCredentials([])
      setProxyRules([])
      setProxyBindings([])
      setProxyProposals([])
      setProxyAgents([])
      setProxyInvites([])
      setProxyAuditEntries([])
      await refreshAll()
      toast('Proxy force-reset complete', 'info')
    } catch (e: any) {
      toast(`Force reset failed: ${formatError(e)}`, 'error')
    } finally {
      setResetting(false)
    }
  }

  const handleTestSetup = async () => {
    setOnboardingTesting(true)
    setOnboardingMessage('')
    try {
      await refreshAll()
      const status = await proxyGetStatus().catch(() => null)
      if (!status?.running) {
        setOnboardingMessage('Proxy is not running yet.')
        return
      }
      if (!currentVault?.id) {
        setOnboardingMessage('No vault selected.')
        return
      }

      const creds = await proxyListCredentials().catch(() => [])
      const rules = await proxyListRules().catch(() => [])
      const invites = await proxyListInvites(undefined, currentVault.id).catch(() => [])
      const test = await proxyRuleTest({
        vault_id: currentVault.id,
        host: 'api.openai.com',
        path: '/v1/models',
        method: 'GET',
      }).catch(() => null)

      if (creds.length === 0 || rules.length === 0) {
        setOnboardingMessage('Add at least one credential and one rule to pass setup test.')
        return
      }
      if (invites.length === 0) {
        setOnboardingMessage('Create or redeem an invite to complete agent onboarding.')
        return
      }
      if (!test) {
        setOnboardingMessage('Rule test did not return a response. Check proxy diagnostics.')
        return
      }
      setOnboardingMessage(`Setup test passed (${test.allow ? 'allow' : 'deny'}): ${test.reason}`)
      setRuleTestResult(test)
      toast('Onboarding setup test passed', 'success')
    } catch (e) {
      setOnboardingMessage(`Setup test failed: ${formatError(e)}`)
      toast(`Setup test failed: ${formatError(e)}`, 'error')
    } finally {
      setOnboardingTesting(false)
    }
  }

  const handlePanicRevokeAll = async () => {
    const activeAgents = proxyAgents.filter(a => a.status === 'active')
    if (activeAgents.length === 0) {
      toast('No active agents to revoke', 'info')
      return
    }
    const ok = window.confirm(`Revoke all ${activeAgents.length} active agent tokens now?`)
    if (!ok) return
    setPanicking(true)
    try {
      const results = await Promise.allSettled(activeAgents.map(a => proxyRevokeAgent(a.id)))
      const failed = results.filter(r => r.status === 'rejected').length
      await refreshAll()
      if (failed === 0) {
        toast(`Revoked ${activeAgents.length} active agents`, 'success')
      } else {
        toast(`Revoked ${activeAgents.length - failed}/${activeAgents.length}; ${failed} failed`, 'error')
      }
    } finally {
      setPanicking(false)
    }
  }

  const nowMs = Date.now()
  const hasValidToken = proxyAgents.some(a => a.status === 'active' && (!a.expires_at || new Date(a.expires_at).getTime() > nowMs))
  const hasAllowRules = proxyRules.some(r => r.action === 'allow')
  const lastBroker = proxyAuditEntries
    .slice()
    .reverse()
    .find(e => e.action === 'broker' && e.status_code >= 200 && e.status_code < 400)
  const healthLevel: 'green' | 'yellow' | 'red' = !proxyStatus?.running
    ? 'red'
    : (hasValidToken && hasAllowRules && Boolean(lastBroker))
      ? 'green'
      : 'yellow'
  const healthLabel = healthLevel === 'green' ? 'Healthy' : healthLevel === 'yellow' ? 'Needs Attention' : 'Offline'
  const healthTone = healthLevel === 'green'
    ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
    : healthLevel === 'yellow'
      ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'
      : 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'

  return (
    <ErrorBoundary>
      <div className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[1.2fr,1fr]">
          <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/40">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className={`rounded-xl p-2.5 ${proxyStatus?.running ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                  <Server className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold tracking-tight text-slate-900 dark:text-white">Agent Chest Proxy</h3>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    {proxyStatus?.running
                      ? `Running on port ${proxyStatus.proxy_port} (mgmt: ${proxyStatus.mgmt_port})`
                      : 'Not running'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  onClick={refreshAll}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  title="Refresh"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </button>
                {!proxyStatus?.running ? (
                  <button
                    onClick={handleStart}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-medium text-slate-950 transition-all hover:bg-emerald-400 disabled:bg-slate-300 dark:disabled:bg-slate-700"
                  >
                    <Play className="h-4 w-4" />
                    {loading ? 'Starting...' : 'Start Proxy'}
                  </button>
                ) : (
                  <button
                    onClick={handleStop}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-3.5 py-2 text-sm font-medium text-white transition-all hover:bg-red-400 disabled:opacity-60"
                  >
                    <Square className="h-4 w-4" />
                    {loading ? 'Stopping...' : 'Stop'}
                  </button>
                )}
                <button
                  onClick={handleForceReset}
                  disabled={resetting}
                  className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-sm font-medium text-amber-700 transition-all hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/40"
                  title="Force kill stale proxy listeners on 8080/8081"
                >
                  <RotateCcw className="h-4 w-4" />
                  {resetting ? 'Resetting...' : 'Force Reset'}
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50/70 p-4 shadow-sm backdrop-blur dark:border-slate-800 dark:from-slate-900 dark:to-slate-900/40">
            <div className="mb-2 flex items-center gap-2">
              <Activity className="h-4 w-4 text-slate-500 dark:text-slate-300" />
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Health</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <HealthPill label="Mgmt API" ok={Boolean(diagnostics?.mgmt_reachable)} value={diagnostics?.mgmt_reachable ? 'Reachable' : 'Offline'} />
              <HealthPill label="Proxy Port" ok={Boolean(diagnostics?.proxy_listener_pids?.length)} value={diagnostics?.proxy_listener_pids?.length ? 'Listening' : 'Idle'} />
              <HealthPill label="Mgmt Port" ok={Boolean(diagnostics?.mgmt_listener_pids?.length)} value={diagnostics?.mgmt_listener_pids?.length ? 'Listening' : 'Idle'} />
              <HealthPill label="Status" ok={Boolean(proxyStatus?.running)} value={proxyStatus?.running ? 'Running' : 'Stopped'} />
            </div>
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
                    Configure your agent with <code className="bg-emerald-100 dark:bg-emerald-900/50 px-1.5 py-0.5 rounded text-xs font-mono">HTTPS_PROXY=http://127.0.0.1:{proxyStatus.proxy_port}</code> and <code className="bg-emerald-100 dark:bg-emerald-900/50 px-1.5 py-0.5 rounded text-xs font-mono">Proxy-Authorization: Bearer &lt;agent-token&gt;</code>. Legacy <code className="bg-emerald-100 dark:bg-emerald-900/50 px-1.5 py-0.5 rounded text-xs font-mono">X-*</code> headers still work as fallback.
                  </p>
                </div>
              </div>
            </div>

            <div className={`rounded-xl border p-3 ${healthTone}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Live Health: {healthLabel}</p>
                <span className="text-xs">
                  {lastBroker ? `Last success: ${new Date(lastBroker.timestamp).toLocaleTimeString()}` : 'No successful brokered call yet'}
                </span>
              </div>
              <div className="mt-2 grid gap-2 text-xs md:grid-cols-3">
                <span>Proxy: {proxyStatus?.running ? 'up' : 'down'}</span>
                <span>Token: {hasValidToken ? 'valid active token' : 'missing/expired'}</span>
                <span>Rules: {hasAllowRules ? 'allow rules present' : 'no allow rules'}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px,1fr]">
              <aside className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-white/80 p-3 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/40">
                  <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Proxy Console</p>
                  <div className="space-y-1.5">
                    <TabButton active={activeTab === 'discover'} onClick={() => setActiveTab('discover')} icon={<Compass className="w-4 h-4" />} label="Discover" />
                    <TabButton active={activeTab === 'credentials'} onClick={() => setActiveTab('credentials')} icon={<KeyIcon className="w-4 h-4" />} label={`Credentials (${proxyCredentials.length})`} />
                    <TabButton active={activeTab === 'rules'} onClick={() => setActiveTab('rules')} icon={<Filter className="w-4 h-4" />} label={`Rules (${proxyRules.length})`} />
                    <TabButton active={activeTab === 'rule_tester'} onClick={() => setActiveTab('rule_tester')} icon={<FlaskConical className="w-4 h-4" />} label="Rule Tester" />
                    <TabButton active={activeTab === 'templates'} onClick={() => setActiveTab('templates')} icon={<BookTemplate className="w-4 h-4" />} label="Templates" />
                    <TabButton active={activeTab === 'bindings'} onClick={() => setActiveTab('bindings')} icon={<Link className="w-4 h-4" />} label={`RBAC (${proxyBindings.length})`} />
                    <TabButton active={activeTab === 'proposals'} onClick={() => setActiveTab('proposals')} icon={<Shield className="w-4 h-4" />} label={`Proposals (${proxyProposals.filter(p => p.status === 'pending').length})`} />
                    <TabButton active={activeTab === 'agents'} onClick={() => setActiveTab('agents')} icon={<Server className="w-4 h-4" />} label={`Agents (${proxyAgents.length})`} />
                    <TabButton active={activeTab === 'audit'} onClick={() => setActiveTab('audit')} icon={<FileText className="w-4 h-4" />} label="Audit" />
                  </div>
                </div>
                <OnboardingChecklist
                  statusRunning={Boolean(proxyStatus?.running)}
                  credentialsCount={proxyCredentials.length}
                  rulesCount={proxyRules.length}
                  invitesCount={proxyInvites.length}
                  hasTestRequest={proxyAuditEntries.length > 0 || ruleTestResult !== null}
                  testing={onboardingTesting}
                  message={onboardingMessage}
                  onRunTest={handleTestSetup}
                />
              </aside>

              <section className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/40">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Workspace</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Safe defaults + guided setup for agent access.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {(activeTab === 'credentials') && (
                      <button onClick={() => setShowAddCred(true)} className="flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950 transition-all hover:bg-emerald-400">
                        <Plus className="w-4 h-4" /> Add
                      </button>
                    )}
                    {(activeTab === 'rules') && (
                      <button onClick={() => setShowAddRule(true)} className="flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950 transition-all hover:bg-emerald-400">
                        <Plus className="w-4 h-4" /> Add Rule
                      </button>
                    )}
                    {(activeTab === 'bindings') && (
                      <button onClick={() => setShowAddBinding(true)} className="flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950 transition-all hover:bg-emerald-400">
                        <Plus className="w-4 h-4" /> Bind
                      </button>
                    )}
                    <button onClick={refreshAll} className="rounded-lg p-2 text-slate-600 transition-all hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white">
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {activeTab === 'discover' && <DiscoverTab data={discoverData} onRefresh={refreshAll} />}
                {activeTab === 'credentials' && <CredentialsList creds={proxyCredentials} onDelete={async (id) => { try { await proxyDeleteCredential(id); await refreshAll(); toast('Credential deleted', 'info') } catch (e) { toast(`Delete failed: ${formatError(e)}`, 'error') } }} />}
                {activeTab === 'rules' && <RulesList rules={proxyRules} onDelete={async (id) => { try { await proxyDeleteRule(id); await refreshAll(); toast('Rule deleted', 'info') } catch (e) { toast(`Delete failed: ${formatError(e)}`, 'error') } }} />}
                {activeTab === 'rule_tester' && currentVault && (
                  <RuleTesterPanel
                    vaultId={currentVault.id}
                    lastResult={ruleTestResult}
                    onTest={async (host, path, method) => {
                      const res = await proxyRuleTest({ vault_id: currentVault.id, host, path, method })
                      setRuleTestResult(res)
                      return res
                    }}
                  />
                )}
                {activeTab === 'templates' && currentVault && (
                  <PolicyTemplatesPanel
                    templates={policyTemplates}
                    onApply={async (templateId) => {
                      const created = await proxyApplyPolicyTemplate(currentVault.id, templateId)
                      await refreshAll()
                      toast(`Applied ${created.length} rule(s)`, 'success')
                    }}
                  />
                )}
                {activeTab === 'bindings' && <BindingsList bindings={proxyBindings} credentials={proxyCredentials} rules={proxyRules} onDelete={async (id) => { try { await proxyDeleteBinding(id); await refreshAll(); toast('Binding deleted', 'info') } catch (e) { toast(`Delete failed: ${formatError(e)}`, 'error') } }} />}
                {activeTab === 'proposals' && <ProposalsList proposals={proxyProposals} onApprove={async (id) => { try { await proxyApproveProposal(id); await refreshAll(); toast('Proposal approved', 'success') } catch (e) { toast(`Approve failed: ${formatError(e)}`, 'error') } }} onDeny={async (id) => { try { await proxyDenyProposal(id); await refreshAll(); toast('Proposal denied', 'info') } catch (e) { toast(`Deny failed: ${formatError(e)}`, 'error') } }} />}
                {activeTab === 'agents' && currentVault && <AgentsList proxyPort={proxyStatus.proxy_port} vaultId={currentVault.id} agents={proxyAgents} invites={proxyInvites} panicking={panicking} strictNoFileWriteMode={settings.strict_no_file_write_mode} onPanicRevokeAll={handlePanicRevokeAll} onCreateInvite={async (name) => { try { const invite = await proxyCreateInvite(currentVault.id, name); await refreshAll(); toast('Invite created', 'success'); return invite } catch (e) { toast(`Invite failed: ${formatError(e)}`, 'error'); throw e } }} onRedeem={async (code, name, ttl) => { try { const redeemed = await proxyRedeemInviteWithTtl(code, ttl, name); await refreshAll(); toast('Invite redeemed', 'success'); return redeemed } catch (e) { toast(`Redeem failed: ${formatError(e)}`, 'error'); throw e } }} onRotate={async (id, ttl) => { try { const rotated = await proxyRotateAgentTokenWithTtl(id, ttl); await refreshAll(); toast('Token rotated', 'success'); return rotated } catch (e) { toast(`Rotate failed: ${formatError(e)}`, 'error'); throw e } }} onRevoke={async (id) => { try { await proxyRevokeAgent(id); await refreshAll(); toast('Agent revoked', 'info') } catch (e) { toast(`Revoke failed: ${formatError(e)}`, 'error') } }} />}
                {activeTab === 'audit' && <AuditLog entries={proxyAuditEntries} />}
              </section>
            </div>
          </>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/40">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-slate-500 dark:text-slate-300" />
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Diagnostics</p>
            </div>
            <button
              onClick={refreshAll}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-all hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
          <div className="grid gap-3 lg:grid-cols-[1.1fr,1fr]">
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/50">
              <DiagRow label="Proxy port" value={`${diagnostics?.proxy_port ?? 8080}`} />
              <DiagRow label="Mgmt port" value={`${diagnostics?.mgmt_port ?? 8081}`} />
              <DiagRow label="Proxy listeners" value={(diagnostics?.proxy_listener_pids?.length ? diagnostics.proxy_listener_pids.join(', ') : 'none')} />
              <DiagRow label="Mgmt listeners" value={(diagnostics?.mgmt_listener_pids?.length ? diagnostics.mgmt_listener_pids.join(', ') : 'none')} />
              <DiagRow label="Log path" value={diagnostics?.log_path || 'unavailable'} mono />
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-950/95 p-3 text-xs text-slate-200 dark:border-slate-700">
              <div className="mb-2 flex items-center gap-2 text-slate-400">
                <CircleDot className="h-3.5 w-3.5" />
                <span>Recent proxy log (tail)</span>
              </div>
              <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-slate-200">
                {diagnostics?.log_tail?.trim() ? diagnostics.log_tail : 'No log output yet.'}
              </pre>
            </div>
          </div>
          {!proxyStatus?.running && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              Proxy is currently stopped. Use Start Proxy, or Force Reset if you suspect stale ports.
            </div>
          )}
        </div>

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
              try {
                await proxyAddCredential(cred)
                setShowAddCred(false)
                await refreshAll()
                toast('Credential added', 'success')
              } catch (e) {
                toast(`Add credential failed: ${formatError(e)}`, 'error')
              }
            }}
          />
        )}
        {showAddRule && currentVault && (
          <AddRuleModal
            vaultId={currentVault.id}
            onClose={() => setShowAddRule(false)}
            onSaved={async (rule) => {
              try {
                await proxyAddRule(rule)
                setShowAddRule(false)
                await refreshAll()
                toast('Rule added', 'success')
              } catch (e) {
                toast(`Add rule failed: ${formatError(e)}`, 'error')
              }
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
              try {
                await proxyAddBinding(vaultId, credIds, ruleIds)
                setShowAddBinding(false)
                await refreshAll()
                toast('Binding created', 'success')
              } catch (e) {
                toast(`Bind failed: ${formatError(e)}`, 'error')
              }
            }}
          />
        )}
      </div>
    </ErrorBoundary>
  )
}

function HealthPill({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className={`rounded-lg border px-2.5 py-2 text-xs ${
      ok
        ? 'border-emerald-300 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
        : 'border-slate-200 bg-white/70 text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300'
    }`}>
      <p className="font-semibold">{label}</p>
      <p className="mt-0.5">{value}</p>
    </div>
  )
}

function DiagRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[120px,1fr] gap-2 text-xs">
      <p className="text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-right text-slate-700 dark:text-slate-200 ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</p>
    </div>
  )
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
        active
          ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 dark:text-emerald-400'
          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/50'
      }`}
    >
      {icon} {label}
    </button>
  )
}

function OnboardingChecklist({
  statusRunning,
  credentialsCount,
  rulesCount,
  invitesCount,
  hasTestRequest,
  testing,
  message,
  onRunTest,
}: {
  statusRunning: boolean
  credentialsCount: number
  rulesCount: number
  invitesCount: number
  hasTestRequest: boolean
  testing: boolean
  message: string
  onRunTest: () => void
}) {
  const items = [
    { label: 'Start proxy', done: statusRunning },
    { label: 'Add credential + rule', done: credentialsCount > 0 && rulesCount > 0 },
    { label: 'Invite an agent', done: invitesCount > 0 },
    { label: 'Test request', done: hasTestRequest },
  ]
  const complete = items.filter(i => i.done).length
  const pct = Math.round((complete / items.length) * 100)

  return (
    <div className="rounded-2xl border border-slate-200 bg-white/80 p-3 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/40">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-emerald-500" />
        <p className="text-sm font-semibold text-slate-900 dark:text-white">Onboarding</p>
      </div>
      <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{complete}/4 complete</p>
      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="space-y-2">
        {items.map(item => (
          <div key={item.label} className="flex items-center gap-2 text-xs">
            <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border ${item.done ? 'border-emerald-400 bg-emerald-500/20 text-emerald-500' : 'border-slate-300 text-slate-400 dark:border-slate-700'}`}>
              {item.done ? <Check className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
            </span>
            <span className={item.done ? 'text-slate-800 dark:text-slate-200' : 'text-slate-500 dark:text-slate-400'}>{item.label}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onRunTest}
        disabled={testing}
        className="mt-3 w-full rounded-lg bg-emerald-500 px-3 py-2 text-xs font-medium text-slate-950 transition-all hover:bg-emerald-400 disabled:bg-slate-300 dark:disabled:bg-slate-700"
      >
        {testing ? 'Testing Setup...' : 'Test My Setup'}
      </button>
      {message && (
        <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-400">{message}</p>
      )}
    </div>
  )
}

function RuleTesterPanel({
  vaultId,
  lastResult,
  onTest,
}: {
  vaultId: string
  lastResult: ProxyRuleTestResponse | null
  onTest: (host: string, path: string, method: string) => Promise<ProxyRuleTestResponse>
}) {
  const [host, setHost] = useState('api.openai.com')
  const [path, setPath] = useState('/v1/responses')
  const [method, setMethod] = useState('POST')
  const [headers, setHeaders] = useState('X-Vault-ID: demo-vault\nX-Agent-ID: demo-agent')
  const [testing, setTesting] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!host.trim()) return
    setTesting(true)
    try {
      await onTest(host.trim(), path.trim() || '/', method)
      toast('Rule test complete', 'success')
    } catch (err) {
      toast(`Rule test failed: ${formatError(err)}`, 'error')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/40">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
          <FlaskConical className="h-4 w-4 text-emerald-500" /> Rule Tester
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="Host" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/path" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white">
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'CONNECT'].map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <textarea value={headers} onChange={(e) => setHeaders(e.target.value)} className="mt-3 min-h-[84px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" />
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-slate-500 dark:text-slate-400">Vault scope: <span className="font-mono">{vaultId}</span></p>
          <button type="submit" disabled={testing} className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950 transition-all hover:bg-emerald-400 disabled:bg-slate-300 dark:disabled:bg-slate-700">
            {testing ? 'Testing...' : 'Preview Decision'}
          </button>
        </div>
      </form>

      {lastResult && (
        <div className={`rounded-xl border p-4 ${lastResult.allow ? 'border-emerald-400/40 bg-emerald-500/10' : 'border-red-400/40 bg-red-500/10'}`}>
          <p className={`text-sm font-semibold ${lastResult.allow ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {lastResult.allow ? 'ALLOW' : 'DENY'} · {lastResult.method} {lastResult.host}{lastResult.path}
          </p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{lastResult.reason}</p>
          {lastResult.matched_rule && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Matched rule: <span className="font-semibold">{lastResult.matched_rule.name}</span> · <span className="font-mono">{lastResult.matched_rule.host_match}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function PolicyTemplatesPanel({
  templates,
  onApply,
}: {
  templates: ProxyPolicyTemplate[]
  onApply: (templateId: string) => Promise<void>
}) {
  const [applying, setApplying] = useState<string | null>(null)

  if (!templates.length) {
    return (
      <div className="rounded-xl border-2 border-dashed border-slate-300 py-10 text-center dark:border-slate-700">
        <p className="text-sm text-slate-500 dark:text-slate-400">No templates loaded.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {templates.map((tpl) => (
        <div key={tpl.id} className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/40">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{tpl.name}</p>
            <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">{tpl.rules.length} rules</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{tpl.description}</p>
          <div className="mt-3 space-y-1.5">
            {tpl.rules.map(rule => (
              <div key={rule.id} className="rounded-lg bg-white px-2 py-1.5 text-xs dark:bg-slate-900">
                <span className="font-mono text-slate-700 dark:text-slate-200">{rule.host_match}</span>
                <span className="ml-2 text-slate-500 dark:text-slate-400">{rule.methods.join(', ')}</span>
              </div>
            ))}
          </div>
          <button
            onClick={async () => {
              setApplying(tpl.id)
              try {
                await onApply(tpl.id)
              } finally {
                setApplying(null)
              }
            }}
            disabled={applying === tpl.id}
            className="mt-3 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950 transition-all hover:bg-emerald-400 disabled:bg-slate-300 dark:disabled:bg-slate-700"
          >
            {applying === tpl.id ? 'Applying...' : 'Apply Template'}
          </button>
        </div>
      ))}
    </div>
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

function ProposalsList({ proposals, onApprove, onDeny }: {
  proposals: ProxyProposal[]
  onApprove: (id: string) => void
  onDeny: (id: string) => void
}) {
  if (proposals.length === 0) {
    return (
      <div className="text-center py-8 border-2 border-dashed border-slate-300 rounded-xl dark:border-slate-700">
        <Shield className="w-8 h-8 mx-auto mb-3 text-slate-400 dark:text-slate-600" />
        <p className="text-slate-600 dark:text-slate-500">No proposals yet</p>
        <p className="text-sm text-slate-500 dark:text-slate-600 mt-1">Denied access requests can create proposals for one-click approval.</p>
      </div>
    )
  }

  const sorted = proposals.slice().sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1
    if (a.status !== 'pending' && b.status === 'pending') return 1
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  return (
    <div className="space-y-3">
      {sorted.map((p) => (
        <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-4 dark:bg-slate-900/50 dark:border-slate-800">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-semibold text-slate-900 dark:text-white font-mono text-sm truncate">{p.host}{p.path !== '/' ? p.path : ''}</h4>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                  p.status === 'approved' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' :
                  p.status === 'denied' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
                  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                }`}>{p.status}</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                <span className="font-mono">{p.method}</span> · vault <span className="font-mono">{p.vault_id || 'global'}</span>
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">{p.reason}</p>
            </div>
            {p.status === 'pending' && (
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => onApprove(p.id)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-medium transition-all">
                  <Check className="w-4 h-4" /> Approve
                </button>
                <button onClick={() => onDeny(p.id)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-400 text-white text-sm font-medium transition-all">
                  <XCircle className="w-4 h-4" /> Deny
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function AgentsList({ proxyPort, vaultId, agents, invites, panicking, strictNoFileWriteMode, onPanicRevokeAll, onCreateInvite, onRedeem, onRotate, onRevoke }: {
  proxyPort: number
  vaultId: string
  agents: ProxyAgent[]
  invites: ProxyInvite[]
  panicking: boolean
  strictNoFileWriteMode: boolean
  onPanicRevokeAll: () => Promise<void>
  onCreateInvite: (name: string) => Promise<ProxyInvite>
  onRedeem: (code: string, name: string | undefined, ttl: '15m' | '1h' | '24h') => Promise<ProxyRedeemInviteResponse>
  onRotate: (id: string, ttl: '15m' | '1h' | '24h') => Promise<ProxyAgent>
  onRevoke: (id: string) => Promise<void>
}) {
  const [inviteName, setInviteName] = useState('')
  const [redeemCode, setRedeemCode] = useState('')
  const [redeemName, setRedeemName] = useState('')
  const [creating, setCreating] = useState(false)
  const [redeeming, setRedeeming] = useState(false)
  const [issuedAgentId, setIssuedAgentId] = useState('')
  const [issuedToken, setIssuedToken] = useState('')
  const [copiedToken, setCopiedToken] = useState(false)
  const [copiedSnippet, setCopiedSnippet] = useState(false)
  const [copiedLaunch, setCopiedLaunch] = useState(false)
  const [toolPreset, setToolPreset] = useState<'claude_code' | 'hermes' | 'openclaw' | 'cursor'>('claude_code')
  const [tokenTtl, setTokenTtl] = useState<'15m' | '1h' | '24h'>('1h')
  const [nowMs, setNowMs] = useState(Date.now())
  const [detectedTools, setDetectedTools] = useState<ProxyToolDetection[]>([])
  const [detectingTools, setDetectingTools] = useState(false)
  const [writingLauncher, setWritingLauncher] = useState(false)
  const [lastLauncher, setLastLauncher] = useState<ProxyToolLauncherWriteResult | null>(null)

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const run = async () => {
      setDetectingTools(true)
      try {
        const tools = await proxyDetectTools()
        setDetectedTools(tools)
      } catch {
        setDetectedTools([])
      } finally {
        setDetectingTools(false)
      }
    }
    void run()
  }, [])

  const buildConfigSnippet = (preset: 'claude_code' | 'hermes' | 'openclaw' | 'cursor') => {
    if (!issuedToken || !issuedAgentId) return ''
    const baseEnv = [
      `HTTPS_PROXY=http://127.0.0.1:${proxyPort}`,
      `HTTP_PROXY=http://127.0.0.1:${proxyPort}`,
      `ALL_PROXY=http://127.0.0.1:${proxyPort}`,
      'NO_PROXY=127.0.0.1,localhost',
      `PROXY_AUTHORIZATION=Bearer ${issuedToken}`,
      `X_VAULT_ID=${vaultId}`,
      `X_AGENT_ID=${issuedAgentId}`,
      `X_AGENT_TOKEN=${issuedToken}`,
    ]
    const headers = [
      `Proxy-Authorization: Bearer ${issuedToken}`,
      '(fallback) X-Vault-ID: ' + vaultId,
      '(fallback) X-Agent-ID: ' + issuedAgentId,
      '(fallback) X-Agent-Token: ' + issuedToken,
    ]

    switch (preset) {
      case 'claude_code':
        return [
          '# Claude Code',
          '# 1) Export env vars in your terminal',
          ...baseEnv.map(v => `export ${v}`),
          '',
          '# 2) Start Claude Code from this shell',
          'claude',
          '',
          '# Request headers to send:',
          ...headers,
        ].join('\n')
      case 'hermes':
        return [
          '# Hermes',
          '# 1) Add to your Hermes runtime env',
          ...baseEnv,
          '',
          '# 2) Ensure Hermes forwards request headers:',
          ...headers,
        ].join('\n')
      case 'openclaw':
        return [
          '# OpenClaw',
          '# 1) Add env vars to OpenClaw launch config',
          ...baseEnv,
          '',
          '# 2) Configure default request headers:',
          ...headers,
        ].join('\n')
      case 'cursor':
        return [
          '# Cursor',
          '# 1) Add env vars to Cursor terminal/session',
          ...baseEnv.map(v => `export ${v}`),
          '',
          '# 2) Run your agent tooling from that terminal',
          '',
          '# Request headers to send:',
          ...headers,
        ].join('\n')
      default:
        return ''
    }
  }

  const buildLaunchCommand = (preset: 'claude_code' | 'hermes' | 'openclaw' | 'cursor') => {
    if (!issuedToken || !issuedAgentId) return ''
    const exports = [
      `export HTTPS_PROXY=http://127.0.0.1:${proxyPort}`,
      `export HTTP_PROXY=http://127.0.0.1:${proxyPort}`,
      `export ALL_PROXY=http://127.0.0.1:${proxyPort}`,
      'export NO_PROXY=127.0.0.1,localhost',
      `export PROXY_AUTHORIZATION="Bearer ${issuedToken}"`,
      `export X_VAULT_ID=${vaultId}`,
      `export X_AGENT_ID=${issuedAgentId}`,
      `export X_AGENT_TOKEN=${issuedToken}`,
    ]
    const launchByPreset: Record<typeof preset, string> = {
      claude_code: 'claude',
      hermes: 'hermes',
      openclaw: 'openclaw',
      cursor: '# start agent task from Cursor terminal',
    }
    return [...exports, launchByPreset[preset]].join(' && ')
  }

  const configSnippet = buildConfigSnippet(toolPreset)
  const launchCommand = buildLaunchCommand(toolPreset)
  const createInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteName.trim()) return
    setCreating(true)
    try {
      const invite = await onCreateInvite(inviteName.trim())
      setRedeemCode(invite.code)
      setInviteName('')
    } finally {
      setCreating(false)
    }
  }

  const redeemInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!redeemCode.trim()) return
    setRedeeming(true)
    try {
      const redeemed = await onRedeem(redeemCode.trim(), redeemName.trim() || undefined, tokenTtl)
      setIssuedAgentId(redeemed.agent.id)
      setIssuedToken(redeemed.token)
      setRedeemCode('')
      setRedeemName('')
      setCopiedToken(false)
      setCopiedSnippet(false)
      setCopiedLaunch(false)
    } finally {
      setRedeeming(false)
    }
  }

  const copyToken = async () => {
    if (!issuedToken) return
    try {
      await navigator.clipboard.writeText(issuedToken)
      setCopiedToken(true)
      window.setTimeout(() => setCopiedToken(false), 1500)
      toast('Agent token copied', 'success')
    } catch (err) {
      console.error('Failed to copy token', err)
      toast('Failed to copy token', 'error')
    }
  }

  const copySnippet = async () => {
    if (!configSnippet) return
    try {
      await navigator.clipboard.writeText(configSnippet)
      setCopiedSnippet(true)
      window.setTimeout(() => setCopiedSnippet(false), 1500)
      toast('Config snippet copied', 'success')
    } catch (err) {
      console.error('Failed to copy snippet', err)
      toast('Failed to copy snippet', 'error')
    }
  }

  const copyLaunch = async () => {
    if (!launchCommand) return
    try {
      await navigator.clipboard.writeText(launchCommand)
      setCopiedLaunch(true)
      window.setTimeout(() => setCopiedLaunch(false), 1500)
      toast('Launch command copied', 'success')
    } catch (err) {
      console.error('Failed to copy launch command', err)
      toast('Failed to copy launch command', 'error')
    }
  }

  const downloadSnippet = () => {
    if (!configSnippet || !issuedAgentId) return
    const blob = new Blob([configSnippet], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `agent-config-${toolPreset}-${issuedAgentId}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast('Config snippet downloaded', 'success')
  }

  const writeLauncher = async () => {
    if (!issuedToken || !issuedAgentId) return
    setWritingLauncher(true)
    try {
      const result = await proxyWriteToolLauncher(toolPreset, vaultId, issuedAgentId, issuedToken, proxyPort)
      setLastLauncher(result)
      toast(`Launcher created: ${result.script_path}`, 'success')
    } catch (err) {
      toast(`Failed to write launcher: ${formatError(err)}`, 'error')
    } finally {
      setWritingLauncher(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300">Connect My Tool (One-click)</h4>
          <button
            type="button"
            onClick={async () => {
              setDetectingTools(true)
              try {
                setDetectedTools(await proxyDetectTools())
              } finally {
                setDetectingTools(false)
              }
            }}
            className="px-2.5 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300"
          >
            {detectingTools ? 'Detecting...' : 'Re-detect'}
          </button>
        </div>
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          {detectedTools.map(tool => (
            <div key={tool.id} className="rounded border border-slate-200 dark:border-slate-700 px-2.5 py-2 text-xs">
              <p className="font-medium text-slate-800 dark:text-slate-100">{tool.label}</p>
              <p className="text-slate-500 dark:text-slate-400">command: {tool.command}</p>
              <p className={tool.detected ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                {tool.detected ? 'detected' : 'not found'}
              </p>
            </div>
          ))}
          {!detectedTools.length && <p className="text-xs text-slate-500 dark:text-slate-400">No detection data yet.</p>}
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Writes a local launcher script + env file in app data (does not modify external tool configs).
        </p>
        {strictNoFileWriteMode && (
          <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
            Strict No File Write mode is enabled in Settings, so launcher file generation is blocked.
          </p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={writeLauncher}
            disabled={!issuedToken || !issuedAgentId || writingLauncher || strictNoFileWriteMode}
            className="px-3 py-1.5 text-xs rounded bg-blue-500 hover:bg-blue-400 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white font-medium transition-all"
          >
            {writingLauncher ? 'Writing Launcher...' : strictNoFileWriteMode ? 'Blocked by Strict Mode' : 'Write Launcher Script'}
          </button>
          {lastLauncher && (
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
              {lastLauncher.script_path}
            </span>
          )}
        </div>
      </div>

      <div className="bg-red-50 dark:bg-red-950/20 rounded-xl border border-red-200 dark:border-red-800 p-4">
        <h4 className="text-sm font-medium text-red-700 dark:text-red-300 mb-2">Panic Button</h4>
        <p className="text-xs text-red-700/80 dark:text-red-300/80 mb-2">
          Instantly revokes every active agent token for this vault.
        </p>
        <button
          type="button"
          onClick={() => { void onPanicRevokeAll() }}
          disabled={panicking}
          className="px-3 py-1.5 text-xs rounded bg-red-600 hover:bg-red-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white font-medium transition-all"
        >
          {panicking ? 'Revoking All...' : 'Revoke All Active Agents'}
        </button>
      </div>

      <form onSubmit={createInvite} className="bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Create Invite</h4>
        <div className="flex gap-2">
          <input
            type="text"
            value={inviteName}
            onChange={e => setInviteName(e.target.value)}
            placeholder="Agent name (e.g. Codex Worker)"
            className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500"
          />
          <button type="submit" disabled={!inviteName.trim() || creating} className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-slate-950 font-medium rounded-lg transition-all">
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-500 font-mono">vault_id: {vaultId}</p>
      </form>

      <form onSubmit={redeemInvite} className="bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Redeem Invite</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input
            type="text"
            value={redeemCode}
            onChange={e => setRedeemCode(e.target.value)}
            placeholder="Invite code"
            className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all font-mono text-sm dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500"
          />
          <input
            type="text"
            value={redeemName}
            onChange={e => setRedeemName(e.target.value)}
            placeholder="Agent name (optional)"
            className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all dark:bg-slate-950 dark:border-slate-700 dark:text-white dark:placeholder-slate-500"
          />
          <select value={tokenTtl} onChange={e => setTokenTtl(e.target.value as '15m' | '1h' | '24h')} className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-emerald-500/50 transition-all dark:bg-slate-950 dark:border-slate-700 dark:text-white">
            <option value="15m">15 minutes</option>
            <option value="1h">1 hour</option>
            <option value="24h">24 hours</option>
          </select>
        </div>
        <div className="mt-2 flex justify-end">
          <button type="submit" disabled={!redeemCode.trim() || redeeming} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white font-medium rounded-lg transition-all">
            {redeeming ? 'Redeeming...' : 'Redeem Invite'}
          </button>
        </div>
      </form>

      {issuedToken && (
        <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-xl border border-emerald-200 dark:border-emerald-800 p-4">
          <h4 className="text-sm font-medium text-emerald-700 dark:text-emerald-300 mb-2">New Agent Token</h4>
          <p className="text-xs text-emerald-700/80 dark:text-emerald-400/80 mb-2">Shown only on redeem or rotate. Save it now.</p>
          <p className="text-xs font-mono text-emerald-700 dark:text-emerald-300 mb-2 break-all">X-Agent-ID: {issuedAgentId}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-700 rounded px-2 py-1.5 text-slate-900 dark:text-white break-all">
              {issuedToken}
            </code>
            <button onClick={copyToken} type="button" className="px-3 py-1.5 text-xs rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium transition-all">
              {copiedToken ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="mt-3">
            <p className="text-xs text-emerald-700/80 dark:text-emerald-400/80 mb-2">One-click agent setup snippet</p>
            <div className="mb-2 flex flex-wrap gap-2">
              {[
                ['claude_code', 'Claude Code'],
                ['hermes', 'Hermes'],
                ['openclaw', 'OpenClaw'],
                ['cursor', 'Cursor'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setToolPreset(key as 'claude_code' | 'hermes' | 'openclaw' | 'cursor')}
                  className={`px-2.5 py-1 text-xs rounded transition-all ${
                    toolPreset === key
                      ? 'bg-emerald-500 text-slate-950 font-medium'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-emerald-200 dark:border-emerald-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <textarea
              readOnly
              value={configSnippet}
              className="w-full min-h-[130px] text-xs font-mono bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-700 rounded px-2 py-2 text-slate-900 dark:text-white"
            />
            <div className="mt-2 rounded border border-emerald-200 bg-white px-2 py-2 text-[11px] font-mono text-slate-700 dark:border-emerald-800 dark:bg-slate-900 dark:text-slate-200 break-all">
              {launchCommand || '# redeem invite to generate launch command'}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button onClick={copySnippet} type="button" className="px-3 py-1.5 text-xs rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium transition-all">
                {copiedSnippet ? 'Snippet Copied' : 'Copy Config Snippet'}
              </button>
              <button onClick={copyLaunch} type="button" className="px-3 py-1.5 text-xs rounded bg-violet-500 hover:bg-violet-400 text-white font-medium transition-all">
                {copiedLaunch ? 'Launch Copied' : 'Copy Launch Command'}
              </button>
              <button onClick={downloadSnippet} type="button" className="px-3 py-1.5 text-xs rounded bg-blue-500 hover:bg-blue-400 text-white font-medium transition-all">
                Download Snippet
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Invites</h4>
        {invites.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No invites yet.</p>
        ) : (
          <div className="space-y-2">
            {invites.map(inv => (
              <div key={inv.id} className="flex items-center justify-between px-3 py-2 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                <div className="min-w-0">
                  <p className="font-medium text-sm text-slate-900 dark:text-white truncate">{inv.name}</p>
                  <p className="text-xs font-mono text-slate-500 dark:text-slate-400">code: {inv.code}</p>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                  inv.status === 'redeemed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                }`}>{inv.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Agents</h4>
        {agents.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No agents yet. Redeem an invite to create one.</p>
        ) : (
          <div className="space-y-2">
            {agents.map(agent => (
              <div key={agent.id} className="flex items-center justify-between px-3 py-2 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                <div className="min-w-0">
                  <p className="font-medium text-sm text-slate-900 dark:text-white truncate">{agent.name}</p>
                  <p className="text-xs font-mono text-slate-500 dark:text-slate-400">{agent.id}</p>
                  {agent.expires_at && agent.status === 'active' && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Expires in {formatRemaining(agent.expires_at, nowMs)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                    agent.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                  }`}>{agent.status}</span>
                  <button onClick={async () => {
                    const rotated = await onRotate(agent.id, tokenTtl)
                    if (rotated.token) {
                      setIssuedAgentId(agent.id)
                      setIssuedToken(rotated.token)
                      setCopiedToken(false)
                      setCopiedSnippet(false)
                    }
                  }} disabled={agent.status !== 'active'} className="px-2.5 py-1 text-xs rounded bg-blue-500 hover:bg-blue-400 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white transition-all">
                    Rotate Token
                  </button>
                  <button onClick={() => onRevoke(agent.id)} disabled={agent.status !== 'active'} className="px-2.5 py-1 text-xs rounded bg-red-500 hover:bg-red-400 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white transition-all">
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
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
          <p><span className="text-slate-400">Proxy-Authorization</span>: Bearer &lt;agent-token&gt;</p>
          <p className="text-slate-500 dark:text-slate-500">Fallback custom headers:</p>
          <p><span className="text-slate-400">X-Vault-ID</span>: &lt;your-vault-id&gt;</p>
          <p><span className="text-slate-400">X-Agent-ID</span>: &lt;agent-id&gt;</p>
          <p><span className="text-slate-400">X-Agent-Token</span>: &lt;agent-token&gt;</p>
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
