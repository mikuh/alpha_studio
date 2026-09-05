//! Ephemeral, bounded display previews. Never store complete argument documents
//! or reasoning payloads. Tool identity is separate from the agent/request lane.
use crate::stream_text::JsonStringField;
use serde::Serialize;
use serde_json::Value;
use std::{collections::BTreeMap, sync::LazyLock};

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
    pub item_id: Option<String>,
    pub call_id: Option<String>,
    pub updated_at: i64,
    #[serde(skip)]
    decoder: JsonStringField,
    #[serde(skip)]
    raw_preview: String,
    #[serde(skip)]
    hiding_secret_tail: bool,
}

impl RequestProgress {
    fn new(id: String, subagent: bool, kind: &'static str) -> Self {
        Self {
            id,
            subagent,
            kind,
            characters: 0,
            preview: String::new(),
            tool_name: None,
            item_id: None,
            call_id: None,
            updated_at: 0,
            decoder: JsonStringField::default(),
            raw_preview: String::new(),
            hiding_secret_tail: false,
        }
    }

    fn append(&mut self, delta: &str, text: &str) {
        self.characters = self.characters.saturating_add(delta.chars().count());
        let text = if self.hiding_secret_tail {
            if let Some(end) = text.find(|ch: char| ch.is_whitespace() || "\"'`,;)}".contains(ch)) {
                self.hiding_secret_tail = false;
                &text[end..]
            } else {
                ""
            }
        } else {
            text
        };
        self.raw_preview.push_str(text);
        if let Some((cut, _)) = self
            .raw_preview
            .char_indices()
            .rev()
            .nth(PREVIEW_CHARACTERS * 4 - 1)
        {
            // Never crop away a credential prefix while retaining its value.
            if let Some(secret) = credential_pattern()
                .find_iter(&self.raw_preview)
                .find(|secret| secret.start() < cut && secret.end() > cut)
            {
                self.hiding_secret_tail = secret.end() == self.raw_preview.len();
                self.raw_preview = format!("[已隐藏]{}", &self.raw_preview[secret.end()..]);
            } else {
                self.raw_preview = self.raw_preview[cut..].to_string();
            }
        }
        self.preview = tail(&redact_preview(&self.raw_preview), PREVIEW_CHARACTERS);
        self.updated_at = chrono::Utc::now().timestamp_millis();
    }
}

fn tail(value: &str, count: usize) -> String {
    value
        .chars()
        .rev()
        .take(count)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect()
}

fn credential_pattern() -> &'static regex::Regex {
    static CREDENTIAL: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(
        r#"(?i)(?:bearer\s+|\bsk-)[^\s"'`,;)}]*|(?:api[_-]?key|access[_-]?token|password|secret|authorization|token)["']?\s*[:=]\s*["']?[^\s"'`,;)}]*"#
    ).unwrap()
    });
    &CREDENTIAL
}

fn redact_preview(text: &str) -> String {
    credential_pattern()
        .replace_all(text, "[已隐藏]")
        .into_owned()
}

pub struct RequestOutput {
    lane: String,
    summary: RequestProgress,
    tools: BTreeMap<String, RequestProgress>,
}

impl RequestOutput {
    pub fn new(lane: String) -> Self {
        Self {
            summary: RequestProgress::new(lane.clone(), lane != "main", "waiting"),
            lane,
            tools: BTreeMap::new(),
        }
    }

    pub fn progress(&self) -> impl Iterator<Item = &RequestProgress> {
        self.tools
            .values()
            .chain(std::iter::once(&self.summary).filter(|_| self.tools.is_empty()))
    }

