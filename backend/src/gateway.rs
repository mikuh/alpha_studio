use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub provider: String,
    pub base_url: String,
    pub endpoint_path: String,
    pub api_key: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpstreamRequest {
    pub url: String,
    pub authorization_header: String,
    pub response_format: UpstreamResponseFormat,
    pub stream_response: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UpstreamResponseFormat {
    Responses,
    ChatCompletions,
}

pub fn build_upstream_request(
    provider: &ProviderConfig,
    upstream_model: &str,
    body: &mut Value,
) -> Result<UpstreamRequest, String> {
    let stream_response = body.get("stream").and_then(Value::as_bool).unwrap_or(false);

    let response_format = if is_chat_completions_path(&provider.endpoint_path) {
        *body = build_chat_completion_request(body, upstream_model)?;
        UpstreamResponseFormat::ChatCompletions
    } else {
        body["model"] = Value::String(upstream_model.to_string());
        if stream_response {
            body["stream"] = Value::Bool(false);
        }
        UpstreamResponseFormat::Responses
    };
    Ok(UpstreamRequest {
        url: join_url(&provider.base_url, &provider.endpoint_path),
        authorization_header: format!("Bearer {}", provider.api_key),
        response_format,
        stream_response,
    })
}

pub fn normalize_upstream_success_body(
    format: UpstreamResponseFormat,
    body: Value,
) -> Result<Value, String> {
    match format {
        UpstreamResponseFormat::Responses => Ok(body),
        UpstreamResponseFormat::ChatCompletions => chat_completion_to_responses(body),
    }
}

pub fn responses_body_to_sse(response: &Value) -> String {
    let response_id = response
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("resp_alpha_studio_gateway");
    let mut sse = String::new();
    push_sse_event(
        &mut sse,
        "response.created",
        &json!({
            "type": "response.created",
            "response": { "id": response_id, "status": "in_progress", "output": [] }
        }),
    );

    let mut emitted = false;
    let mut completed_output = Vec::new();
    if let Some(output) = response.get("output").and_then(Value::as_array) {
        for (index, item) in output.iter().enumerate() {
            match item.get("type").and_then(Value::as_str).unwrap_or_default() {
                "reasoning" => {
                    let item_id = response_item_id(item, response_id, index, "reasoning");
                    let text = item
                        .get("summary")
                        .map(chat_content_to_text)
                        .unwrap_or_default();
                    if !text.is_empty() {
                        push_response_reasoning_events(&mut sse, index, &item_id, &text);
                        completed_output.push(item.clone());
                        emitted = true;
                    }
                }
                "message" => {
                    let item_id = response_item_id(item, response_id, index, "msg");
                    let text = item
                        .get("content")
                        .map(chat_content_to_text)
                        .unwrap_or_default();
                    if !text.is_empty() {
                        push_response_text_events(&mut sse, index, &item_id, &text);
                        completed_output.push(item.clone());
                        emitted = true;
                    }
                }
                "function_call" => {
                    let item_id = response_item_id(item, response_id, index, "call");
                    let call_id = item
                        .get("call_id")
                        .and_then(Value::as_str)
                        .unwrap_or(&item_id);
                    let name = item.get("name").and_then(Value::as_str).unwrap_or("tool");
                    let arguments = item
                        .get("arguments")
                        .map(value_to_string)
                        .unwrap_or_else(|| "{}".to_string());
                    push_response_function_call_events(
                        &mut sse, index, &item_id, call_id, name, &arguments,
                    );
                    completed_output.push(item.clone());
                    emitted = true;
                }
                _ => {}
            }
        }
    }

    if !emitted {
        let item_id = format!("{response_id}_msg");
        let text = "（模型返回了空内容）";
        push_response_text_events(&mut sse, 0, &item_id, text);
        completed_output.push(json!({
            "id": item_id,
            "type": "message",
            "role": "assistant",
            "content": [{ "type": "output_text", "text": text }]
        }));
    }

    push_sse_event(
        &mut sse,
        "response.completed",
        &json!({
            "type": "response.completed",
            "response": {
                "id": response_id,
                "status": "completed",
                "output": completed_output,
                "usage": response.get("usage").cloned().unwrap_or(Value::Null)
            }
        }),
    );
    sse.push_str("data: [DONE]\n\n");
    sse
}

pub fn mask_secret(value: &str) -> String {
    let value = value.trim();
    if value.len() < 12 {
        return "configured".to_string();
    }
    format!("{}********{}", &value[..4], &value[value.len() - 4..])
}

fn response_item_id(item: &Value, response_id: &str, index: usize, suffix: &str) -> String {
    item.get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("{response_id}_{suffix}_{index}"))
}

