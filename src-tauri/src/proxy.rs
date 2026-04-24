use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

static PROXY_PROCESS: Mutex<Option<std::process::Child>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyCredential {
    pub id: String,
    pub name: String,
    pub vault_id: String,
    pub target_host: String,
    pub target_prefix: String,
    pub auth_type: String,
    pub header_name: String,
    pub header_value: String,
    #[serde(default)]
    pub encrypted_key: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyRule {
    pub id: String,
    pub vault_id: String,
    pub name: String,
    pub host_match: String,
    pub path_match: String,
    pub methods: Vec<String>,
    pub action: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyBinding {
    pub id: String,
    pub vault_id: String,
    pub credential_ids: Vec<String>,
    pub rule_ids: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyProposal {
    pub id: String,
    pub vault_id: String,
    pub host: String,
    pub path: String,
    pub method: String,
    pub reason: String,
    pub agent_id: String,
    pub status: String,
    #[serde(default)]
    pub created_rule_id: String,
    pub created_at: String,
    #[serde(default)]
    pub resolved_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyAgent {
    pub id: String,
    pub vault_id: String,
    pub name: String,
    pub status: String,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub expires_at: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyInvite {
    pub id: String,
    pub code: String,
    pub vault_id: String,
    pub name: String,
    pub status: String,
    #[serde(default)]
    pub redeemed_by: String,
    pub created_at: String,
    #[serde(default)]
    pub redeemed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyRedeemInviteResponse {
    pub invite: ProxyInvite,
    pub agent: ProxyAgent,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub timestamp: String,
    pub agent_id: String,
    pub vault_id: String,
    pub method: String,
    pub target: String,
    pub path: String,
    pub action: String,
    pub status_code: i32,
    pub credential_id: String,
    #[serde(default)]
    pub rule: String,
    pub source_ip: String,
    #[serde(default)]
    pub user_agent: String,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyStatus {
    pub running: bool,
    pub proxy_port: u16,
    pub mgmt_port: u16,
}

fn mgmt_base_url(mgmt_port: u16) -> String {
    format!("http://127.0.0.1:{}", mgmt_port)
}

async fn mgmt_reachable(mgmt_port: u16) -> bool {
    let url = format!("{}/api/v1/status", mgmt_base_url(mgmt_port));
    let client = reqwest::Client::new();
    match client
        .get(&url)
        .timeout(std::time::Duration::from_millis(500))
        .send()
        .await
    {
        Ok(r) => r.status().is_success(),
        Err(_) => false,
    }
}

fn maybe_kill_proxy_by_mgmt_port(mgmt_port: u16) -> Result<bool, String> {
    // Best-effort cleanup for cases where the app lost the child handle
    // (e.g. app restart/crash). Only kill processes listening on mgmt_port
    // whose command line contains "agent-chest-proxy".
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let out = std::process::Command::new("lsof")
            .arg("-ti")
            .arg(format!("tcp:{}", mgmt_port))
            .output()
            .map_err(|e| format!("Failed to run lsof: {}", e))?;
        let s = String::from_utf8_lossy(&out.stdout);
        let mut killed_any = false;
        for line in s.lines() {
            let pid = line.trim();
            if pid.is_empty() {
                continue;
            }

            let cmd_out = std::process::Command::new("ps")
                .arg("-p")
                .arg(pid)
                .arg("-o")
                .arg("command=")
                .output()
                .map_err(|e| format!("Failed to run ps: {}", e))?;
            let cmdline = String::from_utf8_lossy(&cmd_out.stdout);
            if !cmdline.contains("agent-chest-proxy") {
                continue;
            }

            let _ = std::process::Command::new("kill").arg(pid).status();
            killed_any = true;
        }
        return Ok(killed_any);
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = mgmt_port;
        Ok(false)
    }
}

fn find_proxy_binary(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;
    let binary_name = if cfg!(target_os = "windows") {
        "agent-chest-proxy.exe"
    } else {
        "agent-chest-proxy"
    };
    let proxy_path = resource_dir.join(binary_name);
    if proxy_path.exists() {
        return Ok(proxy_path);
    }
    let current_dir = std::env::current_dir().map_err(|e| format!("Failed to get cwd: {}", e))?;
    let local_path = current_dir.join(binary_name);
    if local_path.exists() {
        return Ok(local_path);
    }
    let sibling_path = std::env::current_exe()
        .map_err(|e| format!("Failed to get exe path: {}", e))?
        .parent()
        .ok_or("No parent dir")?
        .join(binary_name);
    if sibling_path.exists() {
        return Ok(sibling_path);
    }
    Err("agent-chest-proxy binary not found. Build it with: cd agent-chest-proxy && go build -o ../src-tauri/ ./cmd/agent-chest-proxy/".to_string())
}

#[tauri::command]
pub async fn proxy_start(
    app: AppHandle,
    proxy_port: Option<u16>,
    mgmt_port: Option<u16>,
) -> Result<ProxyStatus, String> {
    let proxy_port = proxy_port.unwrap_or(8080);
    let mgmt_port = mgmt_port.unwrap_or(8081);

    // Handle the common case where the app restarted but the proxy is still running.
    if mgmt_reachable(mgmt_port).await {
        return Err(format!(
            "Proxy already running on mgmt port {}. Stop it first (or kill the existing process).",
            mgmt_port
        ));
    }

    {
        let mut lock = PROXY_PROCESS
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;

        if let Some(child) = lock.as_mut() {
            // If the child already exited, clear it so we can start cleanly.
            if let Ok(Some(_)) = child.try_wait() {
                *lock = None;
            }
        }

        if lock.is_some() {
            return Err("Proxy is already running".to_string());
        }

        let proxy_binary = find_proxy_binary(&app)?;
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {}", e))?;
        std::fs::create_dir_all(&app_data_dir)
            .map_err(|e| format!("Failed to create app data dir: {}", e))?;
        let agents_state_path = app_data_dir.join("agent-chest-agents.json");
        let proposals_state_path = app_data_dir.join("agent-chest-proposals.json");

        // Capture stdout/stderr to a local file so startup failures are debuggable.
        let log_path = app_data_dir.join("agent-chest-proxy.log");
        let log_file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|e| format!("Failed to open proxy log file {}: {}", log_path.display(), e))?;
        let log_file_err = log_file
            .try_clone()
            .map_err(|e| format!("Failed to clone proxy log handle: {}", e))?;

        let mut cmd = std::process::Command::new(proxy_binary);
        cmd.arg("--proxy-port")
            .arg(proxy_port.to_string())
            .arg("--mgmt-port")
            .arg(mgmt_port.to_string())
            .arg("--agents-state")
            .arg(agents_state_path)
            .arg("--proposals-state")
            .arg(proposals_state_path);
        cmd.stdout(std::process::Stdio::from(log_file));
        cmd.stderr(std::process::Stdio::from(log_file_err));

        #[cfg(target_os = "macos")]
        {
            cmd.env("DYLD_LIBRARY_PATH", "");
        }

        let child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start proxy: {}", e))?;

        *lock = Some(child);
    }

    // Wait briefly for the mgmt server to come up so the UI can immediately
    // transition into the "running" state.
    let start = std::time::Instant::now();
    while start.elapsed() < std::time::Duration::from_secs(2) {
        if mgmt_reachable(mgmt_port).await {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    // If mgmt still isn't reachable, treat startup as failed and clean up.
    if !mgmt_reachable(mgmt_port).await {
        let mut lock = PROXY_PROCESS
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        if let Some(mut child) = lock.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        return Err(format!(
            "Proxy failed to start (mgmt API not reachable on {}). Check ~/Library/Application Support/com.keynest.desktop/agent-chest-proxy.log",
            mgmt_port
        ));
    }

    Ok(ProxyStatus {
        running: true,
        proxy_port,
        mgmt_port,
    })
}

#[tauri::command]
pub async fn proxy_stop(mgmt_port: Option<u16>) -> Result<(), String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let mut lock = PROXY_PROCESS
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    if let Some(mut child) = lock.take() {
        child
            .kill()
            .map_err(|e| format!("Failed to kill proxy: {}", e))?;
        let _ = child.wait();
        return Ok(());
    }

    // Best-effort fallback: if we lost the handle, try to kill whatever is
    // listening on the requested/default mgmt port (and looks like agent-chest-proxy).
    let _ = maybe_kill_proxy_by_mgmt_port(mgmt_port)?;
    Ok(())
}

#[tauri::command]
pub async fn proxy_status(mgmt_port: Option<u16>) -> Result<ProxyStatus, String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let url = format!("{}/api/v1/status", mgmt_base_url(mgmt_port));

    let mut is_running = false;
    {
        // If we have a child handle, treat it as authoritative (and clear it if exited).
        let mut lock = PROXY_PROCESS
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        if let Some(child) = lock.as_mut() {
            match child.try_wait() {
                Ok(Some(_status)) => {
                    // Process exited.
                    *lock = None;
                    is_running = false;
                }
                Ok(None) => {
                    is_running = true;
                }
                Err(_) => {
                    // If we can't query status, assume it's still running and let the
                    // mgmt health check provide additional confidence.
                    is_running = true;
                }
            }
        }
    }

    if !is_running {
        // If we don't have a child handle, still detect a running proxy.
        if mgmt_reachable(mgmt_port).await {
            return Ok(ProxyStatus {
                running: true,
                proxy_port: mgmt_port.saturating_sub(1),
                mgmt_port,
            });
        }
        return Ok(ProxyStatus {
            running: false,
            proxy_port: 0,
            mgmt_port: 0,
        });
    }

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await;

    match resp {
        Ok(r) if r.status().is_success() => Ok(ProxyStatus {
            running: true,
            proxy_port: mgmt_port - 1,
            mgmt_port,
        }),
        // Don't flip the UI into "stopped" just because the mgmt endpoint isn't ready yet.
        // If the child process is alive, we can still treat it as running.
        _ => Ok(ProxyStatus {
            running: true,
            proxy_port: mgmt_port.saturating_sub(1),
            mgmt_port,
        }),
    }
}

#[tauri::command]
pub async fn proxy_list_credentials(
    mgmt_port: Option<u16>,
) -> Result<Vec<ProxyCredential>, String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let url = format!("{}/api/v1/credentials", mgmt_base_url(mgmt_port));
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let creds: Vec<ProxyCredential> = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    Ok(creds)
}

#[tauri::command]
pub async fn proxy_add_credential(
    mgmt_port: Option<u16>,
    credential: ProxyCredential,
) -> Result<ProxyCredential, String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let url = format!("{}/api/v1/credentials", mgmt_base_url(mgmt_port));
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&credential)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let cred: ProxyCredential = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    Ok(cred)
}

#[tauri::command]
pub async fn proxy_delete_credential(mgmt_port: Option<u16>, id: String) -> Result<(), String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let url = format!("{}/api/v1/credentials/{}", mgmt_base_url(mgmt_port), id);
    let client = reqwest::Client::new();
    client
        .delete(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn proxy_list_rules(mgmt_port: Option<u16>) -> Result<Vec<ProxyRule>, String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let url = format!("{}/api/v1/rules", mgmt_base_url(mgmt_port));
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let rules: Vec<ProxyRule> = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    Ok(rules)
}

#[tauri::command]
pub async fn proxy_add_rule(mgmt_port: Option<u16>, rule: ProxyRule) -> Result<ProxyRule, String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let url = format!("{}/api/v1/rules", mgmt_base_url(mgmt_port));
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&rule)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let r: ProxyRule = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    Ok(r)
}

