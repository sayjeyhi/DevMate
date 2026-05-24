#[cfg(target_os = "macos")]
pub mod launchd;
pub mod pid;
pub mod restart_tracker;
#[cfg(target_os = "linux")]
pub mod systemd;

#[cfg(target_os = "macos")]
#[allow(unused_imports)]
pub use launchd::{
    agent_status, generate_plist, load_agent, unload_agent, write_service_file, AgentStatus,
};

#[cfg(target_os = "linux")]
#[allow(unused_imports)]
pub use systemd::{agent_status, load_agent, unload_agent, write_service_file, AgentStatus};

#[cfg(target_os = "linux")]
#[allow(unused_imports)]
pub use pid::{find_daemon_pids, kill_all_daemons};
#[allow(unused_imports)]
pub use pid::{is_process_running, read_pid, remove_pid, write_pid};
#[allow(unused_imports)]
pub use restart_tracker::RestartTracker;
