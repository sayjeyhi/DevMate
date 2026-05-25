use std::sync::Arc;

use anyhow::Result;
use serde_json::json;
use teloxide::prelude::*;
use teloxide::types::{ChatId, ParseMode};

use crate::bot::utils::keep_typing;
use crate::bot::AppState;
use crate::claude::types::AskOptions;

const IMPROVE_PROMPT: &str = "\
You are a technical project manager improving a Jira ticket.

Project: {project_key}
Original title: {title}
{description_section}

Your tasks:
1. Correct and improve the title — fix grammar, spelling, and clarity; keep it concise (under 80 chars).
2. Write a professional description including: brief overview, acceptance criteria as a bullet list, \
and relevant technical notes. If a raw description was provided, expand and improve it; \
otherwise generate one from the title.

Respond in this exact format with nothing else before or after:
TITLE: <corrected title>

DESCRIPTION:
<description here>";

fn parse_claude_response(response: &str) -> (String, String) {
    let title = response
        .lines()
        .find(|l| l.starts_with("TITLE:"))
        .map(|l| l["TITLE:".len()..].trim().to_string())
        .unwrap_or_default();

    let desc = response
        .find("DESCRIPTION:\n")
        .map(|idx| response[idx + "DESCRIPTION:\n".len()..].trim().to_string())
        .unwrap_or_default();

    (title, desc)
}

pub async fn handle_create(
    bot: Bot,
    chat_id: ChatId,
    state: Arc<AppState>,
    project_key: String,
    args: String,
) -> Result<()> {
    let args = args.trim().to_string();
    if args.is_empty() {
        bot.send_message(
            chat_id,
            "Send the issue title (optionally add a raw description after <code>--</code>):\n\
             <code>New login page -- Add OAuth2 support and redirect flow</code>",
        )
        .parse_mode(ParseMode::Html)
        .await?;
        return Ok(());
    }

    let (title, raw_description) = if let Some(idx) = args.find(" -- ") {
        (
            args[..idx].trim().to_string(),
            args[idx + 4..].trim().to_string(),
        )
    } else {
        (args.trim().to_string(), String::new())
    };

    let description_section = if raw_description.is_empty() {
        "No description provided — generate from title.".to_string()
    } else {
        format!("Raw description:\n{raw_description}")
    };

    state.logger.info(
        "create: improving title and description with Claude",
        Some(&json!({
            "project": &project_key,
            "title": &title,
            "has_description": !raw_description.is_empty()
        })),
    );

    let thinking = bot
        .send_message(chat_id, "Improving title and generating description...")
        .await?;
    let _typing = keep_typing(bot.clone(), chat_id);

    let prompt = IMPROVE_PROMPT
        .replace("{project_key}", &project_key)
        .replace("{title}", &title)
        .replace("{description_section}", &description_section);

    let claude_output = match state.claude.ask(&prompt, AskOptions::default()).await {
        Ok(text) => text,
        Err(e) => {
            state.logger.error(
                &format!("create: Claude error: {e}"),
                Some(&json!({ "title": &title })),
            );
            bot.edit_message_text(chat_id, thinking.id, format!("Claude error: {e}"))
                .await?;
            return Ok(());
        }
    };

    let (final_title, final_description) = parse_claude_response(&claude_output);

    let final_title = if final_title.is_empty() {
        title
    } else {
        final_title
    };
    let final_description = if final_description.is_empty() {
        claude_output.clone()
    } else {
        final_description
    };

    state.logger.info(
        "create: creating Jira issue",
        Some(&json!({ "project": &project_key, "title": &final_title })),
    );

    let issue = match state
        .jira
        .create_issue(&project_key, &final_title, &final_description)
        .await
    {
        Ok(issue) => issue,
        Err(e) => {
            state.logger.error(
                &format!("create: Jira error: {e}"),
                Some(&json!({ "project": &project_key, "title": &final_title })),
            );
            bot.edit_message_text(chat_id, thinking.id, format!("Jira error: {e}"))
                .await?;
            return Ok(());
        }
    };

    state.logger.info(
        "create: issue created",
        Some(&json!({ "key": &issue.key, "url": &issue.url })),
    );

    bot.edit_message_text(
        chat_id,
        thinking.id,
        format!(
            "Created: <a href=\"{}\">{}</a> — {}",
            issue.url, issue.key, issue.summary
        ),
    )
    .parse_mode(ParseMode::Html)
    .await?;

    Ok(())
}