#[tauri::command]
pub async fn proxy_delete_rule(mgmt_port: Option<u16>, id: String) -> Result<(), String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let url = format!("{}/api/v1/rules/{}", mgmt_base_url(mgmt_port), id);
    let client = reqwest::Client::new();
    client
        .delete(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn proxy_list_bindings(mgmt_port: Option<u16>) -> Result<Vec<ProxyBinding>, String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let url = format!("{}/api/v1/bindings", mgmt_base_url(mgmt_port));
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let bindings: Vec<ProxyBinding> = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    Ok(bindings)
}

#[tauri::command]
pub async fn proxy_add_binding(
    mgmt_port: Option<u16>,
    vault_id: String,
    credential_ids: Vec<String>,
    rule_ids: Vec<String>,
) -> Result<ProxyBinding, String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let url = format!("{}/api/v1/bindings", mgmt_base_url(mgmt_port));
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "vault_id": vault_id,
        "credential_ids": credential_ids,
        "rule_ids": rule_ids,
    });
    let resp = client
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let b: ProxyBinding = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    Ok(b)
}

#[tauri::command]
pub async fn proxy_delete_binding(mgmt_port: Option<u16>, id: String) -> Result<(), String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let url = format!("{}/api/v1/bindings/{}", mgmt_base_url(mgmt_port), id);
    let client = reqwest::Client::new();
    client
        .delete(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn proxy_list_proposals(
    mgmt_port: Option<u16>,
    vault_id: Option<String>,
    status: Option<String>,
) -> Result<Vec<ProxyProposal>, String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let mut url = format!("{}/v1/proposals", mgmt_base_url(mgmt_port));
    let mut query = Vec::new();
    if let Some(v) = vault_id {
        if !v.is_empty() {
            query.push(format!("vault_id={}", v));
        }
    }
    if let Some(s) = status {
        if !s.is_empty() {
            query.push(format!("status={}", s));
        }
    }
    if !query.is_empty() {
        url = format!("{}?{}", url, query.join("&"));
    }

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let proposals: Vec<ProxyProposal> = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    Ok(proposals)
}

