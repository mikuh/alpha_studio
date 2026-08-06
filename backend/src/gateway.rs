use std::collections::{BTreeMap, BTreeSet};
use std::hash::{DefaultHasher, Hash, Hasher};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

const DEFAULT_REQUEST_TIMEOUT_MS: u64 = 300_000;
const DEFAULT_MAX_RETRIES: u32 = 2;
const VOLCENGINE_RESPONSES_MAX_OUTPUT_TOKENS: u64 = 393_216;

fn default_request_timeout_ms() -> u64 {
    DEFAULT_REQUEST_TIMEOUT_MS
}

fn default_max_retries() -> u32 {
    DEFAULT_MAX_RETRIES
}

fn default_auth_header() -> String {
    "authorization".to_string()
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderApiFormat {
    #[default]
    Auto,
    Responses,
    ChatCompletions,
    AnthropicMessages,
    GeminiGenerateContent,
}

impl ProviderApiFormat {
    pub fn parse(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "responses" | "openai_responses" => Self::Responses,
            "chat" | "chat_completions" | "openai_chat_completions" => Self::ChatCompletions,
            "anthropic" | "anthropic_messages" | "messages" => Self::AnthropicMessages,
            "gemini" | "gemini_generate_content" | "generate_content" => {
                Self::GeminiGenerateContent
            }
            _ => Self::Auto,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Responses => "responses",
            Self::ChatCompletions => "chat_completions",
            Self::AnthropicMessages => "anthropic_messages",
            Self::GeminiGenerateContent => "gemini_generate_content",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderAuthType {
    #[default]
    Bearer,
    ApiKeyHeader,
    QueryParam,
    None,
}

impl ProviderAuthType {
    pub fn parse(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "api_key_header" | "header" | "x_api_key" => Self::ApiKeyHeader,
            "query_param" | "query" => Self::QueryParam,
            "none" | "no_auth" => Self::None,
            _ => Self::Bearer,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Bearer => "bearer",
            Self::ApiKeyHeader => "api_key_header",
            Self::QueryParam => "query_param",
            Self::None => "none",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub provider: String,
    pub base_url: String,
    pub endpoint_path: String,
    pub api_key: String,
    #[serde(default)]
    pub api_format: ProviderApiFormat,
    #[serde(default)]
    pub auth_type: ProviderAuthType,
    #[serde(default = "default_auth_header")]
    pub auth_header: String,
    #[serde(default)]
    pub custom_headers: BTreeMap<String, String>,
    #[serde(default)]
    pub query_params: BTreeMap<String, String>,
    #[serde(default = "default_request_timeout_ms")]
    pub request_timeout_ms: u64,
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            provider: String::new(),
            base_url: String::new(),
            endpoint_path: String::new(),
            api_key: String::new(),
            api_format: ProviderApiFormat::Auto,
            auth_type: ProviderAuthType::Bearer,
            auth_header: default_auth_header(),
            custom_headers: BTreeMap::new(),
            query_params: BTreeMap::new(),
            request_timeout_ms: DEFAULT_REQUEST_TIMEOUT_MS,
            max_retries: DEFAULT_MAX_RETRIES,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpstreamRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub query_params: Vec<(String, String)>,
    pub response_format: UpstreamResponseFormat,
    pub stream_response: bool,
    /// Whether Codex namespace tools were flattened for a strict native
    /// Responses provider and therefore need to be restored in streamed output.
    pub namespace_tool_compat: bool,
    pub request_timeout_ms: u64,
    pub max_retries: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UpstreamResponseFormat {
    Responses,
    ChatCompletions,
    AnthropicMessages,
    GeminiGenerateContent,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredModel {
    pub id: String,
    pub label: String,
}

pub fn build_model_discovery_request(provider: &ProviderConfig) -> Result<UpstreamRequest, String> {
    let api_format = resolve_api_format(provider);
    let mut query_params = provider
        .query_params
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect::<Vec<_>>();
    if provider.auth_type == ProviderAuthType::QueryParam && !provider.api_key.trim().is_empty() {
        query_params.push((
            auth_name(provider, "key"),
            provider.api_key.trim().to_string(),
        ));
    }
    let mut headers = provider_headers(provider)?;
    if api_format == ProviderApiFormat::AnthropicMessages
        && !contains_header(&headers, "anthropic-version")
    {
        headers.push(("anthropic-version".to_string(), "2023-06-01".to_string()));
    }
    Ok(UpstreamRequest {
        url: join_url(&provider.base_url, "/models"),
        headers,
        query_params,
        response_format: UpstreamResponseFormat::Responses,
        stream_response: false,
        namespace_tool_compat: false,
        request_timeout_ms: provider.request_timeout_ms.clamp(1_000, 900_000),
        max_retries: provider.max_retries.min(5),
    })
}

pub fn discover_models_from_body(body: &Value) -> Vec<DiscoveredModel> {
    let values = body
        .get("data")
        .or_else(|| body.get("models"))
        .and_then(Value::as_array)
        .or_else(|| body.as_array());
    let mut models = values
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let raw_id = model
                .get("id")
                .or_else(|| model.get("name"))
                .and_then(Value::as_str)?;
            let id = raw_id.strip_prefix("models/").unwrap_or(raw_id).to_string();
            let raw_label = model
                .get("display_name")
                .or_else(|| model.get("displayName"))
                .or_else(|| model.get("name"))
                .and_then(Value::as_str)
                .unwrap_or(&id);
            let label = raw_label
                .strip_prefix("models/")
                .unwrap_or(raw_label)
                .to_string();
            Some(DiscoveredModel { id, label })
        })
        .collect::<Vec<_>>();
    models.sort_by(|left, right| left.id.cmp(&right.id));
    models.dedup_by(|left, right| left.id == right.id);
    models
}

pub fn build_upstream_request(
    provider: &ProviderConfig,
    upstream_model: &str,
    body: &mut Value,
) -> Result<UpstreamRequest, String> {
    let stream_response = body.get("stream").and_then(Value::as_bool).unwrap_or(false);
    let api_format = resolve_api_format(provider);
    let namespace_tool_compat = matches!(
        api_format,
        ProviderApiFormat::Auto | ProviderApiFormat::Responses
    ) && is_volcengine_ark(provider)
        && request_has_namespace_tools(body);
    let response_format = match api_format {
        ProviderApiFormat::ChatCompletions => {
            *body = build_chat_completion_request(provider, body, upstream_model)?;
            UpstreamResponseFormat::ChatCompletions
        }
        ProviderApiFormat::AnthropicMessages => {
            *body = build_anthropic_request(body, upstream_model)?;
            UpstreamResponseFormat::AnthropicMessages
        }
        ProviderApiFormat::GeminiGenerateContent => {
            *body = build_gemini_request(body)?;
            UpstreamResponseFormat::GeminiGenerateContent
        }
        ProviderApiFormat::Auto | ProviderApiFormat::Responses => {
            // Codex includes this client-only extension in Responses requests.
            // Strict OpenAI-compatible providers such as Volcengine Ark reject
            // unknown top-level fields instead of ignoring them.
            if let Some(object) = body.as_object_mut() {
                object.remove("client_metadata");
            }
            // Ark supports `reasoning.effort`, but its Responses schema does not
            // support OpenAI's `reasoning.summary` request option. Keep this
            // provider-scoped so native OpenAI requests can still ask for a
            // reasoning summary.
            if is_volcengine_ark(provider) {
                if let Some(reasoning) = body.get_mut("reasoning").and_then(Value::as_object_mut) {
                    reasoning.remove("summary");
                }
                normalize_volcengine_responses_request(body);
            }
            body["model"] = Value::String(upstream_model.to_string());
            body["stream"] = Value::Bool(stream_response);
            UpstreamResponseFormat::Responses
        }
    };

    let mut headers = provider_headers(provider)?;
    if api_format == ProviderApiFormat::AnthropicMessages
        && !contains_header(&headers, "anthropic-version")
    {
        headers.push(("anthropic-version".to_string(), "2023-06-01".to_string()));
    }
    let mut query_params = provider
        .query_params
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect::<Vec<_>>();
    if provider.auth_type == ProviderAuthType::QueryParam && !provider.api_key.trim().is_empty() {
        query_params.push((
            auth_name(provider, "key"),
            provider.api_key.trim().to_string(),
        ));
    }

    let mut url = build_endpoint_url(provider, api_format, upstream_model);
    if stream_response && api_format == ProviderApiFormat::GeminiGenerateContent {
        url = url.replace(":generateContent", ":streamGenerateContent");
        if !query_params
            .iter()
            .any(|(name, _)| name.eq_ignore_ascii_case("alt"))
        {
            query_params.push(("alt".to_string(), "sse".to_string()));
        }
    }

    Ok(UpstreamRequest {
        url,
        headers,
        query_params,
        response_format,
        stream_response,
        namespace_tool_compat,
        request_timeout_ms: provider.request_timeout_ms.clamp(1_000, 900_000),
        max_retries: provider.max_retries.min(5),
    })
}

fn is_volcengine_ark(provider: &ProviderConfig) -> bool {
    let provider_id = provider.provider.trim().to_ascii_lowercase();
    provider_id == "volcengine-ark" || provider_id.starts_with("volcengine-ark-")
}

#[derive(Clone, Debug)]
struct NamespaceToolTarget {
    namespace: String,
    name: String,
}

fn request_has_namespace_tools(request: &Value) -> bool {
    request
        .get("tools")
        .and_then(Value::as_array)
        .is_some_and(|tools| {
            tools
                .iter()
                .any(|tool| tool.get("type").and_then(Value::as_str) == Some("namespace"))
        })
}

/// Ark's Responses API supports function tools but not Codex's namespace tool
/// extension. Flatten every namespace child to a unique function name, strip
/// OpenAI-only tool fields, and flatten namespaced calls carried in history.
fn normalize_volcengine_responses_request(body: &mut Value) {
    if body
        .get("max_output_tokens")
        .and_then(Value::as_u64)
        .is_some_and(|value| value > VOLCENGINE_RESPONSES_MAX_OUTPUT_TOKENS)
    {
        body["max_output_tokens"] = json!(VOLCENGINE_RESPONSES_MAX_OUTPUT_TOKENS);
    }
    if let Some(input) = body.get_mut("input").and_then(Value::as_array_mut) {
        for item in input {
            ensure_volcengine_history_item_status(item);
        }
    }
    let (by_upstream, by_original) = namespace_tool_mappings(body);
    if let Some(tools) = body.get_mut("tools").and_then(Value::as_array_mut) {
        let original_tools = std::mem::take(tools);
        let mut normalized = Vec::new();
        for mut tool in original_tools {
            match tool.get("type").and_then(Value::as_str) {
                Some("namespace") => {
                    let Some(namespace) =
                        tool.get("name").and_then(Value::as_str).map(str::to_string)
                    else {
                        continue;
                    };
                    let children = tool
                        .get_mut("tools")
                        .and_then(Value::as_array_mut)
                        .map(std::mem::take)
                        .unwrap_or_default();
                    for mut child in children {
                        let Some(name) = child
                            .get("name")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                        else {
                            continue;
                        };
                        let Some(upstream_name) =
                            by_original.get(&(namespace.clone(), name)).cloned()
                        else {
                            continue;
                        };
                        if let Some(object) = child.as_object_mut() {
                            object.insert("type".to_string(), json!("function"));
                            object.insert("name".to_string(), json!(upstream_name));
                            object.remove("defer_loading");
                        }
                        normalized.push(child);
                    }
                }
                Some("function") => {
                    if let Some(object) = tool.as_object_mut() {
                        object.remove("defer_loading");
                    }
                    normalized.push(tool);
                }
                Some("web_search") => {
                    // Ark's web-search schema does not define OpenAI's client
                    // access toggle. Search itself remains enabled.
                    if let Some(object) = tool.as_object_mut() {
                        object.remove("external_web_access");
                    }
                    normalized.push(tool);
                }
                _ => normalized.push(tool),
            }
        }
        *tools = normalized;
    }

    if by_upstream.is_empty() {
        return;
    }
    if let Some(input) = body.get_mut("input").and_then(Value::as_array_mut) {
        for item in input {
            flatten_namespaced_call(item, &by_original);
        }
    }
    if let Some(tool_choice) = body.get_mut("tool_choice") {
        flatten_namespaced_call(tool_choice, &by_original);
    }
}

/// Codex replays completed output items without `status` on later turns. OpenAI
/// accepts that abbreviated input, while Ark requires the field on output-item
/// variants such as reasoning, assistant messages, and tool calls.
fn ensure_volcengine_history_item_status(item: &mut Value) {
    let Some(object) = item.as_object_mut() else {
        return;
    };
    let requires_status = match object.get("type").and_then(Value::as_str) {
        Some("message") => object.get("role").and_then(Value::as_str) == Some("assistant"),
        Some(
            "reasoning"
            | "function_call"
            | "web_search_call"
            | "image_process"
            | "knowledge_search_call"
            | "doubao_app_call",
        ) => true,
        _ => false,
    };
    if requires_status && object.get("status").map_or(true, Value::is_null) {
        object.insert("status".to_string(), json!("completed"));
    }
}

fn flatten_namespaced_call(value: &mut Value, by_original: &BTreeMap<(String, String), String>) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    let Some(namespace) = object
        .get("namespace")
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        return;
    };
    let Some(name) = object
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        return;
    };
    let Some(upstream_name) = by_original.get(&(namespace, name)).cloned() else {
        return;
    };
    object.insert("name".to_string(), json!(upstream_name));
    object.remove("namespace");
}

fn namespace_tool_mappings(
    request: &Value,
) -> (
    BTreeMap<String, NamespaceToolTarget>,
    BTreeMap<(String, String), String>,
) {
    let Some(tools) = request.get("tools").and_then(Value::as_array) else {
        return (BTreeMap::new(), BTreeMap::new());
    };
    let mut used_names = tools
        .iter()
        .filter(|tool| tool.get("type").and_then(Value::as_str) != Some("namespace"))
        .filter_map(|tool| tool.get("name").and_then(Value::as_str))
        .map(str::to_string)
        .collect::<BTreeSet<_>>();
    let mut by_upstream = BTreeMap::new();
    let mut by_original = BTreeMap::new();

    for tool in tools {
        if tool.get("type").and_then(Value::as_str) != Some("namespace") {
            continue;
        }
        let Some(namespace) = tool.get("name").and_then(Value::as_str) else {
            continue;
        };
        for child in tool
            .get("tools")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(name) = child.get("name").and_then(Value::as_str) else {
                continue;
            };
            let identity = format!("alpha_ns__{namespace}__{name}");
            let mut salt = 0_u32;
            let upstream_name = loop {
                let candidate = if salt == 0 {
                    upstream_tool_name(&identity)
                } else {
                    upstream_tool_name(&format!("{identity}__{salt}"))
                };
                if used_names.insert(candidate.clone()) {
                    break candidate;
                }
                salt += 1;
            };
            let target = NamespaceToolTarget {
                namespace: namespace.to_string(),
                name: name.to_string(),
            };
            by_upstream.insert(upstream_name.clone(), target);
            by_original.insert((namespace.to_string(), name.to_string()), upstream_name);
        }
    }
    (by_upstream, by_original)
}