    pub fn observe(&mut self, data: &str) -> bool {
        let Ok(value) = serde_json::from_str::<Value>(data) else {
            return false;
        };
        let event = value["type"].as_str().unwrap_or_default();
        let delta = value["delta"].as_str().unwrap_or_default();
        if event == "response.output_item.added" {
            let item = &value["item"];
            if matches!(
                item["type"].as_str(),
                Some("function_call" | "custom_tool_call")
            ) {
                let key = item["id"]
                    .as_str()
                    .or(item["call_id"].as_str())
                    .unwrap_or("pending")
                    .to_string();
                if self.tools.len() >= 32 && !self.tools.contains_key(&key) {
                    return false;
                }
                let mut progress = RequestProgress::new(
                    format!("{}:{key}", self.lane),
                    self.lane != "main",
                    "tool_input",
                );
                progress.item_id = item["id"].as_str().map(str::to_string);
                progress.call_id = item["call_id"].as_str().map(str::to_string);
                progress.tool_name = item["name"].as_str().map(|s| s.chars().take(100).collect());
                progress.updated_at = chrono::Utc::now().timestamp_millis();
                self.tools.insert(key, progress);
                self.summary.updated_at = 0;
                return true;
            }
        }
        if event == "response.output_item.done" {
            let key = value["item"]["id"]
                .as_str()
                .or(value["item"]["call_id"].as_str())
                .unwrap_or("pending");
            return self.tools.remove(key).is_some();
        }
        if matches!(
            event,
            "response.completed" | "response.failed" | "response.incomplete"
        ) {
            self.tools.clear();
            self.summary.updated_at = 0;
            return true;
        }
        if matches!(
            event,
            "response.function_call_arguments.delta" | "response.custom_tool_call_input.delta"
        ) && !delta.is_empty()
        {
            let key = value["item_id"].as_str().map(str::to_string).or_else(|| {
                (self.tools.len() == 1).then(|| self.tools.keys().next().unwrap().clone())
            });
            let Some(progress) = key.and_then(|key| self.tools.get_mut(&key)) else {
                return false;
            };
            let text = if event == "response.custom_tool_call_input.delta" {
                delta.to_string()
            } else {
                progress.decoder.push(
                    delta,
                    &[
                        "cmd",
                        "command",
                        "input",
                        "query",
                        "q",
                        "pattern",
                        "path",
                        "file_path",
                    ],
                )
            };
            progress.append(delta, &text);
            return true;
        }
        let kind = match event {
            "response.output_text.delta" if !delta.is_empty() => "reply",
            "response.reasoning_summary_text.delta" | "response.reasoning_text.delta"
                if !delta.is_empty() =>
            {
                "reasoning"
            }
            "response.output_item.added" => match value["item"]["type"].as_str() {
                Some("reasoning") => "reasoning",
                Some("web_search_call") => "search",
                _ => return false,
            },
            _ => return false,
        };
        if self.summary.kind != kind {
            self.summary = RequestProgress::new(self.lane.clone(), self.lane != "main", kind);
        }
        let text = if kind == "reply" && self.summary.subagent {
            delta
        } else {
            ""
        };
        self.summary
            .append(if kind == "reply" { delta } else { "" }, text);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keeps_a_fragmented_secret_hidden_when_its_prefix_leaves_the_tail() {
        let mut progress = RequestProgress::new("main:a".into(), false, "tool_input");
        progress.append("", "curl -H 'Authorization: Bearer sk-");
        for _ in 0..50 {
            progress.append("", &"s".repeat(100));
        }
        assert!(!progress.preview.contains("ssss"));
        assert!(progress.raw_preview.len() < 4000);
        progress.append("", "more-secret' report.html");
        assert!(!progress.preview.contains("more-secret"));
        assert!(progress.preview.ends_with("report.html"));
    }

    #[test]
    fn streams_only_display_fields_and_never_reasoning_or_credentials() {
        let mut output = RequestOutput::new("main".into());
        output.observe(&json!({"type":"response.output_item.added","item":{"id":"a","call_id":"call-a","type":"function_call","name":"exec_command"}}).to_string());
        output.observe(&json!({"type":"response.function_call_arguments.delta","item_id":"a","delta":"{\"cmd\":\"python report"}).to_string());
        let p = output.progress().next().unwrap();
        assert_eq!(p.preview, "python report");
        assert_eq!(p.call_id.as_deref(), Some("call-a"));
        output.observe(&json!({"type":"response.function_call_arguments.delta","item_id":"a","delta":".py\",\"api_key\":\"hidden\"}"}).to_string());
        assert_eq!(
            output.progress().next().unwrap().preview,
            "python report.py"
        );
        assert!(
            !serde_json::to_string(&output.progress().collect::<Vec<_>>())
                .unwrap()
                .contains("hidden")
        );
        output.observe(r#"{"type":"response.output_item.done","item":{"id":"a"}}"#);
        output.observe(r#"{"type":"response.reasoning_text.delta","delta":"private reasoning"}"#);
        assert!(output.summary.preview.is_empty());
        assert_eq!(output.summary.characters, 0);
    }

    #[test]
    fn interleaved_calls_keep_their_own_names_previews_and_lifecycle() {
        let mut output = RequestOutput::new("main".into());
        for id in ["a", "b"] {
            output.observe(&json!({"type":"response.output_item.added","item":{"id":id,"type":"function_call","name":id}}).to_string());
        }
        for (id, text) in [("b", "second"), ("a", "first")] {
            output.observe(&json!({"type":"response.function_call_arguments.delta","item_id":id,"delta":format!("{{\"cmd\":\"{text}")}).to_string());
        }
        assert_eq!(output.tools["a"].preview, "first");
        assert_eq!(output.tools["b"].preview, "second");
        output.observe(r#"{"type":"response.output_item.done","item":{"id":"a"}}"#);
        assert_eq!(output.tools.len(), 1);
        assert_eq!(
            output.progress().next().unwrap().tool_name.as_deref(),
            Some("b")
        );
    }

    #[test]
    fn bounds_child_prose_and_does_not_duplicate_main_prose() {
        let mut child = RequestOutput::new("child".into());
        child.observe(
            &json!({"type":"response.output_text.delta","delta":"可见进展".repeat(400)})
                .to_string(),
        );
        assert_eq!(child.summary.preview.chars().count(), PREVIEW_CHARACTERS);
        let mut main = RequestOutput::new("main".into());
        main.observe(r#"{"type":"response.output_text.delta","delta":"hello"}"#);
        assert!(main.summary.preview.is_empty());
        assert_eq!(main.summary.characters, 5);
        assert!(!main.observe("[DONE]"));
        assert_eq!(
            redact_preview("curl -H 'Authorization: Bearer sk-abc'"),
            "curl -H '[已隐藏] [已隐藏]'"
        );
    }
}