#[tauri::command]
pub async fn proxy_create_proposal(
    mgmt_port: Option<u16>,
    proposal: ProxyProposal,
) -> Result<ProxyProposal, String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let url = format!("{}/v1/proposals", mgmt_base_url(mgmt_port));
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&proposal)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let created: ProxyProposal = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    Ok(created)
}

#[tauri::command]
pub async fn proxy_approve_proposal(
    mgmt_port: Option<u16>,
    id: String,
) -> Result<ProxyProposal, String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let url = format!("{}/v1/proposals/{}/approve", mgmt_base_url(mgmt_port), id);
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let updated: ProxyProposal = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    Ok(updated)
}

#[tauri::command]
pub async fn proxy_deny_proposal(
    mgmt_port: Option<u16>,
    id: String,
) -> Result<ProxyProposal, String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let url = format!("{}/v1/proposals/{}/deny", mgmt_base_url(mgmt_port), id);
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let updated: ProxyProposal = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    Ok(updated)
}

#[tauri::command]
pub async fn proxy_list_agents(
    mgmt_port: Option<u16>,
    vault_id: Option<String>,
) -> Result<Vec<ProxyAgent>, String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let mut url = format!("{}/v1/agents", mgmt_base_url(mgmt_port));
    if let Some(v) = vault_id {
        if !v.is_empty() {
            url = format!("{}?vault_id={}", url, v);
        }
    }

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let agents: Vec<ProxyAgent> = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    Ok(agents)
}