/// Restore Codex's separate namespace/name representation in a native
/// Responses body or event after Ark returns a flattened function call.
pub(crate) fn restore_namespace_tool_calls_in_value(
    value: &mut Value,
    original_request: &Value,
) -> bool {
    let (by_upstream, _) = namespace_tool_mappings(original_request);
    if by_upstream.is_empty() {
        return false;
    }

    fn visit(value: &mut Value, mappings: &BTreeMap<String, NamespaceToolTarget>) -> bool {
        match value {
            Value::Array(values) => values
                .iter_mut()
                .fold(false, |changed, value| visit(value, mappings) || changed),
            Value::Object(object) => {
                let mut changed = false;
                if object.get("type").and_then(Value::as_str) == Some("function_call") {
                    if let Some(target) = object
                        .get("name")
                        .and_then(Value::as_str)
                        .and_then(|name| mappings.get(name))
                        .cloned()
                    {
                        object.insert("name".to_string(), json!(target.name));
                        object.insert("namespace".to_string(), json!(target.namespace));
                        changed = true;
                    }
                }
                object
                    .values_mut()
                    .fold(changed, |changed, value| visit(value, mappings) || changed)
            }
            _ => false,
        }
    }

    visit(value, &by_upstream)
}

pub fn normalize_upstream_success_body(
    format: UpstreamResponseFormat,
    body: Value,
) -> Result<Value, String> {
    match format {
        UpstreamResponseFormat::Responses => Ok(body),
        UpstreamResponseFormat::ChatCompletions => chat_completion_to_responses(body),
        UpstreamResponseFormat::AnthropicMessages => anthropic_message_to_responses(body),
        UpstreamResponseFormat::GeminiGenerateContent => gemini_response_to_responses(body),
    }
}

