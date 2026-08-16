use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde_json::{json, Value};

use crate::{
    billing::{usage_from_openai_response, GatewayUsage},
    gateway::{restore_namespace_tool_calls_in_value, upstream_tool_name, UpstreamResponseFormat},
};

#[derive(Debug, PartialEq, Eq)]
pub struct SseFrame {
    pub raw: Vec<u8>,
    pub data: Option<String>,
}

#[derive(Default)]
pub struct SseDecoder {
    buffer: Vec<u8>,
}

impl SseDecoder {
    pub fn push(&mut self, chunk: &[u8]) -> Vec<SseFrame> {
        self.buffer.extend_from_slice(chunk);
        let mut frames = Vec::new();
        while let Some((end, delimiter_len)) = find_frame_end(&self.buffer) {
            let raw = self.buffer.drain(..end + delimiter_len).collect::<Vec<_>>();
            frames.push(parse_frame(raw));
        }
        frames
    }

    pub fn finish(&mut self) -> Option<SseFrame> {
        if self.buffer.is_empty() {
            return None;
        }
        Some(parse_frame(std::mem::take(&mut self.buffer)))
    }
}

fn find_frame_end(bytes: &[u8]) -> Option<(usize, usize)> {
    let lf = bytes.windows(2).position(|window| window == b"\n\n");
    let crlf = bytes.windows(4).position(|window| window == b"\r\n\r\n");
    match (lf, crlf) {
        (Some(left), Some(right)) if left <= right => Some((left, 2)),
        (Some(_), Some(right)) => Some((right, 4)),
        (Some(index), None) => Some((index, 2)),
        (None, Some(index)) => Some((index, 4)),
        (None, None) => None,
    }
}