#[tauri::command]
pub async fn proxy_rotate_agent_token(
    mgmt_port: Option<u16>,
    id: String,
    ttl: Option<String>,
) -> Result<ProxyAgent, String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let url = format!("{}/v1/agents/{}/rotate-token", mgmt_base_url(mgmt_port), id);
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "ttl": ttl.unwrap_or_else(|| "1h".to_string())
    });
    let resp = client
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let updated: ProxyAgent = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    Ok(updated)
}

#[tauri::command]
pub async fn proxy_revoke_agent(mgmt_port: Option<u16>, id: String) -> Result<ProxyAgent, String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let url = format!("{}/v1/agents/{}/revoke", mgmt_base_url(mgmt_port), id);
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let updated: ProxyAgent = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    Ok(updated)
}

#[tauri::command]
pub async fn proxy_list_invites(
    mgmt_port: Option<u16>,
    vault_id: Option<String>,
) -> Result<Vec<ProxyInvite>, String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let mut url = format!("{}/v1/invites", mgmt_base_url(mgmt_port));
    if let Some(v) = vault_id {
        if !v.is_empty() {
            url = format!("{}?vault_id={}", url, v);
        }
    }
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let invites: Vec<ProxyInvite> = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    Ok(invites)
}

#[tauri::command]
pub async fn proxy_create_invite(
    mgmt_port: Option<u16>,
    vault_id: String,
    name: String,
) -> Result<ProxyInvite, String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let url = format!("{}/v1/invites", mgmt_base_url(mgmt_port));
    let body = serde_json::json!({
        "vault_id": vault_id,
        "name": name
    });
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let invite: ProxyInvite = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    Ok(invite)
}