fn join_url(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn is_chat_completions_path(path: &str) -> bool {
    path.trim()
        .trim_end_matches('/')
        .to_ascii_lowercase()
        .ends_with("/chat/completions")
}

fn build_chat_completion_request(request: &Value, upstream_model: &str) -> Result<Value, String> {
    let mut messages = Vec::new();
    if let Some(instructions) = request
        .get("instructions")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        messages.push(json!({ "role": "system", "content": instructions }));
    }

    match request.get("input") {
        Some(Value::String(text)) => {
            messages.push(json!({ "role": "user", "content": text }));
        }
        Some(Value::Array(items)) => {
            for item in items {
                append_response_input_as_chat_message(&mut messages, item);
            }
        }
        Some(_) | None => {}
    }

    if messages.is_empty() {
        messages.push(json!({ "role": "user", "content": "" }));
    }

    let mut body = Map::new();
    body.insert("model".to_string(), json!(upstream_model));
    body.insert("messages".to_string(), Value::Array(messages));
    body.insert("stream".to_string(), Value::Bool(false));

    if let Some(tools) = request.get("tools").and_then(Value::as_array) {
        let chat_tools = tools
            .iter()
            .filter_map(response_tool_to_chat_tool)
            .collect::<Vec<_>>();
        if !chat_tools.is_empty() {
            body.insert("tools".to_string(), Value::Array(chat_tools));
            if let Some(tool_choice) = request.get("tool_choice") {
                body.insert("tool_choice".to_string(), tool_choice.clone());
            }
        }
    }

    for key in ["temperature", "top_p", "parallel_tool_calls"] {
        if let Some(value) = request.get(key) {
            body.insert(key.to_string(), value.clone());
        }
    }
    if let Some(max_tokens) = request
        .get("max_output_tokens")
        .or_else(|| request.get("max_tokens"))
    {
        body.insert("max_tokens".to_string(), max_tokens.clone());
    }

    Ok(Value::Object(body))
}

fn append_response_input_as_chat_message(messages: &mut Vec<Value>, item: &Value) {
    match item
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("message")
    {
        "message" => {
            let role = match item.get("role").and_then(Value::as_str).unwrap_or("user") {
                "developer" | "system" => "system",
                "assistant" => "assistant",
                "tool" => "tool",
                _ => "user",
            };
            let content = item
                .get("content")
                .map(chat_content_to_text)
                .unwrap_or_default();
            messages.push(json!({ "role": role, "content": content }));
        }
        "function_call" => {
            let call_id = item
                .get("call_id")
                .or_else(|| item.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("call");
            let name = item.get("name").and_then(Value::as_str).unwrap_or("tool");
            let arguments = item
                .get("arguments")
                .map(value_to_string)
                .unwrap_or_else(|| "{}".to_string());
            messages.push(json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [{
                    "id": call_id,
                    "type": "function",
                    "function": { "name": name, "arguments": arguments }
                }]
            }));
        }
        "function_call_output" => {
            let call_id = item
                .get("call_id")
                .or_else(|| item.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("call");
            let output = item.get("output").map(value_to_string).unwrap_or_default();
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": output
            }));
        }
        _ => {}
    }
}

fn response_tool_to_chat_tool(tool: &Value) -> Option<Value> {
    if tool.get("type").and_then(Value::as_str) != Some("function") {
        return None;
    }
    if tool.get("function").is_some() {
        return Some(tool.clone());
    }
    let name = tool.get("name").and_then(Value::as_str)?;
    let mut function = Map::new();
    function.insert("name".to_string(), json!(name));
    if let Some(description) = tool.get("description") {
        function.insert("description".to_string(), description.clone());
    }
    if let Some(parameters) = tool.get("parameters") {
        function.insert("parameters".to_string(), parameters.clone());
    }
    Some(json!({ "type": "function", "function": Value::Object(function) }))
}

