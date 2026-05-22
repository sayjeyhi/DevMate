use std::path::Path;

use crate::shared::errors::{AppError, FriendlyError};
use crate::shared::paths::PATHS;

#[derive(Debug, Clone, Default)]
pub struct AgentStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
}

pub fn generate_service(binary_path: &str) -> String {
    format!(
        r#"[Unit]
Description=DevM8 — Jira + Claude + Telegram assistant
After=network.target

[Service]
Type=simple
ExecStart={binary}
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
"#,
        binary = binary_path
    )
}

pub async fn write_service_file(
    binary_path: &str,
    file_path: Option<&Path>,
) -> Result<(), AppError> {
    let target = file_path
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PATHS.service_file.clone());

    if let Some(dir) = target.parent() {
        tokio::fs::create_dir_all(dir).await?;
    }

    let content = generate_service(binary_path);
    let tmp = target.with_extension("service.tmp");

    tokio::fs::write(&tmp, content.as_bytes()).await?;
    tokio::fs::rename(&tmp, &target).await?;

    Ok(())
}

fn run_systemctl(args: &[&str]) -> Result<std::process::Output, AppError> {
    std::process::Command::new("systemctl")
        .arg("--user")
        .args(args)
        .output()
        .map_err(|e| {
            AppError::Friendly(FriendlyError::with_hint(
                format!("Failed to run systemctl: {e}"),
                "Make sure systemd user services are available on this system.",
            ))
        })
}

pub async fn load_agent() -> Result<(), AppError> {
    let reload = run_systemctl(&["daemon-reload"])?;
    if !reload.status.success() {
        let stderr = String::from_utf8_lossy(&reload.stderr).into_owned();
        return Err(AppError::Friendly(FriendlyError::with_hint(
            format!("systemctl daemon-reload failed: {stderr}"),
            "Run `systemctl --user daemon-reload` to diagnose.",
        )));
    }

    let out = run_systemctl(&["enable", "--now", "devm8"])?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
        return Err(AppError::Friendly(FriendlyError::with_hint(
            format!("Failed to enable/start devm8 service: {stderr}"),
            "Check `journalctl --user -u devm8` for details.",
        )));
    }

    Ok(())
}

pub async fn unload_agent() -> Result<(), AppError> {
    let _ = run_systemctl(&["stop", "devm8"]);
    let _ = run_systemctl(&["disable", "devm8"]);
    Ok(())
}

pub async fn agent_status() -> AgentStatus {
    let mut status = AgentStatus::default();

    let is_active = std::process::Command::new("systemctl")
        .args(["--user", "is-active", "devm8"])
        .output();

    if let Ok(o) = is_active {
        if o.status.success() {
            status.running = true;
            if let Ok(show) = std::process::Command::new("systemctl")
                .args(["--user", "show", "devm8", "--property=MainPID"])
                .output()
            {
                let out = String::from_utf8_lossy(&show.stdout);
                if let Some(pid_str) = out.trim().strip_prefix("MainPID=") {
                    if let Ok(pid) = pid_str.trim().parse::<u32>() {
                        if pid > 0 {
                            status.pid = Some(pid);
                        }
                    }
                }
            }
        } else {
            if let Ok(show) = std::process::Command::new("systemctl")
                .args(["--user", "show", "devm8", "--property=ExecMainStatus"])
                .output()
            {
                let out = String::from_utf8_lossy(&show.stdout);
                if let Some(code_str) = out.trim().strip_prefix("ExecMainStatus=") {
                    if let Ok(code) = code_str.trim().parse::<i32>() {
                        status.exit_code = Some(code);
                    }
                }
            }
        }
    }

    status
}