#[tauri::command]
pub async fn proxy_redeem_invite(
    mgmt_port: Option<u16>,
    code: String,
    name: Option<String>,
    ttl: Option<String>,
) -> Result<ProxyRedeemInviteResponse, String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let url = format!("{}/v1/invites/{}/redeem", mgmt_base_url(mgmt_port), code);
    let body = serde_json::json!({
        "name": name.unwrap_or_default(),
        "ttl": ttl.unwrap_or_else(|| "1h".to_string())
    });
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let redeemed: ProxyRedeemInviteResponse = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    Ok(redeemed)
}

#[tauri::command]
pub async fn proxy_audit_log(
    mgmt_port: Option<u16>,
    limit: Option<u16>,
    offset: Option<u16>,
) -> Result<Vec<AuditEntry>, String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let limit = limit.unwrap_or(100);
    let offset = offset.unwrap_or(0);
    let url = format!(
        "{}/api/v1/audit?limit={}&offset={}",
        mgmt_base_url(mgmt_port),
        limit,
        offset
    );
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let entries: Vec<AuditEntry> = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    Ok(entries)
}

#[tauri::command]
pub async fn proxy_rule_test(
    mgmt_port: Option<u16>,
    request: ProxyRuleTestRequest,
) -> Result<ProxyRuleTestResponse, String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let url = format!("{}/api/v1/rules/test", mgmt_base_url(mgmt_port));
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&request)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let outcome: ProxyRuleTestResponse = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    Ok(outcome)
}

#[tauri::command]
pub async fn proxy_list_policy_templates(
    mgmt_port: Option<u16>,
) -> Result<Vec<ProxyPolicyTemplate>, String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let url = format!("{}/api/v1/policy-templates", mgmt_base_url(mgmt_port));
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let templates: Vec<ProxyPolicyTemplate> = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    Ok(templates)
}

#[tauri::command]
pub async fn proxy_apply_policy_template(
    mgmt_port: Option<u16>,
    vault_id: String,
    template_id: String,
) -> Result<Vec<ProxyRule>, String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let url = format!("{}/api/v1/policy-templates", mgmt_base_url(mgmt_port));
    let body = serde_json::json!({
        "vault_id": vault_id,
        "template_id": template_id
    });
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let payload: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    let created = payload
        .get("created")
        .cloned()
        .unwrap_or_else(|| serde_json::Value::Array(vec![]));
    serde_json::from_value(created).map_err(|e| format!("Parse error: {}", e))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoverService {
    pub host: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoverResponse {
    pub vault: String,
    pub services: Vec<DiscoverService>,
    pub available_credential_keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyRuleTestRequest {
    pub vault_id: String,
    pub host: String,
    pub path: String,
    pub method: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyRuleTestResponse {
    pub allow: bool,
    pub reason: String,
    #[serde(default)]
    pub matched_rule: Option<ProxyRule>,
    pub host: String,
    pub path: String,
    pub method: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyPolicyTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub rules: Vec<ProxyRule>,
}

#[tauri::command]
pub async fn proxy_discover(
    mgmt_port: Option<u16>,
    vault_id: Option<String>,
) -> Result<DiscoverResponse, String> {
    let mgmt_port = mgmt_port.unwrap_or(8081);
    let mut url = format!("{}/api/v1/discover", mgmt_base_url(mgmt_port));
    if let Some(vid) = vault_id {
        url = format!("{}?vault_id={}", url, vid);
    }
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let discover: DiscoverResponse = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    Ok(discover)
}