fn chat_completion_to_responses(body: Value) -> Result<Value, String> {
    let message = body
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .ok_or_else(|| "Chat completion response is missing choices[0].message.".to_string())?;
    let response_id = body
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("resp_alpha_studio_gateway");
    let model = body.get("model").cloned().unwrap_or(Value::Null);
    let created_at = body.get("created").cloned().unwrap_or_else(|| json!(0));
    let mut output = Vec::new();

    let reasoning_content = message
        .get("reasoning_content")
        .or_else(|| message.get("reasoning"))
        .map(chat_content_to_text)
        .unwrap_or_default();
    if !reasoning_content.is_empty() {
        output.push(json!({
            "id": format!("{response_id}_reasoning"),
            "type": "reasoning",
            "summary": [{ "type": "summary_text", "text": reasoning_content }]
        }));
    }

    let content = message
        .get("content")
        .map(chat_content_to_text)
        .unwrap_or_default();
    if !content.is_empty() {
        output.push(json!({
            "id": format!("{response_id}_msg"),
            "type": "message",
            "status": "completed",
            "role": "assistant",
            "content": [{ "type": "output_text", "text": content, "annotations": [] }]
        }));
    }

    if let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) {
        for (index, call) in tool_calls.iter().enumerate() {
            let call_id = call
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| format!("{response_id}_call_{index}"));
            let name = call
                .get("function")
                .and_then(|function| function.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("tool");
            let arguments = call
                .get("function")
                .and_then(|function| function.get("arguments"))
                .map(value_to_string)
                .unwrap_or_else(|| "{}".to_string());
            output.push(json!({
                "id": call_id,
                "type": "function_call",
                "status": "completed",
                "call_id": call_id,
                "name": name,
                "arguments": arguments
            }));
        }
    }

    Ok(json!({
        "id": response_id,
        "object": "response",
        "created_at": created_at,
        "model": model,
        "status": "completed",
        "output": output,
        "usage": chat_usage_to_responses_usage(body.get("usage").unwrap_or(&Value::Null))
    }))
}

fn chat_usage_to_responses_usage(usage: &Value) -> Value {
    let input_tokens = number(usage, "prompt_tokens")
        .or_else(|| number(usage, "input_tokens"))
        .unwrap_or(0);
    let output_tokens = number(usage, "completion_tokens")
        .or_else(|| number(usage, "output_tokens"))
        .unwrap_or(0);
    let total_tokens = number(usage, "total_tokens").unwrap_or(input_tokens + output_tokens);
    let reasoning_tokens = usage
        .get("completion_tokens_details")
        .and_then(|details| number(details, "reasoning_tokens"))
        .or_else(|| number(usage, "reasoning_tokens"))
        .unwrap_or(0);
    let cached_tokens = usage
        .get("prompt_tokens_details")
        .and_then(|details| number(details, "cached_tokens"))
        .or_else(|| number(usage, "prompt_cache_hit_tokens"))
        .or_else(|| number(usage, "cached_tokens"))
        .unwrap_or(0);
    json!({
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "output_tokens_details": { "reasoning_tokens": reasoning_tokens },
        "input_tokens_details": { "cached_tokens": cached_tokens }
    })
}

fn push_response_reasoning_events(
    sse: &mut String,
    output_index: usize,
    item_id: &str,
    text: &str,
) {
    push_sse_event(
        sse,
        "response.output_item.added",
        &json!({
            "type": "response.output_item.added",
            "output_index": output_index,
            "item": { "id": item_id, "type": "reasoning", "summary": [] }
        }),
    );
    push_sse_event(
        sse,
        "response.reasoning_summary_part.added",
        &json!({
            "type": "response.reasoning_summary_part.added",
            "item_id": item_id,
            "output_index": output_index,
            "summary_index": 0,
            "part": { "type": "summary_text", "text": "" }
        }),
    );
    push_sse_event(
        sse,
        "response.reasoning_summary_text.delta",
        &json!({
            "type": "response.reasoning_summary_text.delta",
            "item_id": item_id,
            "output_index": output_index,
            "summary_index": 0,
            "delta": text
        }),
    );
    push_sse_event(
        sse,
        "response.reasoning_summary_text.done",
        &json!({
            "type": "response.reasoning_summary_text.done",
            "item_id": item_id,
            "output_index": output_index,
            "summary_index": 0,
            "text": text
        }),
    );
    push_sse_event(
        sse,
        "response.reasoning_summary_part.done",
        &json!({
            "type": "response.reasoning_summary_part.done",
            "item_id": item_id,
            "output_index": output_index,
            "summary_index": 0,
            "part": { "type": "summary_text", "text": text }
        }),
    );
    push_sse_event(
        sse,
        "response.output_item.done",
        &json!({
            "type": "response.output_item.done",
            "output_index": output_index,
            "item": {
                "id": item_id,
                "type": "reasoning",
                "summary": [{ "type": "summary_text", "text": text }]
            }
        }),
    );
}