pub fn normalize_upstream_success_body_for_request(
    format: UpstreamResponseFormat,
    body: Value,
    original_request: &Value,
) -> Result<Value, String> {
    let response = normalize_upstream_success_body(format, body)?;
    let mut response = restore_custom_tool_calls(response, original_request);
    restore_namespace_tool_calls_in_value(&mut response, original_request);
    Ok(response)
}

pub fn normalize_upstream_error_body(provider: &str, status: u16, body: Value) -> Value {
    let error = body.get("error").unwrap_or(&body);
    let message = error
        .get("message")
        .or_else(|| error.get("detail"))
        .or_else(|| body.get("message"))
        .map(chat_content_to_text)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("{provider} upstream returned HTTP {status}"));
    let error_type = error
        .get("type")
        .or_else(|| error.get("status"))
        .and_then(Value::as_str)
        .unwrap_or("upstream_error");
    let code = error.get("code").cloned().unwrap_or_else(|| json!(status));
    json!({
        "error": {
            "message": message,
            "type": error_type,
            "code": code,
            "provider": provider,
            "upstream_status": status
        }
    })
}

fn restore_custom_tool_calls(mut response: Value, original_request: &Value) -> Value {
    let tools = original_request
        .get("tools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten();
    let mut original_names = BTreeMap::new();
    let mut custom_tools = BTreeSet::new();
    for tool in tools {
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
    if original_names.is_empty() {
        return response;
    }
    if let Some(output) = response.get_mut("output").and_then(Value::as_array_mut) {
        for item in output {
            let Some(returned_name) = item.get("name").and_then(Value::as_str) else {
                continue;
            };
            let Some(original_name) = original_names.get(returned_name).cloned() else {
                continue;
            };
            let is_custom = item.get("type").and_then(Value::as_str) == Some("function_call")
                && custom_tools.contains(&original_name);
            if let Some(object) = item.as_object_mut() {
                object.insert("name".to_string(), json!(original_name));
            }
            if !is_custom {
                continue;
            }
            let arguments = item
                .get("arguments")
                .map(value_to_string)
                .unwrap_or_default();
            let input = custom_tool_input_from_arguments(&arguments);
            if let Some(object) = item.as_object_mut() {
                object.insert("type".to_string(), json!("custom_tool_call"));
                object.insert("input".to_string(), json!(input));
                object.remove("arguments");
                object.remove("status");
            }
        }
    }
    response
}

pub(crate) fn upstream_tool_name(name: &str) -> String {
    let mut normalized = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '_' | '-') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    let changed = normalized != name;
    if normalized.len() > 48 {
        normalized.truncate(48);
    }
    if changed || normalized.len() != name.len() {
        let mut hasher = DefaultHasher::new();
        name.hash(&mut hasher);
        normalized.push('_');
        normalized.push_str(&format!("{:08x}", hasher.finish() as u32));
    }
    if normalized.is_empty() {
        "tool".to_string()
    } else {
        normalized
    }
}

fn custom_tool_input_from_arguments(arguments: &str) -> String {
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
                "custom_tool_call" => {
                    let item_id = response_item_id(item, response_id, index, "custom_call");
                    let call_id = item
                        .get("call_id")
                        .and_then(Value::as_str)
                        .unwrap_or(&item_id);
                    let name = item.get("name").and_then(Value::as_str).unwrap_or("tool");
                    let input = item.get("input").map(value_to_string).unwrap_or_default();
                    push_response_custom_tool_call_events(
                        &mut sse, index, &item_id, call_id, name, &input,
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
    if path.trim().starts_with("http://") || path.trim().starts_with("https://") {
        return path.trim().to_string();
    }
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn path_without_query(path: &str) -> &str {
    path.split_once('?').map(|(path, _)| path).unwrap_or(path)
}

fn is_chat_completions_path(path: &str) -> bool {
    path_without_query(path)
        .trim()
        .trim_end_matches('/')
        .to_ascii_lowercase()
        .ends_with("/chat/completions")
}

fn resolve_api_format(provider: &ProviderConfig) -> ProviderApiFormat {
    if provider.api_format != ProviderApiFormat::Auto {
        return provider.api_format;
    }
    let path = path_without_query(&provider.endpoint_path)
        .trim_end_matches('/')
        .to_ascii_lowercase();
    if is_chat_completions_path(&path) {
        ProviderApiFormat::ChatCompletions
    } else if path.ends_with("/messages") || provider.provider.eq_ignore_ascii_case("anthropic") {
        ProviderApiFormat::AnthropicMessages
    } else if path.contains(":generatecontent")
        || provider.provider.eq_ignore_ascii_case("google")
        || provider.provider.eq_ignore_ascii_case("gemini")
    {
        ProviderApiFormat::GeminiGenerateContent
    } else {
        ProviderApiFormat::Responses
    }
}

fn build_endpoint_url(
    provider: &ProviderConfig,
    format: ProviderApiFormat,
    upstream_model: &str,
) -> String {
    let default_path = match format {
        ProviderApiFormat::ChatCompletions => "/chat/completions",
        ProviderApiFormat::AnthropicMessages => "/messages",
        ProviderApiFormat::GeminiGenerateContent => "/models/{model}:generateContent",
        ProviderApiFormat::Auto | ProviderApiFormat::Responses => "/responses",
    };
    let path = if provider.endpoint_path.trim().is_empty() {
        default_path
    } else {
        provider.endpoint_path.trim()
    };
    join_url(&provider.base_url, &path.replace("{model}", upstream_model))
}

fn auth_name(provider: &ProviderConfig, fallback: &str) -> String {
    let name = provider.auth_header.trim();
    if name.is_empty()
        || (name.eq_ignore_ascii_case("authorization") && fallback != "authorization")
    {
        fallback.to_string()
    } else {
        name.to_string()
    }
}

fn provider_headers(provider: &ProviderConfig) -> Result<Vec<(String, String)>, String> {
    let mut headers = provider
        .custom_headers
        .iter()
        .filter(|(name, _)| !is_forbidden_forward_header(name))
        .map(|(name, value)| (name.trim().to_string(), value.clone()))
        .collect::<Vec<_>>();
    let api_key = provider.api_key.trim();
    match provider.auth_type {
        ProviderAuthType::Bearer if !api_key.is_empty() => headers.push((
            auth_name(provider, "authorization"),
            format!("Bearer {api_key}"),
        )),
        ProviderAuthType::ApiKeyHeader if !api_key.is_empty() => headers.push((
            auth_name(
                provider,
                if resolve_api_format(provider) == ProviderApiFormat::AnthropicMessages {
                    "x-api-key"
                } else {
                    "api-key"
                },
            ),
            api_key.to_string(),
        )),
        ProviderAuthType::QueryParam
        | ProviderAuthType::None
        | ProviderAuthType::Bearer
        | ProviderAuthType::ApiKeyHeader => {}
    }
    for (name, _) in &headers {
        if name.trim().is_empty() {
            return Err("custom header names cannot be empty".to_string());
        }
    }
    Ok(headers)
}

fn contains_header(headers: &[(String, String)], expected: &str) -> bool {
    headers
        .iter()
        .any(|(name, _)| name.eq_ignore_ascii_case(expected))
}

fn is_forbidden_forward_header(name: &str) -> bool {
    matches!(
        name.trim().to_ascii_lowercase().as_str(),
        "host" | "content-length" | "transfer-encoding" | "connection"
    )
}

fn build_chat_completion_request(
    provider: &ProviderConfig,
    request: &Value,
    upstream_model: &str,
) -> Result<Value, String> {
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
    let stream = request
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    body.insert("stream".to_string(), Value::Bool(stream));
    if stream {
        body.insert(
            "stream_options".to_string(),
            json!({ "include_usage": true }),
        );
    }

    if let Some(tools) = request.get("tools").and_then(Value::as_array) {
        let chat_tools = tools
            .iter()
            .filter_map(response_tool_to_chat_tool)
            .collect::<Vec<_>>();
        if !chat_tools.is_empty() {
            body.insert("tools".to_string(), Value::Array(chat_tools));
            if let Some(tool_choice) = request.get("tool_choice") {
                body.insert(
                    "tool_choice".to_string(),
                    response_tool_choice_to_chat_tool_choice(tool_choice),
                );
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

    apply_chat_reasoning_options(provider, request, &mut body);

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
                .map(response_content_to_chat_content)
                .unwrap_or_else(|| json!(""));
            messages.push(json!({ "role": role, "content": content }));
        }
        "function_call" | "custom_tool_call" => {
            let call_id = item
                .get("call_id")
                .or_else(|| item.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("call");
            let name = item.get("name").and_then(Value::as_str).unwrap_or("tool");
            let name = upstream_tool_name(name);
            let arguments = if item.get("type").and_then(Value::as_str) == Some("custom_tool_call")
            {
                json!({
                    "input": item.get("input").map(value_to_string).unwrap_or_default()
                })
                .to_string()
            } else {
                item.get("arguments")
                    .map(value_to_string)
                    .unwrap_or_else(|| "{}".to_string())
            };
            let tool_call = json!({
                "id": call_id,
                "type": "function",
                "function": { "name": name, "arguments": arguments }
            });
            if let Some(tool_calls) = messages
                .last_mut()
                .filter(|message| message.get("role").and_then(Value::as_str) == Some("assistant"))
                .and_then(|message| message.get_mut("tool_calls"))
                .and_then(Value::as_array_mut)
            {
                tool_calls.push(tool_call);
            } else {
                messages.push(json!({
                    "role": "assistant",
                    "content": null,
                    "tool_calls": [tool_call]
                }));
            }
        }
        "function_call_output" | "custom_tool_call_output" => {
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

fn response_content_to_chat_content(content: &Value) -> Value {
    let Some(parts) = content.as_array() else {
        return content.clone();
    };
    let converted = parts
        .iter()
        .filter_map(|part| match part.get("type").and_then(Value::as_str) {
            Some("input_text" | "output_text" | "text") => Some(json!({
                "type": "text",
                "text": part.get("text").and_then(Value::as_str).unwrap_or_default()
            })),
            Some("input_image" | "image_url") => {
                let url = part
                    .get("image_url")
                    .or_else(|| part.get("url"))
                    .and_then(|value| {
                        value
                            .as_str()
                            .or_else(|| value.get("url").and_then(Value::as_str))
                    })?;
                Some(json!({ "type": "image_url", "image_url": { "url": url } }))
            }
            _ => part
                .as_str()
                .map(|text| json!({ "type": "text", "text": text })),
        })
        .collect::<Vec<_>>();
    if converted.len() == 1 && converted[0].get("type").and_then(Value::as_str) == Some("text") {
        return converted[0]
            .get("text")
            .cloned()
            .unwrap_or_else(|| json!(""));
    }
    Value::Array(converted)
}

fn response_tool_choice_to_chat_tool_choice(choice: &Value) -> Value {
    let Some(object) = choice.as_object() else {
        return choice.clone();
    };
    if matches!(
        object.get("type").and_then(Value::as_str),
        Some("function" | "custom")
    ) && object.get("function").is_none()
    {
        if let Some(name) = object.get("name").and_then(Value::as_str) {
            return json!({ "type": "function", "function": { "name": upstream_tool_name(name) } });
        }
    }
    choice.clone()
}

fn apply_chat_reasoning_options(
    provider: &ProviderConfig,
    request: &Value,
    body: &mut Map<String, Value>,
) {
    let Some(reasoning) = request.get("reasoning") else {
        return;
    };
    let effort = reasoning
        .get("effort")
        .and_then(Value::as_str)
        .filter(|value| *value != "none");
    let provider_id = provider.provider.to_ascii_lowercase();
    if provider_id == "openrouter" {
        if let Some(effort) = effort {
            body.insert("reasoning".to_string(), json!({ "effort": effort }));
        }
    } else if matches!(
        provider_id.as_str(),
        "openai" | "azure-openai" | "xai" | "groq"
    ) {
        if let Some(effort) = effort {
            body.insert("reasoning_effort".to_string(), json!(effort));
        }
    }
}

fn response_tool_to_chat_tool(tool: &Value) -> Option<Value> {
    if tool.get("type").and_then(Value::as_str) == Some("custom") {
        let name = tool.get("name").and_then(Value::as_str)?;
        let name = upstream_tool_name(name);
        return Some(json!({
            "type": "function",
            "function": {
                "name": name,
                "description": tool.get("description").cloned().unwrap_or_else(|| json!("Free-form custom tool input.")),
                "parameters": custom_tool_parameters()
            }
        }));
    }
    if tool.get("type").and_then(Value::as_str) != Some("function") {
        return None;
    }
    if tool.get("function").is_some() {
        return Some(tool.clone());
    }
    let name = tool.get("name").and_then(Value::as_str)?;
    let mut function = Map::new();
    function.insert("name".to_string(), json!(upstream_tool_name(name)));
    if let Some(description) = tool.get("description") {
        function.insert("description".to_string(), description.clone());
    }
    if let Some(parameters) = tool.get("parameters") {
        function.insert("parameters".to_string(), parameters.clone());
    }
    Some(json!({ "type": "function", "function": Value::Object(function) }))
}

fn custom_tool_parameters() -> Value {
    json!({
        "type": "object",
        "properties": {
            "input": { "type": "string", "description": "Exact free-form input for the tool." }
        },
        "required": ["input"],
        "additionalProperties": false
    })
}

fn build_anthropic_request(request: &Value, upstream_model: &str) -> Result<Value, String> {
    let mut system_parts = Vec::new();
    if let Some(instructions) = request
        .get("instructions")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        system_parts.push(instructions.to_string());
    }
    let mut messages = Vec::new();
    let mut call_names = BTreeMap::new();
    match request.get("input") {
        Some(Value::String(text)) => push_anthropic_message(
            &mut messages,
            "user",
            vec![json!({ "type": "text", "text": text })],
        ),
        Some(Value::Array(items)) => {
            for item in items {
                match item
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("message")
                {
                    "message" => {
                        let role = item.get("role").and_then(Value::as_str).unwrap_or("user");
                        if matches!(role, "developer" | "system") {
                            let text = item
                                .get("content")
                                .map(chat_content_to_text)
                                .unwrap_or_default();
                            if !text.is_empty() {
                                system_parts.push(text);
                            }
                        } else {
                            let role = if role == "assistant" {
                                "assistant"
                            } else {
                                "user"
                            };
                            let content = item
                                .get("content")
                                .map(response_content_to_anthropic_content)
                                .unwrap_or_default();
                            push_anthropic_message(&mut messages, role, content);
                        }
                    }
                    "function_call" | "custom_tool_call" => {
                        let call_id = item
                            .get("call_id")
                            .or_else(|| item.get("id"))
                            .and_then(Value::as_str)
                            .unwrap_or("call");
                        let name = item.get("name").and_then(Value::as_str).unwrap_or("tool");
                        let name = upstream_tool_name(name);
                        call_names.insert(call_id.to_string(), name.clone());
                        let input = if item.get("type").and_then(Value::as_str)
                            == Some("custom_tool_call")
                        {
                            json!({
                                "input": item.get("input").map(value_to_string).unwrap_or_default()
                            })
                        } else {
                            item.get("arguments")
                                .map(json_object_from_value)
                                .unwrap_or_else(|| json!({}))
                        };
                        push_anthropic_message(
                            &mut messages,
                            "assistant",
                            vec![
                                json!({ "type": "tool_use", "id": call_id, "name": name, "input": input }),
                            ],
                        );
                    }
                    "function_call_output" | "custom_tool_call_output" => {
                        let call_id = item
                            .get("call_id")
                            .or_else(|| item.get("id"))
                            .and_then(Value::as_str)
                            .unwrap_or("call");
                        let output = item.get("output").map(value_to_string).unwrap_or_default();
                        let _ = call_names.get(call_id);
                        push_anthropic_message(
                            &mut messages,
                            "user",
                            vec![
                                json!({ "type": "tool_result", "tool_use_id": call_id, "content": output }),
                            ],
                        );
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
    if messages.is_empty() {
        messages.push(json!({ "role": "user", "content": [{ "type": "text", "text": "" }] }));
    }

    let mut body = Map::new();
    body.insert("model".to_string(), json!(upstream_model));
    body.insert("messages".to_string(), Value::Array(messages));
    body.insert(
        "stream".to_string(),
        Value::Bool(
            request
                .get("stream")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        ),
    );
    body.insert(
        "max_tokens".to_string(),
        request
            .get("max_output_tokens")
            .or_else(|| request.get("max_tokens"))
            .cloned()
            .unwrap_or_else(|| json!(8192)),
    );
    if !system_parts.is_empty() {
        body.insert("system".to_string(), json!(system_parts.join("\n\n")));
    }
    if let Some(tools) = request.get("tools").and_then(Value::as_array) {
        let tools = tools
            .iter()
            .filter_map(response_tool_to_anthropic_tool)
            .collect::<Vec<_>>();
        if !tools.is_empty() {
            body.insert("tools".to_string(), Value::Array(tools));
        }
    }
    if let Some(choice) = request.get("tool_choice") {
        if let Some(choice) = response_tool_choice_to_anthropic_tool_choice(choice) {
            body.insert("tool_choice".to_string(), choice);
        }
    }
    for key in ["temperature", "top_p"] {
        if let Some(value) = request.get(key) {
            body.insert(key.to_string(), value.clone());
        }
    }
    Ok(Value::Object(body))
}

fn response_content_to_anthropic_content(content: &Value) -> Vec<Value> {
    match content {
        Value::String(text) => vec![json!({ "type": "text", "text": text })],
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| match part.get("type").and_then(Value::as_str) {
                Some("input_text" | "output_text" | "text") => Some(json!({
                    "type": "text",
                    "text": part.get("text").and_then(Value::as_str).unwrap_or_default()
                })),
                Some("input_image" | "image_url") => {
                    let url =
                        part.get("image_url")
                            .or_else(|| part.get("url"))
                            .and_then(|value| {
                                value
                                    .as_str()
                                    .or_else(|| value.get("url").and_then(Value::as_str))
                            })?;
                    Some(anthropic_image_block(url))
                }
                _ => None,
            })
            .collect(),
        Value::Null => Vec::new(),
        other => vec![json!({ "type": "text", "text": value_to_string(other) })],
    }
}

fn anthropic_image_block(url: &str) -> Value {
    if let Some(data) = url.strip_prefix("data:") {
        if let Some((metadata, encoded)) = data.split_once(',') {
            let media_type = metadata
                .split(';')
                .next()
                .filter(|value| !value.is_empty())
                .unwrap_or("image/png");
            return json!({
                "type": "image",
                "source": { "type": "base64", "media_type": media_type, "data": encoded }
            });
        }
    }
    json!({ "type": "image", "source": { "type": "url", "url": url } })
}

fn push_anthropic_message(messages: &mut Vec<Value>, role: &str, blocks: Vec<Value>) {
    if blocks.is_empty() {
        return;
    }
    if let Some(content) = messages
        .last_mut()
        .filter(|message| message.get("role").and_then(Value::as_str) == Some(role))
        .and_then(|message| message.get_mut("content"))
        .and_then(Value::as_array_mut)
    {
        content.extend(blocks);
    } else {
        messages.push(json!({ "role": role, "content": blocks }));
    }
}

fn response_tool_to_anthropic_tool(tool: &Value) -> Option<Value> {
    let function = tool.get("function").unwrap_or(tool);
    let name = function.get("name").and_then(Value::as_str)?;
    let name = upstream_tool_name(name);
    Some(json!({
        "name": name,
        "description": function.get("description").cloned().unwrap_or_else(|| json!("")),
        "input_schema": if tool.get("type").and_then(Value::as_str) == Some("custom") {
            custom_tool_parameters()
        } else {
            function
                .get("parameters")
                .cloned()
                .unwrap_or_else(|| json!({ "type": "object", "properties": {} }))
        }
    }))
}

fn response_tool_choice_to_anthropic_tool_choice(choice: &Value) -> Option<Value> {
    match choice.as_str() {
        Some("auto") => Some(json!({ "type": "auto" })),
        Some("required") => Some(json!({ "type": "any" })),
        Some("none") => Some(json!({ "type": "none" })),
        _ => choice
            .get("name")
            .or_else(|| choice.get("function").and_then(|value| value.get("name")))
            .and_then(Value::as_str)
            .map(|name| json!({ "type": "tool", "name": upstream_tool_name(name) })),
    }
}

fn build_gemini_request(request: &Value) -> Result<Value, String> {
    let mut system_parts = Vec::new();
    if let Some(instructions) = request
        .get("instructions")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        system_parts.push(json!({ "text": instructions }));
    }
    let mut contents = Vec::new();
    let mut call_names = BTreeMap::new();
    match request.get("input") {
        Some(Value::String(text)) => {
            push_gemini_content(&mut contents, "user", vec![json!({ "text": text })])
        }
        Some(Value::Array(items)) => {
            for item in items {
                match item
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("message")
                {
                    "message" => {
                        let role = item.get("role").and_then(Value::as_str).unwrap_or("user");
                        let parts = item
                            .get("content")
                            .map(response_content_to_gemini_parts)
                            .unwrap_or_default();
                        if matches!(role, "developer" | "system") {
                            system_parts.extend(parts);
                        } else {
                            push_gemini_content(
                                &mut contents,
                                if role == "assistant" { "model" } else { "user" },
                                parts,
                            );
                        }
                    }
                    "function_call" | "custom_tool_call" => {
                        let call_id = item
                            .get("call_id")
                            .or_else(|| item.get("id"))
                            .and_then(Value::as_str)
                            .unwrap_or("call");
                        let name = item.get("name").and_then(Value::as_str).unwrap_or("tool");
                        let name = upstream_tool_name(name);
                        call_names.insert(call_id.to_string(), name.clone());
                        let args = if item.get("type").and_then(Value::as_str)
                            == Some("custom_tool_call")
                        {
                            json!({
                                "input": item.get("input").map(value_to_string).unwrap_or_default()
                            })
                        } else {
                            item.get("arguments")
                                .map(json_object_from_value)
                                .unwrap_or_else(|| json!({}))
                        };
                        push_gemini_content(
                            &mut contents,
                            "model",
                            vec![json!({
                                "functionCall": {
                                    "id": call_id,
                                    "name": name,
                                    "args": args
                                }
                            })],
                        );
                    }
                    "function_call_output" | "custom_tool_call_output" => {
                        let call_id = item
                            .get("call_id")
                            .or_else(|| item.get("id"))
                            .and_then(Value::as_str)
                            .unwrap_or("call");
                        let name = call_names
                            .get(call_id)
                            .map(String::as_str)
                            .unwrap_or("tool");
                        let output = item
                            .get("output")
                            .map(json_object_from_value)
                            .unwrap_or_else(|| json!({ "output": "" }));
                        push_gemini_content(
                            &mut contents,
                            "user",
                            vec![json!({
                                "functionResponse": { "id": call_id, "name": name, "response": output }
                            })],
                        );
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
    if contents.is_empty() {
        contents.push(json!({ "role": "user", "parts": [{ "text": "" }] }));
    }
    let mut body = Map::new();
    body.insert("contents".to_string(), Value::Array(contents));
    if !system_parts.is_empty() {
        body.insert(
            "systemInstruction".to_string(),
            json!({ "parts": system_parts }),
        );
    }
    if let Some(tools) = request.get("tools").and_then(Value::as_array) {
        let declarations = tools
            .iter()
            .filter_map(response_tool_to_gemini_declaration)
            .collect::<Vec<_>>();
        if !declarations.is_empty() {
            body.insert(
                "tools".to_string(),
                json!([{ "functionDeclarations": declarations }]),
            );
        }
    }
    if let Some(choice) = request.get("tool_choice") {
        if let Some(config) = response_tool_choice_to_gemini_config(choice) {
            body.insert(
                "toolConfig".to_string(),
                json!({ "functionCallingConfig": config }),
            );
        }
    }
    let mut generation = Map::new();
    for (source, target) in [
        ("max_output_tokens", "maxOutputTokens"),
        ("temperature", "temperature"),
        ("top_p", "topP"),
    ] {
        if let Some(value) = request.get(source) {
            generation.insert(target.to_string(), value.clone());
        }
    }
    if !generation.is_empty() {
        body.insert("generationConfig".to_string(), Value::Object(generation));
    }
    Ok(Value::Object(body))
}

fn response_content_to_gemini_parts(content: &Value) -> Vec<Value> {
    match content {
        Value::String(text) => vec![json!({ "text": text })],
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| match part.get("type").and_then(Value::as_str) {
                Some("input_text" | "output_text" | "text") => Some(json!({
                    "text": part.get("text").and_then(Value::as_str).unwrap_or_default()
                })),
                Some("input_image" | "image_url") => {
                    let url =
                        part.get("image_url")
                            .or_else(|| part.get("url"))
                            .and_then(|value| {
                                value
                                    .as_str()
                                    .or_else(|| value.get("url").and_then(Value::as_str))
                            })?;
                    Some(gemini_image_part(url))
                }
                _ => None,
            })
            .collect(),
        Value::Null => Vec::new(),
        other => vec![json!({ "text": value_to_string(other) })],
    }
}

fn gemini_image_part(url: &str) -> Value {
    if let Some(data) = url.strip_prefix("data:") {
        if let Some((metadata, encoded)) = data.split_once(',') {
            let mime_type = metadata
                .split(';')
                .next()
                .filter(|value| !value.is_empty())
                .unwrap_or("image/png");
            return json!({ "inlineData": { "mimeType": mime_type, "data": encoded } });
        }
    }
    json!({ "fileData": { "fileUri": url } })
}

fn push_gemini_content(contents: &mut Vec<Value>, role: &str, parts: Vec<Value>) {
    if parts.is_empty() {
        return;
    }
    if let Some(existing) = contents
        .last_mut()
        .filter(|content| content.get("role").and_then(Value::as_str) == Some(role))
        .and_then(|content| content.get_mut("parts"))
        .and_then(Value::as_array_mut)
    {
        existing.extend(parts);
    } else {
        contents.push(json!({ "role": role, "parts": parts }));
    }
}

fn response_tool_to_gemini_declaration(tool: &Value) -> Option<Value> {
    let function = tool.get("function").unwrap_or(tool);
    let name = function.get("name").and_then(Value::as_str)?;
    let name = upstream_tool_name(name);
    Some(json!({
        "name": name,
        "description": function.get("description").cloned().unwrap_or_else(|| json!("")),
        "parameters": if tool.get("type").and_then(Value::as_str) == Some("custom") {
            custom_tool_parameters()
        } else {
            function
                .get("parameters")
                .cloned()
                .unwrap_or_else(|| json!({ "type": "object", "properties": {} }))
        }
    }))
}

fn response_tool_choice_to_gemini_config(choice: &Value) -> Option<Value> {
    match choice.as_str() {
        Some("auto") => Some(json!({ "mode": "AUTO" })),
        Some("required") => Some(json!({ "mode": "ANY" })),
        Some("none") => Some(json!({ "mode": "NONE" })),
        _ => choice
            .get("name")
            .or_else(|| choice.get("function").and_then(|value| value.get("name")))
            .and_then(Value::as_str)
            .map(
                |name| json!({ "mode": "ANY", "allowedFunctionNames": [upstream_tool_name(name)] }),
            ),
    }
}

fn json_object_from_value(value: &Value) -> Value {
    match value {
        Value::Object(_) => value.clone(),
        Value::String(text) => serde_json::from_str::<Value>(text)
            .ok()
            .filter(Value::is_object)
            .unwrap_or_else(|| json!({ "value": text })),
        Value::Null => json!({}),
        other => json!({ "value": other }),
    }
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
        .or_else(|| message.get("reasoning_details"))
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
    } else if let Some(call) = message.get("function_call") {
        let call_id = call
            .get("id")
            .or_else(|| call.get("call_id"))
            .and_then(Value::as_str)
            .unwrap_or("call_legacy");
        output.push(json!({
            "id": call_id,
            "type": "function_call",
            "status": "completed",
            "call_id": call_id,
            "name": call.get("name").and_then(Value::as_str).unwrap_or("tool"),
            "arguments": call.get("arguments").map(value_to_string).unwrap_or_else(|| "{}".to_string())
        }));
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

fn anthropic_message_to_responses(body: Value) -> Result<Value, String> {
    let content = body
        .get("content")
        .and_then(Value::as_array)
        .ok_or_else(|| "Anthropic response is missing content.".to_string())?;
    let response_id = body
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("resp_alpha_studio_anthropic");
    let mut output = Vec::new();
    let mut text_parts = Vec::new();
    let mut reasoning_parts = Vec::new();
    for (index, part) in content.iter().enumerate() {
        match part.get("type").and_then(Value::as_str).unwrap_or_default() {
            "text" => {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    text_parts
                        .push(json!({ "type": "output_text", "text": text, "annotations": [] }));
                }
            }
            "thinking" => {
                if let Some(text) = part.get("thinking").and_then(Value::as_str) {
                    reasoning_parts.push(json!({ "type": "summary_text", "text": text }));
                }
            }
            "tool_use" => {
                let call_id = part
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("{response_id}_call_{index}"));
                output.push(json!({
                    "id": call_id,
                    "type": "function_call",
                    "status": "completed",
                    "call_id": call_id,
                    "name": part.get("name").and_then(Value::as_str).unwrap_or("tool"),
                    "arguments": part.get("input").map(value_to_string).unwrap_or_else(|| "{}".to_string())
                }));
            }
            _ => {}
        }
    }
    let has_reasoning = !reasoning_parts.is_empty();
    if has_reasoning {
        output.insert(
            0,
            json!({
                "id": format!("{response_id}_reasoning"),
                "type": "reasoning",
                "summary": reasoning_parts
            }),
        );
    }
    if !text_parts.is_empty() {
        let insertion = usize::from(has_reasoning);
        output.insert(
            insertion,
            json!({
                "id": format!("{response_id}_msg"),
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": text_parts
            }),
        );
    }
    let usage = body.get("usage").unwrap_or(&Value::Null);
    let input_tokens = number(usage, "input_tokens").unwrap_or(0);
    let output_tokens = number(usage, "output_tokens").unwrap_or(0);
    let cached_tokens = number(usage, "cache_read_input_tokens").unwrap_or(0);
    Ok(json!({
        "id": response_id,
        "object": "response",
        "created_at": 0,
        "model": body.get("model").cloned().unwrap_or(Value::Null),
        "status": "completed",
        "output": output,
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
            "input_tokens_details": { "cached_tokens": cached_tokens },
            "output_tokens_details": { "reasoning_tokens": 0 }
        }
    }))
}

fn gemini_response_to_responses(body: Value) -> Result<Value, String> {
    let candidate = body
        .get("candidates")
        .and_then(Value::as_array)
        .and_then(|candidates| candidates.first())
        .ok_or_else(|| {
            body.get("promptFeedback")
                .map(|feedback| format!("Gemini returned no candidate: {feedback}"))
                .unwrap_or_else(|| "Gemini response is missing candidates[0].".to_string())
        })?;
    let parts = candidate
        .get("content")
        .and_then(|content| content.get("parts"))
        .and_then(Value::as_array)
        .ok_or_else(|| "Gemini response is missing candidates[0].content.parts.".to_string())?;
    let response_id = body
        .get("responseId")
        .and_then(Value::as_str)
        .unwrap_or("resp_alpha_studio_gemini");
    let mut output = Vec::new();
    let mut text_parts = Vec::new();
    let mut reasoning_parts = Vec::new();
    for (index, part) in parts.iter().enumerate() {
        if let Some(text) = part.get("text").and_then(Value::as_str) {
            if part
                .get("thought")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                reasoning_parts.push(json!({ "type": "summary_text", "text": text }));
            } else {
                text_parts.push(json!({ "type": "output_text", "text": text, "annotations": [] }));
            }
        }
        if let Some(call) = part.get("functionCall") {
            let call_id = call
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| format!("{response_id}_call_{index}"));
            output.push(json!({
                "id": call_id,
                "type": "function_call",
                "status": "completed",
                "call_id": call_id,
                "name": call.get("name").and_then(Value::as_str).unwrap_or("tool"),
                "arguments": call.get("args").map(value_to_string).unwrap_or_else(|| "{}".to_string())
            }));
        }
    }
    let has_reasoning = !reasoning_parts.is_empty();
    if has_reasoning {
        output.insert(
            0,
            json!({
                "id": format!("{response_id}_reasoning"),
                "type": "reasoning",
                "summary": reasoning_parts
            }),
        );
    }
    if !text_parts.is_empty() {
        let insertion = usize::from(has_reasoning);
        output.insert(
            insertion,
            json!({
                "id": format!("{response_id}_msg"),
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": text_parts
            }),
        );
    }
    let usage = body.get("usageMetadata").unwrap_or(&Value::Null);
    let input_tokens = number(usage, "promptTokenCount").unwrap_or(0);
    let output_tokens = number(usage, "candidatesTokenCount").unwrap_or(0);
    let reasoning_tokens = number(usage, "thoughtsTokenCount").unwrap_or(0);
    let cached_tokens = number(usage, "cachedContentTokenCount").unwrap_or(0);
    Ok(json!({
        "id": response_id,
        "object": "response",
        "created_at": 0,
        "model": body.get("modelVersion").cloned().unwrap_or(Value::Null),
        "status": "completed",
        "output": output,
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": number(usage, "totalTokenCount").unwrap_or(input_tokens + output_tokens),
            "input_tokens_details": { "cached_tokens": cached_tokens },
            "output_tokens_details": { "reasoning_tokens": reasoning_tokens }
        }
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

fn push_response_custom_tool_call_events(
    sse: &mut String,
    output_index: usize,
    item_id: &str,
    call_id: &str,
    name: &str,
    input: &str,
) {
    push_sse_event(
        sse,
        "response.output_item.added",
        &json!({
            "type": "response.output_item.added",
            "output_index": output_index,
            "item": { "id": item_id, "type": "custom_tool_call", "call_id": call_id, "name": name, "input": "" }
        }),
    );
    if !input.is_empty() {
        push_sse_event(
            sse,
            "response.custom_tool_call_input.delta",
            &json!({
                "type": "response.custom_tool_call_input.delta",
                "item_id": item_id,
                "output_index": output_index,
                "delta": input
            }),
        );
    }
    push_sse_event(
        sse,
        "response.custom_tool_call_input.done",
        &json!({
            "type": "response.custom_tool_call_input.done",
            "item_id": item_id,
            "output_index": output_index,
            "input": input
        }),
    );
    push_sse_event(
        sse,
        "response.output_item.done",
        &json!({
            "type": "response.output_item.done",
            "output_index": output_index,
            "item": { "id": item_id, "type": "custom_tool_call", "call_id": call_id, "name": name, "input": input }
        }),
    );
}

fn push_sse_event(buffer: &mut String, event: &str, data: &Value) {
    let mut payload = data.clone();
    if let Some(object) = payload.as_object_mut() {
        object
            .entry("sequence_number".to_string())
            .or_insert_with(|| json!(buffer.match_indices("event: ").count()));
    }
    buffer.push_str("event: ");
    buffer.push_str(event);
    buffer.push('\n');
    buffer.push_str("data: ");
    buffer.push_str(&payload.to_string());
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
