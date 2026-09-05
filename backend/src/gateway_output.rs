//! Small, ephemeral previews of public model output. Never retain prompts,
//! reasoning payloads, tool arguments, encrypted content, or complete reports.
use serde::Serialize;
use serde_json::Value;

const PREVIEW_CHARACTERS: usize = 900;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestProgress {
    pub id: String,
    pub subagent: bool,
    pub kind: &'static str,
    pub characters: usize,
    pub preview: String,
    pub tool_name: Option<String>,
    pub updated_at: i64,
}

impl RequestProgress {
    pub fn new(id: String) -> Self {
        Self {
            subagent: id != "main",
            id,
            kind: "waiting",
            characters: 0,
            preview: String::new(),
            tool_name: None,
            updated_at: 0,
        }
    }

    pub fn observe(&mut self, data: &str) -> bool {
        let Ok(value) = serde_json::from_str::<Value>(data) else {
            return false;
        };
        let event = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let delta = value
            .get("delta")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let (kind, public_text) = match event {
            "response.output_text.delta" if !delta.is_empty() => ("reply", true),
            "response.function_call_arguments.delta" | "response.custom_tool_call_input.delta"
                if !delta.is_empty() =>
            {
                ("tool_input", false)
            }
            "response.reasoning_summary_text.delta" | "response.reasoning_text.delta"
                if !delta.is_empty() =>
            {
                ("reasoning", false)
            }
            "response.output_item.added" => {
                let item = &value["item"];
                match item["type"].as_str() {
                    Some("function_call" | "custom_tool_call") => {
                        self.characters = 0;
                        self.preview.clear();
                        self.tool_name = item["name"]
                            .as_str()
                            .map(|name| name.chars().take(100).collect());
                        ("tool_input", false)
                    }
                    Some("reasoning") => ("reasoning", false),
                    Some("web_search_call") => ("search", false),
                    _ => return false,
                }
            }
            _ => return false, // Created, usage, ping and [DONE] are not prose.
        };
        if self.kind != kind {
            self.characters = 0;
            self.preview.clear();
            if kind != "tool_input" {
                self.tool_name = None;
            }
        }
        self.kind = kind;
        if matches!(kind, "reply" | "tool_input") {
            self.characters = self.characters.saturating_add(delta.chars().count());
        }
        // Main-thread prose is already streamed over the native app-server.
        // Child-thread prose needs a separate, explicitly labelled preview.
        if public_text && self.subagent {
            self.preview.push_str(delta);
            self.preview = self
                .preview
                .chars()
                .rev()
                .take(PREVIEW_CHARACTERS)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
        }
        self.updated_at = chrono::Utc::now().timestamp_millis();
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn distinguishes_content_from_transport_and_never_previews_private_payloads() {
        let mut progress = RequestProgress::new("agent:child".into());
        for data in [
            r#"{"type":"response.created"}"#,
            r#"{"type":"response.completed"}"#,
            "[DONE]",
        ] {
            assert!(!progress.observe(data));
        }
        progress.observe(&json!({"type":"response.output_item.added","item":{"type":"function_call","name":"exec"}}).to_string());
        progress.observe(&json!({"type":"response.function_call_arguments.delta","delta":"secret tool argument"}).to_string());
        assert_eq!(progress.kind, "tool_input");
        assert_eq!(progress.characters, 20);
        assert!(progress.preview.is_empty());
        progress.observe(
            &json!({"type":"response.reasoning_text.delta","delta":"private reasoning"})
                .to_string(),
        );
        assert_eq!(progress.kind, "reasoning");
        assert!(progress.preview.is_empty());
        assert_eq!(progress.characters, 0);
        progress.observe(
            &json!({"type":"response.output_text.delta","delta":"可见进展".repeat(400)})
                .to_string(),
        );
        assert_eq!(progress.preview.chars().count(), PREVIEW_CHARACTERS);
        assert_eq!(progress.characters, 1600);
        assert!(!serde_json::to_string(&progress).unwrap().contains("secret"));
    }

    #[test]
    fn main_reply_is_not_duplicated_in_gateway_preview() {
        let mut progress = RequestProgress::new("main".into());
        assert!(progress.observe(r#"{"type":"response.output_text.delta","delta":"Hello"}"#));
        assert_eq!(progress.kind, "reply");
        assert_eq!(progress.characters, 5);
        assert!(progress.preview.is_empty());
    }
}