fn push_response_text_events(sse: &mut String, output_index: usize, item_id: &str, text: &str) {
    push_sse_event(
        sse,
        "response.output_item.added",
        &json!({
            "type": "response.output_item.added",
            "output_index": output_index,
            "item": { "id": item_id, "type": "message", "role": "assistant", "content": [] }
        }),
    );
    push_sse_event(
        sse,
        "response.content_part.added",
        &json!({
            "type": "response.content_part.added",
            "item_id": item_id,
            "output_index": output_index,
            "content_index": 0,
            "part": { "type": "output_text", "text": "" }
        }),
    );
    push_sse_event(
        sse,
        "response.output_text.delta",
        &json!({
            "type": "response.output_text.delta",
            "item_id": item_id,
            "output_index": output_index,
            "content_index": 0,
            "delta": text
        }),
    );
    push_sse_event(
        sse,
        "response.output_text.done",
        &json!({
            "type": "response.output_text.done",
            "item_id": item_id,
            "output_index": output_index,
            "content_index": 0,
            "text": text
        }),
    );
    push_sse_event(
        sse,
        "response.content_part.done",
        &json!({
            "type": "response.content_part.done",
            "item_id": item_id,
            "output_index": output_index,
            "content_index": 0,
            "part": { "type": "output_text", "text": text }
        }),
    );
    push_sse_event(
        sse,
        "response.output_item.done",
        &json!({
            "type": "response.output_item.done",
            "output_index": output_index,
            "item": {
                "id": item_id,
                "type": "message",
                "role": "assistant",
                "content": [{ "type": "output_text", "text": text }]
            }
        }),
    );
}

fn push_response_function_call_events(
    sse: &mut String,
    output_index: usize,
    item_id: &str,
    call_id: &str,
    name: &str,
    arguments: &str,
) {
    push_sse_event(
        sse,
        "response.output_item.added",
        &json!({
            "type": "response.output_item.added",
            "output_index": output_index,
            "item": { "id": item_id, "type": "function_call", "call_id": call_id, "name": name, "arguments": "" }
        }),
    );
    if !arguments.is_empty() {
        push_sse_event(
            sse,
            "response.function_call_arguments.delta",
            &json!({
                "type": "response.function_call_arguments.delta",
                "item_id": item_id,
                "output_index": output_index,
                "delta": arguments
            }),
        );
    }
    push_sse_event(
        sse,
        "response.function_call_arguments.done",
        &json!({
            "type": "response.function_call_arguments.done",
            "item_id": item_id,
            "output_index": output_index,
            "arguments": arguments
        }),
    );
    push_sse_event(
        sse,
        "response.output_item.done",
        &json!({
            "type": "response.output_item.done",
            "output_index": output_index,
            "item": { "id": item_id, "type": "function_call", "call_id": call_id, "name": name, "arguments": arguments }
        }),
    );
}

fn push_sse_event(buffer: &mut String, event: &str, data: &Value) {
    buffer.push_str("event: ");
    buffer.push_str(event);
    buffer.push_str("\n");
    buffer.push_str("data: ");
    buffer.push_str(&data.to_string());
    buffer.push_str("\n\n");
}

fn chat_content_to_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| {
                if let Some(text) = part.as_str() {
                    return Some(text.to_string());
                }
                part.get("text")
                    .or_else(|| part.get("content"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Null => String::new(),
        other => value_to_string(other),
    }
}

fn value_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

fn number(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(Value::as_u64)
}