fn parse_frame(raw: Vec<u8>) -> SseFrame {
    let text = String::from_utf8_lossy(&raw);
    let data = text
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(|line| line.strip_prefix(' ').unwrap_or(line))
        .map(str::to_string)
        .collect::<Vec<_>>();
    SseFrame {
        raw,
        data: (!data.is_empty()).then(|| data.join("\n")),
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NativeStreamEvent {
    Completed(GatewayUsage),
    Failed,
}

pub fn inspect_responses_stream_data(data: &str) -> Option<NativeStreamEvent> {
    if data.trim() == "[DONE]" {
        return None;
    }
    let value = serde_json::from_str::<Value>(data).ok()?;
    match value.get("type").and_then(Value::as_str) {
        Some("response.completed") => {
            let response = value.get("response").unwrap_or(&value);
            Some(NativeStreamEvent::Completed(usage_from_openai_response(
                response,
            )))
        }
        Some("response.failed" | "response.incomplete" | "error") => {
            Some(NativeStreamEvent::Failed)
        }
        _ => None,
    }
}

/// Completion frames must not reach Codex until the gateway has settled usage
/// and released the run's per-request lease. Codex starts the next model call
/// as soon as it observes one of these frames; waiting only for the HTTP body
/// to reach EOF is therefore too late.
pub fn is_terminal_responses_stream_data(data: &str) -> bool {
    data.trim() == "[DONE]" || inspect_responses_stream_data(data).is_some()
}

/// Rewrite a complete native Responses SSE frame after a strict upstream used
/// flattened names for Codex namespace tools. Non-JSON and unchanged frames are
/// returned byte-for-byte.
pub fn restore_namespace_tools_in_sse_frame(frame: SseFrame, original_request: &Value) -> Vec<u8> {
    let Some(data) = frame.data.as_deref() else {
        return frame.raw;
    };
    if data.trim() == "[DONE]" {
        return frame.raw;
    }
    let Ok(mut value) = serde_json::from_str::<Value>(data) else {
        return frame.raw;
    };
    if !restore_namespace_tool_calls_in_value(&mut value, original_request) {
        return frame.raw;
    }

    let raw = String::from_utf8_lossy(&frame.raw);
    let mut output = String::new();
    for line in raw.lines() {
        if line.starts_with("data:") || line.is_empty() {
            continue;
        }
        output.push_str(line);
        output.push('\n');
    }
    output.push_str("data: ");
    output.push_str(&value.to_string());
    output.push_str("\n\n");
    output.into_bytes()
}

#[derive(Clone, Debug)]
enum StreamItem {
    Reasoning {
        id: String,
        text: String,
    },
    Message {
        id: String,
        text: String,
    },
    Tool {
        id: String,
        call_id: String,
        name: String,
        arguments: String,
        custom: bool,
    },
}

pub struct ResponsesStreamAdapter {
    format: UpstreamResponseFormat,
    response_id: String,
    model: Value,
    created: bool,
    finished: bool,
    sequence: u64,
    items: Vec<StreamItem>,
    reasoning_index: Option<usize>,
    message_index: Option<usize>,
    tools: HashMap<usize, usize>,
    original_names: BTreeMap<String, String>,
    custom_tools: BTreeSet<String>,
    usage: GatewayUsage,
}

impl ResponsesStreamAdapter {
    pub fn new(format: UpstreamResponseFormat, original_request: &Value) -> Self {
        let mut original_names = BTreeMap::new();
        let mut custom_tools = BTreeSet::new();
        for tool in original_request
            .get("tools")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let function = tool.get("function").unwrap_or(tool);
            let Some(name) = function.get("name").and_then(Value::as_str) else {
                continue;
            };
            original_names.insert(name.to_string(), name.to_string());
            original_names.insert(upstream_tool_name(name), name.to_string());
            if tool.get("type").and_then(Value::as_str) == Some("custom") {
                custom_tools.insert(name.to_string());
            }
        }
        Self {
            format,
            response_id: "resp_alpha_studio_gateway".to_string(),
            model: Value::Null,
            created: false,
            finished: false,
            sequence: 0,
            items: Vec::new(),
            reasoning_index: None,
            message_index: None,
            tools: HashMap::new(),
            original_names,
            custom_tools,
            usage: GatewayUsage::default(),
        }
    }

    pub fn ingest(&mut self, data: &str) -> Result<String, String> {
        if self.finished || data.trim().is_empty() {
            return Ok(String::new());
        }
        if data.trim() == "[DONE]" {
            return Ok(self.finish());
        }
        let value = serde_json::from_str::<Value>(data)
            .map_err(|error| format!("invalid upstream SSE JSON: {error}"))?;
        match self.format {
            UpstreamResponseFormat::ChatCompletions => self.ingest_chat(&value),
            UpstreamResponseFormat::AnthropicMessages => self.ingest_anthropic(&value),
            UpstreamResponseFormat::GeminiGenerateContent => self.ingest_gemini(&value),
            UpstreamResponseFormat::Responses => {
                Err("native Responses streams should be forwarded without an adapter".to_string())
            }
        }
    }

    pub fn finish(&mut self) -> String {
        if self.finished {
            return String::new();
        }
        self.finished = true;
        let mut output = String::new();
        self.ensure_created(&mut output);

        if self.items.is_empty() {
            self.push_text_delta("（模型返回了空内容）", &mut output);
        }

        let items = self.items.clone();
        let mut completed = Vec::new();
        for (output_index, item) in items.into_iter().enumerate() {
            match item {
                StreamItem::Reasoning { id, text } => {
                    self.emit(
                        &mut output,
                        "response.reasoning_summary_text.done",
                        json!({
                            "type": "response.reasoning_summary_text.done",
                            "item_id": id,
                            "output_index": output_index,
                            "summary_index": 0,
                            "text": text
                        }),
                    );
                    self.emit(
                        &mut output,
                        "response.reasoning_summary_part.done",
                        json!({
                            "type": "response.reasoning_summary_part.done",
                            "item_id": id,
                            "output_index": output_index,
                            "summary_index": 0,
                            "part": { "type": "summary_text", "text": text }
                        }),
                    );
                    let item = json!({
                        "id": id,
                        "type": "reasoning",
                        "summary": [{ "type": "summary_text", "text": text }]
                    });
                    self.emit(
                        &mut output,
                        "response.output_item.done",
                        json!({
                            "type": "response.output_item.done",
                            "output_index": output_index,
                            "item": item
                        }),
                    );
                    completed.push(item);
                }
                StreamItem::Message { id, text } => {
                    self.emit(
                        &mut output,
                        "response.output_text.done",
                        json!({
                            "type": "response.output_text.done",
                            "item_id": id,
                            "output_index": output_index,
                            "content_index": 0,
                            "text": text
                        }),
                    );
                    self.emit(
                        &mut output,
                        "response.content_part.done",
                        json!({
                            "type": "response.content_part.done",
                            "item_id": id,
                            "output_index": output_index,
                            "content_index": 0,
                            "part": { "type": "output_text", "text": text }
                        }),
                    );
                    let item = json!({
                        "id": id,
                        "type": "message",
                        "status": "completed",
                        "role": "assistant",
                        "content": [{ "type": "output_text", "text": text, "annotations": [] }]
                    });
                    self.emit(
                        &mut output,
                        "response.output_item.done",
                        json!({
                            "type": "response.output_item.done",
                            "output_index": output_index,
                            "item": item
                        }),
                    );
                    completed.push(item);
                }
                StreamItem::Tool {
                    id,
                    call_id,
                    name,
                    arguments,
                    custom,
                } => {
                    if custom {
                        let input = custom_tool_input(&arguments);
                        if !input.is_empty() {
                            self.emit(
                                &mut output,
                                "response.custom_tool_call_input.delta",
                                json!({
                                    "type": "response.custom_tool_call_input.delta",
                                    "item_id": id,
                                    "output_index": output_index,
                                    "delta": input
                                }),
                            );
                        }
                        self.emit(
                            &mut output,
                            "response.custom_tool_call_input.done",
                            json!({
                                "type": "response.custom_tool_call_input.done",
                                "item_id": id,
                                "output_index": output_index,
                                "input": input
                            }),
                        );
                        let item = json!({
                            "id": id,
                            "type": "custom_tool_call",
                            "call_id": call_id,
                            "name": name,
                            "input": input
                        });
                        self.emit(
                            &mut output,
                            "response.output_item.done",
                            json!({
                                "type": "response.output_item.done",
                                "output_index": output_index,
                                "item": item
                            }),
                        );
                        completed.push(item);
                    } else {
                        self.emit(
                            &mut output,
                            "response.function_call_arguments.done",
                            json!({
                                "type": "response.function_call_arguments.done",
                                "item_id": id,
                                "output_index": output_index,
                                "arguments": arguments
                            }),
                        );
                        let item = json!({
                            "id": id,
                            "type": "function_call",
                            "status": "completed",
                            "call_id": call_id,
                            "name": name,
                            "arguments": arguments
                        });
                        self.emit(
                            &mut output,
                            "response.output_item.done",
                            json!({
                                "type": "response.output_item.done",
                                "output_index": output_index,
                                "item": item
                            }),
                        );
                        completed.push(item);
                    }
                }
            }
        }

        let response = json!({
            "id": self.response_id,
            "object": "response",
            "created_at": 0,
            "model": self.model,
            "status": "completed",
            "output": completed,
            "usage": usage_json(&self.usage)
        });
        self.emit(
            &mut output,
            "response.completed",
            json!({ "type": "response.completed", "response": response }),
        );
        output.push_str("data: [DONE]\n\n");
        output
    }

    pub fn fail(&mut self, error: &str) -> String {
        if self.finished {
            return String::new();
        }
        self.finished = true;
        let mut output = String::new();
        self.ensure_created(&mut output);
        self.emit(
            &mut output,
            "response.failed",
            json!({
                "type": "response.failed",
                "response": {
                    "id": self.response_id,
                    "status": "failed",
                    "error": { "code": "upstream_stream_error", "message": error }
                }
            }),
        );
        output.push_str("data: [DONE]\n\n");
        output
    }

    pub fn usage(&self) -> GatewayUsage {
        self.usage.clone()
    }

    pub fn is_finished(&self) -> bool {
        self.finished
    }

    fn ingest_chat(&mut self, value: &Value) -> Result<String, String> {
        self.update_identity(value, "id", "model");
        if let Some(usage) = value.get("usage").filter(|usage| !usage.is_null()) {
            self.usage = chat_usage(usage);
        }
        let mut output = String::new();
        self.ensure_created(&mut output);
        for choice in value
            .get("choices")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(delta) = choice.get("delta") else {
                continue;
            };
            if let Some(reasoning) = delta
                .get("reasoning_content")
                .or_else(|| delta.get("reasoning"))
                .or_else(|| delta.get("reasoning_details"))
                .map(content_to_text)
                .filter(|text| !text.is_empty())
            {
                self.push_reasoning_delta(&reasoning, &mut output);
            }
            if let Some(text) = delta
                .get("content")
                .map(content_to_text)
                .filter(|text| !text.is_empty())
            {
                self.push_text_delta(&text, &mut output);
            }
            if let Some(calls) = delta.get("tool_calls").and_then(Value::as_array) {
                for (fallback_index, call) in calls.iter().enumerate() {
                    let tool_index = call
                        .get("index")
                        .and_then(Value::as_u64)
                        .map(|index| index as usize)
                        .unwrap_or(fallback_index);
                    let function = call.get("function").unwrap_or(call);
                    let name = function.get("name").and_then(Value::as_str);
                    let arguments = function
                        .get("arguments")
                        .map(value_to_string)
                        .unwrap_or_default();
                    let call_id = call.get("id").and_then(Value::as_str);
                    self.push_tool_delta(tool_index, call_id, name, &arguments, &mut output);
                }
            } else if let Some(call) = delta.get("function_call") {
                self.push_tool_delta(
                    0,
                    call.get("id").and_then(Value::as_str),
                    call.get("name").and_then(Value::as_str),
                    &call
                        .get("arguments")
                        .map(value_to_string)
                        .unwrap_or_default(),
                    &mut output,
                );
            }
        }
        Ok(output)
    }

    fn ingest_anthropic(&mut self, value: &Value) -> Result<String, String> {
        let event_type = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if let Some(message) = value.get("message") {
            self.update_identity(message, "id", "model");
            if let Some(usage) = message.get("usage") {
                merge_anthropic_usage(&mut self.usage, usage);
            }
        }
        let mut output = String::new();
        self.ensure_created(&mut output);
        match event_type {
            "content_block_start" => {
                let block_index = value.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                let block = value.get("content_block").unwrap_or(&Value::Null);
                match block
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                {
                    "text" => {
                        if let Some(text) = block.get("text").and_then(Value::as_str) {
                            self.push_text_delta(text, &mut output);
                        }
                    }
                    "thinking" => {
                        if let Some(text) = block.get("thinking").and_then(Value::as_str) {
                            self.push_reasoning_delta(text, &mut output);
                        }
                    }
                    "tool_use" => {
                        let arguments = block
                            .get("input")
                            .filter(|input| !input.is_null())
                            .map(value_to_string)
                            .filter(|input| input != "{}")
                            .unwrap_or_default();
                        self.push_tool_delta(
                            block_index,
                            block.get("id").and_then(Value::as_str),
                            block.get("name").and_then(Value::as_str),
                            &arguments,
                            &mut output,
                        );
                    }
                    _ => {}
                }
            }
            "content_block_delta" => {
                let block_index = value.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                let delta = value.get("delta").unwrap_or(&Value::Null);
                match delta
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                {
                    "text_delta" => self.push_text_delta(
                        delta
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                        &mut output,
                    ),
                    "thinking_delta" => self.push_reasoning_delta(
                        delta
                            .get("thinking")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                        &mut output,
                    ),
                    "input_json_delta" => self.push_tool_delta(
                        block_index,
                        None,
                        None,
                        delta
                            .get("partial_json")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                        &mut output,
                    ),
                    _ => {}
                }
            }
            "message_delta" => {
                if let Some(usage) = value.get("usage") {
                    merge_anthropic_usage(&mut self.usage, usage);
                }
            }
            "message_stop" => output.push_str(&self.finish()),
            "error" => {
                return Err(value
                    .get("error")
                    .and_then(|error| error.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("Anthropic stream failed")
                    .to_string());
            }
            _ => {}
        }
        Ok(output)
    }

    fn ingest_gemini(&mut self, value: &Value) -> Result<String, String> {
        self.update_identity(value, "responseId", "modelVersion");
        if let Some(usage) = value.get("usageMetadata") {
            self.usage = gemini_usage(usage);
        }
        let mut output = String::new();
        self.ensure_created(&mut output);
        for candidate in value
            .get("candidates")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            for (part_index, part) in candidate
                .get("content")
                .and_then(|content| content.get("parts"))
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .enumerate()
            {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    if part
                        .get("thought")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                    {
                        self.push_reasoning_delta(text, &mut output);
                    } else {
                        self.push_text_delta(text, &mut output);
                    }
                }
                if let Some(call) = part.get("functionCall") {
                    self.push_tool_delta(
                        part_index,
                        call.get("id").and_then(Value::as_str),
                        call.get("name").and_then(Value::as_str),
                        &call
                            .get("args")
                            .map(value_to_string)
                            .unwrap_or_else(|| "{}".to_string()),
                        &mut output,
                    );
                }
            }
        }
        Ok(output)
    }

    fn update_identity(&mut self, value: &Value, id_key: &str, model_key: &str) {
        if !self.created {
            if let Some(id) = value.get(id_key).and_then(Value::as_str) {
                self.response_id = id.to_string();
            }
            if let Some(model) = value.get(model_key).filter(|value| !value.is_null()) {
                self.model = model.clone();
            }
        }
    }

    fn ensure_created(&mut self, output: &mut String) {
        if self.created {
            return;
        }
        self.created = true;
        self.emit(
            output,
            "response.created",
            json!({
                "type": "response.created",
                "response": {
                    "id": self.response_id,
                    "object": "response",
                    "created_at": 0,
                    "model": self.model,
                    "status": "in_progress",
                    "output": []
                }
            }),
        );
    }

    fn push_reasoning_delta(&mut self, delta: &str, output: &mut String) {
        if delta.is_empty() {
            return;
        }
        let index = if let Some(index) = self.reasoning_index {
            index
        } else {
            let index = self.items.len();
            let id = format!("{}_reasoning", self.response_id);
            self.items.push(StreamItem::Reasoning {
                id: id.clone(),
                text: String::new(),
            });
            self.reasoning_index = Some(index);
            self.emit(
                output,
                "response.output_item.added",
                json!({
                    "type": "response.output_item.added",
                    "output_index": index,
                    "item": { "id": id, "type": "reasoning", "summary": [] }
                }),
            );
            self.emit(
                output,
                "response.reasoning_summary_part.added",
                json!({
                    "type": "response.reasoning_summary_part.added",
                    "item_id": id,
                    "output_index": index,
                    "summary_index": 0,
                    "part": { "type": "summary_text", "text": "" }
                }),
            );
            index
        };
        let id = match &mut self.items[index] {
            StreamItem::Reasoning { id, text } => {
                text.push_str(delta);
                id.clone()
            }
            _ => return,
        };
        self.emit(
            output,
            "response.reasoning_summary_text.delta",
            json!({
                "type": "response.reasoning_summary_text.delta",
                "item_id": id,
                "output_index": index,
                "summary_index": 0,
                "delta": delta
            }),
        );
    }

    fn push_text_delta(&mut self, delta: &str, output: &mut String) {
        if delta.is_empty() {
            return;
        }
        let index = if let Some(index) = self.message_index {
            index
        } else {
            let index = self.items.len();
            let id = format!("{}_msg", self.response_id);
            self.items.push(StreamItem::Message {
                id: id.clone(),
                text: String::new(),
            });
            self.message_index = Some(index);
            self.emit(
                output,
                "response.output_item.added",
                json!({
                    "type": "response.output_item.added",
                    "output_index": index,
                    "item": { "id": id, "type": "message", "status": "in_progress", "role": "assistant", "content": [] }
                }),
            );
            self.emit(
                output,
                "response.content_part.added",
                json!({
                    "type": "response.content_part.added",
                    "item_id": id,
                    "output_index": index,
                    "content_index": 0,
                    "part": { "type": "output_text", "text": "", "annotations": [] }
                }),
            );
            index
        };
        let id = match &mut self.items[index] {
            StreamItem::Message { id, text } => {
                text.push_str(delta);
                id.clone()
            }
            _ => return,
        };
        self.emit(
            output,
            "response.output_text.delta",
            json!({
                "type": "response.output_text.delta",
                "item_id": id,
                "output_index": index,
                "content_index": 0,
                "delta": delta
            }),
        );
    }

    fn push_tool_delta(
        &mut self,
        tool_index: usize,
        call_id: Option<&str>,
        name: Option<&str>,
        arguments: &str,
        output: &mut String,
    ) {
        let item_index = if let Some(index) = self.tools.get(&tool_index).copied() {
            index
        } else {
            let upstream_name = name.unwrap_or("tool");
            let restored_name = self
                .original_names
                .get(upstream_name)
                .cloned()
                .unwrap_or_else(|| upstream_name.to_string());
            let custom = self.custom_tools.contains(&restored_name);
            let fallback_id = format!("{}_call_{}", self.response_id, tool_index);
            let call_id = call_id.unwrap_or(&fallback_id).to_string();
            let item_index = self.items.len();
            self.items.push(StreamItem::Tool {
                id: call_id.clone(),
                call_id: call_id.clone(),
                name: restored_name.clone(),
                arguments: String::new(),
                custom,
            });
            self.tools.insert(tool_index, item_index);
            self.emit(
                output,
                "response.output_item.added",
                json!({
                    "type": "response.output_item.added",
                    "output_index": item_index,
                    "item": if custom {
                        json!({ "id": call_id, "type": "custom_tool_call", "call_id": call_id, "name": restored_name, "input": "" })
                    } else {
                        json!({ "id": call_id, "type": "function_call", "status": "in_progress", "call_id": call_id, "name": restored_name, "arguments": "" })
                    }
                }),
            );
            item_index
        };

        let (id, custom) = match &mut self.items[item_index] {
            StreamItem::Tool {
                id,
                call_id: stored_call_id,
                name: stored_name,
                arguments: stored_arguments,
                custom,
            } => {
                if let Some(call_id) = call_id.filter(|value| !value.is_empty()) {
                    *stored_call_id = call_id.to_string();
                }
                if let Some(name) = name.filter(|value| !value.is_empty()) {
                    *stored_name = self
                        .original_names
                        .get(name)
                        .cloned()
                        .unwrap_or_else(|| name.to_string());
                }
                stored_arguments.push_str(arguments);
                (id.clone(), *custom)
            }
            _ => return,
        };
        if !custom && !arguments.is_empty() {
            self.emit(
                output,
                "response.function_call_arguments.delta",
                json!({
                    "type": "response.function_call_arguments.delta",
                    "item_id": id,
                    "output_index": item_index,
                    "delta": arguments
                }),
            );
        }
    }

    fn emit(&mut self, output: &mut String, event: &str, mut data: Value) {
        if let Some(object) = data.as_object_mut() {
            object.insert("sequence_number".to_string(), json!(self.sequence));
        }
        self.sequence += 1;
        output.push_str("event: ");
        output.push_str(event);
        output.push('\n');
        output.push_str("data: ");
        output.push_str(&data.to_string());
        output.push_str("\n\n");
    }
}

