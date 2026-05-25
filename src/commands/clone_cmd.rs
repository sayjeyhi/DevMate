use inquire::Text;
use tokio::process::Command;

use crate::commands::add_project_cmd::register_project;
use crate::shared::errors::{AppError, FriendlyError};
use crate::shared::paths::expand_tilde;

pub async fn clone_command(url: Option<String>, path: Option<String>) -> Result<(), AppError> {
    let ssh_url = match url {
        Some(u) => u,
        None => Text::new("SSH repository URL (e.g. git@github.com:org/repo.git):")
            .with_validator(|v: &str| {
                let v = v.trim();
                if v.is_empty() {
                    return Ok(inquire::validator::Validation::Invalid(
                        "URL cannot be empty".into(),
                    ));
                }
                if !v.starts_with("git@") && !v.starts_with("ssh://") {
                    return Ok(inquire::validator::Validation::Invalid(
                        "Must be an SSH URL (git@host:... or ssh://...)".into(),
                    ));
                }
                Ok(inquire::validator::Validation::Valid)
            })
            .prompt()
            .map_err(|e| prompt_err("url", e))?,
    };

    let dest_path = match path {
        Some(p) => p,
        None => Text::new("Destination path:")
            .with_validator(|v: &str| {
                if v.trim().is_empty() {
                    return Ok(inquire::validator::Validation::Invalid(
                        "Path cannot be empty".into(),
                    ));
                }
                Ok(inquire::validator::Validation::Valid)
            })
            .prompt()
            .map_err(|e| prompt_err("path", e))?,
    };

    let dest_path = expand_tilde(dest_path.trim());

    println!("Cloning {} → {}", ssh_url.trim(), dest_path);

    let output = Command::new("git")
        .args(["clone", ssh_url.trim(), &dest_path])
        .output()
        .await
        .map_err(|e| {
            AppError::Friendly(FriendlyError::with_hint(
                format!("Failed to run git: {e}"),
                "Ensure git is installed and accessible in PATH.",
            ))
        })?;

    if output.status.success() {
        println!("Cloned into {dest_path}");
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Friendly(FriendlyError::with_hint(
            format!("git clone failed: {stderr}"),
            "Check that your SSH key is loaded and you have access to the repository.",
        )));
    }

    // Register as a project — default name is the repo folder name
    let default_name = std::path::Path::new(&dest_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("project")
        .to_string();

    let project_name = Text::new("Project name:")
        .with_initial_value(&default_name)
        .with_validator(|v: &str| {
            if v.trim().is_empty() {
                return Ok(inquire::validator::Validation::Invalid(
                    "Project name cannot be empty".into(),
                ));
            }
            Ok(inquire::validator::Validation::Valid)
        })
        .prompt()
        .map_err(|e| prompt_err("project_name", e))?;

    let project_name = project_name.trim().to_string();
    register_project(&dest_path, &project_name)?;
    println!("Added to projects under {project_name}");

    Ok(())
}

fn prompt_err(field: &str, e: inquire::InquireError) -> AppError {
    AppError::Friendly(FriendlyError::new(format!(
        "Prompt for '{field}' failed: {e}"
    )))
}
