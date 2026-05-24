use crate::daemon::pid::remove_pid;
use crate::daemon::unload_agent;
use crate::logger::{append_to_log_file, Level};
use crate::shared::errors::AppError;
use crate::shared::paths::PATHS;

pub async fn stop_command() -> Result<(), AppError> {
    let paths = &*PATHS;

    // Unload via service manager (systemd/launchd).
    if let Err(e) = unload_agent().await {
        eprintln!("Warning: could not unload agent: {e}");
    }

    // Safety net: kill any remaining daemon processes missed by the service manager.
    #[cfg(target_os = "linux")]
    {
        let remaining = crate::daemon::kill_all_daemons();
        if remaining > 0 {
            println!("Killed {remaining} remaining daemon process(es).");
        }
    }

    remove_pid(None).await?;

    append_to_log_file(&paths.log_file, Level::Info, "service stopped", None);
    println!("devm8 stopped");

    Ok(())
}