fn custom_tool_input(arguments: &str) -> String {
    serde_json::from_str::<Value>(arguments)
        .ok()
        .and_then(|value| {
            value
                .get("input")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| arguments.to_string())
}

fn content_to_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| {
                part.as_str().map(str::to_string).or_else(|| {
                    part.get("text")
                        .or_else(|| part.get("content"))
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
            })
            .collect::<Vec<_>>()
            .join(""),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn value_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

fn number(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn chat_usage(usage: &Value) -> GatewayUsage {
    let input_tokens = number(usage, "prompt_tokens").max(number(usage, "input_tokens"));
    let output_tokens = number(usage, "completion_tokens").max(number(usage, "output_tokens"));
    let reasoning_tokens = usage
        .get("completion_tokens_details")
        .map(|details| number(details, "reasoning_tokens"))
        .unwrap_or(0)
        .max(number(usage, "reasoning_tokens"));
    let cached_tokens = usage
        .get("prompt_tokens_details")
        .map(|details| number(details, "cached_tokens"))
        .unwrap_or(0)
        .max(number(usage, "prompt_cache_hit_tokens"))
        .max(number(usage, "cached_tokens"));
    GatewayUsage {
        input_tokens: input_tokens.saturating_sub(cached_tokens),
        output_tokens: output_tokens.saturating_sub(reasoning_tokens),
        reasoning_tokens,
        cached_tokens,
    }
}

fn merge_anthropic_usage(target: &mut GatewayUsage, usage: &Value) {
    target.input_tokens = target.input_tokens.max(number(usage, "input_tokens"));
    target.output_tokens = target.output_tokens.max(number(usage, "output_tokens"));
    target.cached_tokens = target
        .cached_tokens
        .max(number(usage, "cache_read_input_tokens"));
}

fn gemini_usage(usage: &Value) -> GatewayUsage {
    GatewayUsage {
        input_tokens: number(usage, "promptTokenCount"),
        output_tokens: number(usage, "candidatesTokenCount"),
        reasoning_tokens: number(usage, "thoughtsTokenCount"),
        cached_tokens: number(usage, "cachedContentTokenCount"),
    }
}

fn usage_json(usage: &GatewayUsage) -> Value {
    let input_tokens = usage.input_tokens.saturating_add(usage.cached_tokens);
    let output_tokens = usage.output_tokens.saturating_add(usage.reasoning_tokens);
    json!({
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": input_tokens.saturating_add(output_tokens),
        "input_tokens_details": { "cached_tokens": usage.cached_tokens },
        "output_tokens_details": { "reasoning_tokens": usage.reasoning_tokens }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_sse_across_chunks_and_crlf_boundaries() {
        let mut decoder = SseDecoder::default();
        assert!(decoder.push(b"data: {\"a\":").is_empty());
        let frames = decoder.push(b"1}\r\n\r\ndata: [DONE]\n\n");
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].data.as_deref(), Some("{\"a\":1}"));
        assert_eq!(frames[1].data.as_deref(), Some("[DONE]"));
    }

    #[test]
    fn adapts_chat_deltas_before_completion() {
        let mut adapter = ResponsesStreamAdapter::new(
            UpstreamResponseFormat::ChatCompletions,
            &json!({ "stream": true }),
        );
        let first = adapter
            .ingest(r#"{"id":"chat_1","model":"test","choices":[{"delta":{"content":"你"}}]}"#)
            .unwrap();
        assert!(first.contains("event: response.created"));
        assert!(first.contains("event: response.output_text.delta"));
        assert!(first.contains("\"delta\":\"你\""));
        assert!(!first.contains("response.completed"));

        let second = adapter
            .ingest(r#"{"id":"chat_1","choices":[{"delta":{"content":"好"}}]}"#)
            .unwrap();
        assert!(second.contains("\"delta\":\"好\""));
        let done = adapter.ingest("[DONE]").unwrap();
        assert!(done.contains("event: response.completed"));
        assert!(done.contains("\"text\":\"你好\""));
    }

    #[test]
    fn adapts_anthropic_text_and_usage() {
        let mut adapter = ResponsesStreamAdapter::new(
            UpstreamResponseFormat::AnthropicMessages,
            &json!({ "stream": true }),
        );
        adapter
            .ingest(
                r#"{"type":"message_start","message":{"id":"msg_1","model":"claude","usage":{"input_tokens":12}}}"#,
            )
            .unwrap();
        let delta = adapter
            .ingest(
                r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}"#,
            )
            .unwrap();
        assert!(delta.contains("response.output_text.delta"));
        adapter
            .ingest(r#"{"type":"message_delta","usage":{"output_tokens":4}}"#)
            .unwrap();
        let done = adapter.ingest(r#"{"type":"message_stop"}"#).unwrap();
        assert!(done.contains("response.completed"));
        assert!(adapter.is_finished());
        assert_eq!(adapter.usage().input_tokens, 12);
        assert_eq!(adapter.usage().output_tokens, 4);
    }

    #[test]
    fn observes_usage_in_native_completed_event() {
        let event = inspect_responses_stream_data(
            r#"{"type":"response.completed","response":{"usage":{"input_tokens":8,"output_tokens":3,"input_tokens_details":{"cached_tokens":2},"output_tokens_details":{"reasoning_tokens":1}}}}"#,
        );
        assert_eq!(
            event,
            Some(NativeStreamEvent::Completed(GatewayUsage {
                input_tokens: 6,
                output_tokens: 2,
                cached_tokens: 2,
                reasoning_tokens: 1,
            }))
        );
    }

    #[test]
    fn identifies_native_frames_that_can_trigger_a_follow_up_request() {
        assert!(is_terminal_responses_stream_data(
            r#"{"type":"response.completed","response":{"usage":{}}}"#
        ));
        assert!(is_terminal_responses_stream_data(
            r#"{"type":"response.failed","response":{"error":{}}}"#
        ));
        assert!(is_terminal_responses_stream_data("[DONE]"));
        assert!(!is_terminal_responses_stream_data(
            r#"{"type":"response.output_text.delta","delta":"hello"}"#
        ));
    }

    #[test]
    fn restores_namespace_tool_name_in_native_sse_frame() {
        let original_request = json!({
            "tools": [{
                "type": "namespace",
                "name": "mcp__calendar",
                "description": "calendar tools",
                "tools": [{
                    "type": "function",
                    "name": "create_event",
                    "description": "create",
                    "strict": false,
                    "parameters": { "type": "object" }
                }]
            }]
        });
        let flattened = upstream_tool_name("alpha_ns__mcp__calendar__create_event");
        let raw = format!(
            "event: response.output_item.done\ndata: {{\"type\":\"response.output_item.done\",\"item\":{{\"type\":\"function_call\",\"name\":\"{flattened}\",\"call_id\":\"call_1\",\"arguments\":\"{{}}\"}}}}\n\n"
        );
        let mut decoder = SseDecoder::default();
        let frame = decoder.push(raw.as_bytes()).remove(0);

        let restored = String::from_utf8(restore_namespace_tools_in_sse_frame(
            frame,
            &original_request,
        ))
        .unwrap();

        assert!(restored.contains("\"namespace\":\"mcp__calendar\""));
        assert!(restored.contains("\"name\":\"create_event\""));
        assert!(!restored.contains(&flattened));
    }
}
