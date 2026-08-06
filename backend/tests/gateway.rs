use alpha_studio_backend::gateway::{
    build_model_discovery_request, build_upstream_request, discover_models_from_body, mask_secret,
    normalize_upstream_error_body, normalize_upstream_success_body,
    normalize_upstream_success_body_for_request, responses_body_to_sse, ProviderApiFormat,
    ProviderAuthType, ProviderConfig, UpstreamResponseFormat,
};
use alpha_studio_backend::gateway_stream::{restore_namespace_tools_in_sse_frame, SseDecoder};

#[test]
fn builds_openai_responses_url_and_injects_upstream_model() {
    let provider = ProviderConfig {
        provider: "openai".to_string(),
        base_url: "https://api.openai.com/v1/".to_string(),
        endpoint_path: "/responses".to_string(),
        api_key: "sk-test".to_string(),
        ..ProviderConfig::default()
    };
    let mut body = serde_json::json!({ "model": "alpha-alias", "input": "hello" });
    let request = build_upstream_request(&provider, "gpt-5.5", &mut body).unwrap();

    assert_eq!(request.url, "https://api.openai.com/v1/responses");
    assert!(request
        .headers
        .contains(&("authorization".to_string(), "Bearer sk-test".to_string())));
    assert_eq!(body["model"], "gpt-5.5");
}

#[test]
fn preserves_streaming_responses_requests_for_upstream() {
    let provider = ProviderConfig {
        provider: "openai".to_string(),
        base_url: "https://api.openai.com/v1".to_string(),
        endpoint_path: "/responses".to_string(),
        api_key: "sk-test".to_string(),
        ..ProviderConfig::default()
    };
    let mut body = serde_json::json!({ "model": "alpha-alias", "stream": true });

    let request = build_upstream_request(&provider, "gpt-5.5", &mut body).unwrap();

    assert!(request.stream_response);
    assert_eq!(body["stream"], true);
    assert_eq!(body["model"], "gpt-5.5");
}

#[test]
fn strips_codex_extensions_unsupported_by_volcengine_responses() {
    let provider = ProviderConfig {
        provider: "volcengine-ark-responses".to_string(),
        base_url: "https://ark.cn-beijing.volces.com/api/v3".to_string(),
        endpoint_path: "/responses".to_string(),
        api_key: "test-key".to_string(),
        api_format: ProviderApiFormat::Responses,
        ..ProviderConfig::default()
    };
    let mut body = serde_json::json!({
        "model": "alpha-alias",
        "input": [
            { "type": "message", "role": "user", "content": "hello" },
            {
                "type": "function_call",
                "namespace": "mcp__calendar",
                "name": "create_event",
                "call_id": "call_previous",
                "arguments": "{}"
            }
        ],
        "client_metadata": { "originator": "codex_cli_rs" },
        "reasoning": { "effort": "medium", "summary": "auto" },
        "max_output_tokens": 1_000_000,
        "metadata": { "request": "preserve-standard-field" },
        "tools": [
            {
                "type": "function",
                "name": "exec_command",
                "description": "run",
                "strict": false,
                "defer_loading": false,
                "parameters": { "type": "object" }
            },
            {
                "type": "namespace",
                "name": "mcp__calendar",
                "description": "calendar tools",
                "tools": [{
                    "type": "function",
                    "name": "create_event",
                    "description": "create",
                    "strict": false,
                    "defer_loading": true,
                    "parameters": { "type": "object" }
                }]
            },
            {
                "type": "web_search",
                "external_web_access": true
            }
        ]
    });

    let request = build_upstream_request(&provider, "deepseek-v4-pro-260425", &mut body).unwrap();

    assert!(request.namespace_tool_compat);
    assert!(body.get("client_metadata").is_none());
    assert_eq!(body["reasoning"]["effort"], "medium");
    assert!(body["reasoning"].get("summary").is_none());
    assert_eq!(body["max_output_tokens"], 393_216);
    assert_eq!(body["metadata"]["request"], "preserve-standard-field");
    assert_eq!(body["model"], "deepseek-v4-pro-260425");
    assert_eq!(body["tools"].as_array().unwrap().len(), 3);
    assert!(body["tools"]
        .as_array()
        .unwrap()
        .iter()
        .all(|tool| tool["type"] != "namespace"));
    assert!(body["tools"][0].get("defer_loading").is_none());
    assert!(body["tools"][2].get("external_web_access").is_none());
    let flattened_name = body["tools"][1]["name"].as_str().unwrap();
    assert_ne!(flattened_name, "create_event");
    assert!(flattened_name.starts_with("alpha_ns__"));
    assert_eq!(body["input"][1]["name"], flattened_name);
    assert!(body["input"][1].get("namespace").is_none());
}

#[test]
fn fills_missing_status_for_volcengine_multiturn_output_history() {
    let provider = ProviderConfig {
        provider: "volcengine-ark-responses".to_string(),
        base_url: "https://ark.cn-beijing.volces.com/api/v3".to_string(),
        endpoint_path: "/responses".to_string(),
        api_key: "test-key".to_string(),
        api_format: ProviderApiFormat::Responses,
        ..ProviderConfig::default()
    };
    let mut body = serde_json::json!({
        "model": "alpha-alias",
        "input": [
            { "type": "message", "role": "user", "content": "hi" },
            {
                "type": "reasoning",
                "summary": [{ "type": "summary_text", "text": "Respond to the greeting" }]
            },
            {
                "type": "message",
                "role": "assistant",
                "content": [{ "type": "output_text", "text": "Hello!" }]
            },
            {
                "type": "function_call",
                "call_id": "call_1",
                "name": "lookup",
                "arguments": "{}"
            },
            {
                "type": "function_call_output",
                "call_id": "call_1",
                "output": "done"
            },
            {
                "type": "message",
                "role": "assistant",
                "status": "incomplete",
                "content": [{ "type": "output_text", "text": "Partial" }]
            },
            { "type": "message", "role": "user", "content": "hello" }
        ]
    });

    build_upstream_request(&provider, "deepseek-v4-flash-260425", &mut body).unwrap();

    assert!(body["input"][0].get("status").is_none());
    assert_eq!(body["input"][1]["status"], "completed");
    assert_eq!(body["input"][2]["status"], "completed");
    assert_eq!(body["input"][3]["status"], "completed");
    assert!(body["input"][4].get("status").is_none());
    assert_eq!(body["input"][5]["status"], "incomplete");
    assert!(body["input"][6].get("status").is_none());
}

#[test]
fn restores_volcengine_namespace_calls_in_body_and_stream() {
    let provider = ProviderConfig {
        provider: "volcengine-ark-responses".to_string(),
        base_url: "https://ark.cn-beijing.volces.com/api/v3".to_string(),
        endpoint_path: "/responses".to_string(),
        api_key: "test-key".to_string(),
        api_format: ProviderApiFormat::Responses,
        ..ProviderConfig::default()
    };
    let original = serde_json::json!({
        "model": "alpha-alias",
        "stream": true,
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
    let mut upstream_request_body = original.clone();
    build_upstream_request(
        &provider,
        "deepseek-v4-flash-260425",
        &mut upstream_request_body,
    )
    .unwrap();
    let flattened_name = upstream_request_body["tools"][0]["name"].as_str().unwrap();
    let upstream_response = serde_json::json!({
        "id": "resp_test",
        "output": [{
            "type": "function_call",
            "name": flattened_name,
            "call_id": "call_1",
            "arguments": "{}"
        }]
    });

    let restored = normalize_upstream_success_body_for_request(
        UpstreamResponseFormat::Responses,
        upstream_response,
        &original,
    )
    .unwrap();
    assert_eq!(restored["output"][0]["namespace"], "mcp__calendar");
    assert_eq!(restored["output"][0]["name"], "create_event");

    let event = serde_json::json!({
        "type": "response.output_item.done",
        "item": {
            "type": "function_call",
            "name": flattened_name,
            "call_id": "call_1",
            "arguments": "{}"
        }
    });
    let raw = format!("event: response.output_item.done\ndata: {event}\n\n");
    let mut decoder = SseDecoder::default();
    let frame = decoder.push(raw.as_bytes()).remove(0);
    let restored_stream =
        String::from_utf8(restore_namespace_tools_in_sse_frame(frame, &original)).unwrap();
    assert!(restored_stream.contains("\"namespace\":\"mcp__calendar\""));
    assert!(restored_stream.contains("\"name\":\"create_event\""));
    assert!(!restored_stream.contains(flattened_name));
}

#[test]
fn preserves_reasoning_summary_for_openai_responses() {
    let provider = ProviderConfig {
        provider: "openai".to_string(),
        base_url: "https://api.openai.com/v1".to_string(),
        endpoint_path: "/responses".to_string(),
        api_key: "sk-test".to_string(),
        api_format: ProviderApiFormat::Responses,
        ..ProviderConfig::default()
    };
    let mut body = serde_json::json!({
        "model": "alpha-alias",
        "input": "hello",
        "reasoning": { "effort": "medium", "summary": "auto" }
    });

    build_upstream_request(&provider, "gpt-5.5", &mut body).unwrap();

    assert_eq!(body["reasoning"]["summary"], "auto");
}

#[test]
fn translates_responses_request_for_chat_completion_endpoint() {
    let provider = ProviderConfig {
        provider: "deepseek".to_string(),
        base_url: "https://api.deepseek.com/v1".to_string(),
        endpoint_path: "/chat/completions".to_string(),
        api_key: "sk-test".to_string(),
        ..ProviderConfig::default()
    };
    let mut body = serde_json::json!({
        "model": "alpha-alias",
        "instructions": "system rules",
        "input": [
            { "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "hello" }] }
        ],
        "tools": [
            { "type": "function", "name": "exec_command", "description": "run", "parameters": { "type": "object" } }
        ],
        "max_output_tokens": 123
    });

    let request = build_upstream_request(&provider, "deepseek-chat", &mut body).unwrap();

    assert_eq!(request.url, "https://api.deepseek.com/v1/chat/completions");
    assert_eq!(
        request.response_format,
        UpstreamResponseFormat::ChatCompletions
    );
    assert_eq!(body["model"], "deepseek-chat");
    assert_eq!(body["messages"][0]["role"], "system");
    assert_eq!(body["messages"][0]["content"], "system rules");
    assert_eq!(body["messages"][1]["role"], "user");
    assert_eq!(body["messages"][1]["content"], "hello");
    assert_eq!(body["stream"], false);
    assert_eq!(body["max_tokens"], 123);
    assert_eq!(body["tools"][0]["function"]["name"], "exec_command");
    assert!(body.get("input").is_none());
}

#[test]
fn wraps_chat_completion_success_as_responses_body() {
    let chat = serde_json::json!({
        "id": "chatcmpl_test",
        "created": 1770000000,
        "model": "deepseek-chat",
        "choices": [{
            "message": {
                "role": "assistant",
                "reasoning_content": "先分析问题",
                "content": "hello"
            },
            "finish_reason": "stop"
        }],
        "usage": {
            "prompt_tokens": 11,
            "completion_tokens": 7,
            "total_tokens": 18,
            "completion_tokens_details": { "reasoning_tokens": 3 },
            "prompt_tokens_details": { "cached_tokens": 5 }
        }
    });

    let responses =
        normalize_upstream_success_body(UpstreamResponseFormat::ChatCompletions, chat).unwrap();

    assert_eq!(responses["id"], "chatcmpl_test");
    assert_eq!(responses["object"], "response");
    assert_eq!(responses["status"], "completed");
    assert_eq!(responses["output"][0]["type"], "reasoning");
    assert_eq!(responses["output"][0]["summary"][0]["text"], "先分析问题");
    assert_eq!(responses["output"][1]["type"], "message");
    assert_eq!(responses["output"][1]["content"][0]["text"], "hello");
    assert_eq!(responses["usage"]["input_tokens"], 11);
    assert_eq!(responses["usage"]["output_tokens"], 7);
    assert_eq!(
        responses["usage"]["output_tokens_details"]["reasoning_tokens"],
        3
    );
    assert_eq!(
        responses["usage"]["input_tokens_details"]["cached_tokens"],
        5
    );
}

#[test]
fn remaps_custom_tools_through_chat_and_back_to_native_responses_events() {
    let provider = ProviderConfig {
        provider: "deepseek".to_string(),
        base_url: "https://api.deepseek.com/v1".to_string(),
        endpoint_path: "/chat/completions".to_string(),
        api_key: "sk-test".to_string(),
        api_format: ProviderApiFormat::ChatCompletions,
        ..ProviderConfig::default()
    };
    let original = serde_json::json!({
        "input": "patch the file",
        "tools": [{
            "type": "custom",
            "name": "plugin.apply_patch",
            "description": "Apply a patch",
            "format": { "type": "text" }
        }],
        "stream": true
    });
    let mut upstream_body = original.clone();
    let upstream = build_upstream_request(&provider, "deepseek-chat", &mut upstream_body).unwrap();

    assert_eq!(upstream_body["stream"], true);
    assert_eq!(upstream_body["stream_options"]["include_usage"], true);
    assert_eq!(upstream_body["tools"][0]["type"], "function");
    assert_eq!(
        upstream_body["tools"][0]["function"]["parameters"]["required"][0],
        "input"
    );
    let upstream_name = upstream_body["tools"][0]["function"]["name"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(!upstream_name.contains('.'));

    let chat = serde_json::json!({
        "id": "chat_custom",
        "model": "deepseek-chat",
        "choices": [{
            "message": {
                "role": "assistant",
                "content": null,
                "tool_calls": [{
                    "id": "call_patch",
                    "type": "function",
                    "function": {
                        "name": upstream_name,
                        "arguments": "{\"input\":\"*** Begin Patch\\n*** End Patch\"}"
                    }
                }]
            }
        }]
    });
    let response =
        normalize_upstream_success_body_for_request(upstream.response_format, chat, &original)
            .unwrap();

    assert_eq!(response["output"][0]["type"], "custom_tool_call");
    assert_eq!(response["output"][0]["name"], "plugin.apply_patch");
    assert_eq!(
        response["output"][0]["input"],
        "*** Begin Patch\n*** End Patch"
    );
    assert!(response["output"][0].get("arguments").is_none());

    let sse = responses_body_to_sse(&response);
    assert!(sse.contains("event: response.custom_tool_call_input.delta"));
    assert!(sse.contains("event: response.custom_tool_call_input.done"));
    assert!(sse.contains("\"type\":\"custom_tool_call\""));
}

#[test]
fn serializes_responses_body_as_sse_for_streaming_clients() {
    let responses = serde_json::json!({
        "id": "resp_test",
        "status": "completed",
        "output": [{
            "id": "msg_1",
            "type": "message",
            "role": "assistant",
            "content": [{ "type": "output_text", "text": "你好" }]
        }]
    });

    let sse = responses_body_to_sse(&responses);

    assert!(sse.contains("event: response.created"));
    assert!(sse.contains("event: response.output_text.delta"));
    assert!(sse.contains("\"delta\":\"你好\""));
    assert!(sse.contains("\"sequence_number\":0"));
    assert!(sse.contains("event: response.completed"));
    assert!(sse.contains("data: [DONE]"));
}

#[test]
fn translates_responses_tools_for_anthropic_messages() {
    let provider = ProviderConfig {
        provider: "anthropic".to_string(),
        base_url: "https://api.anthropic.com/v1".to_string(),
        endpoint_path: "/messages".to_string(),
        api_key: "ant-test".to_string(),
        api_format: ProviderApiFormat::AnthropicMessages,
        auth_type: ProviderAuthType::ApiKeyHeader,
        auth_header: "x-api-key".to_string(),
        ..ProviderConfig::default()
    };
    let mut body = serde_json::json!({
        "instructions": "be precise",
        "input": [
            { "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "inspect" }] },
            { "type": "function_call", "call_id": "call_1", "name": "read_file", "arguments": "{\"path\":\"a.rs\"}" },
            { "type": "function_call_output", "call_id": "call_1", "output": "contents" }
        ],
        "tools": [{ "type": "function", "name": "read_file", "parameters": { "type": "object" } }],
        "stream": true
    });

    let request = build_upstream_request(&provider, "claude-sonnet", &mut body).unwrap();

    assert_eq!(
        request.response_format,
        UpstreamResponseFormat::AnthropicMessages
    );
    assert_eq!(request.url, "https://api.anthropic.com/v1/messages");
    assert!(request
        .headers
        .contains(&("x-api-key".to_string(), "ant-test".to_string())));
    assert!(request
        .headers
        .contains(&("anthropic-version".to_string(), "2023-06-01".to_string())));
    assert_eq!(body["system"], "be precise");
    assert_eq!(body["messages"][1]["content"][0]["type"], "tool_use");
    assert_eq!(body["messages"][2]["content"][0]["type"], "tool_result");
    assert_eq!(body["tools"][0]["input_schema"]["type"], "object");
    assert_eq!(body["stream"], true);
}

#[test]
fn wraps_anthropic_text_and_tool_use_as_responses() {
    let body = serde_json::json!({
        "id": "msg_test",
        "model": "claude-sonnet",
        "content": [
            { "type": "thinking", "thinking": "check first" },
            { "type": "text", "text": "I will inspect it." },
            { "type": "tool_use", "id": "toolu_1", "name": "read_file", "input": { "path": "a.rs" } }
        ],
        "usage": { "input_tokens": 21, "output_tokens": 9, "cache_read_input_tokens": 4 }
    });

    let response =
        normalize_upstream_success_body(UpstreamResponseFormat::AnthropicMessages, body).unwrap();

    assert_eq!(response["output"][0]["type"], "reasoning");
    assert_eq!(
        response["output"][1]["content"][0]["text"],
        "I will inspect it."
    );
    assert_eq!(response["output"][2]["type"], "function_call");
    assert_eq!(response["output"][2]["arguments"], "{\"path\":\"a.rs\"}");
    assert_eq!(
        response["usage"]["input_tokens_details"]["cached_tokens"],
        4
    );
}

#[test]
fn translates_responses_for_native_gemini_with_query_auth() {
    let provider = ProviderConfig {
        provider: "google".to_string(),
        base_url: "https://generativelanguage.googleapis.com/v1beta".to_string(),
        endpoint_path: "/models/{model}:generateContent".to_string(),
        api_key: "gem-test".to_string(),
        api_format: ProviderApiFormat::GeminiGenerateContent,
        auth_type: ProviderAuthType::QueryParam,
        auth_header: "key".to_string(),
        ..ProviderConfig::default()
    };
    let mut body = serde_json::json!({
        "instructions": "system",
        "input": [{ "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "hello" }] }],
        "tools": [{ "type": "function", "name": "search", "parameters": { "type": "object" } }],
        "tool_choice": "required",
        "max_output_tokens": 100
    });

    let request = build_upstream_request(&provider, "gemini-2.5-pro", &mut body).unwrap();

    assert_eq!(
        request.response_format,
        UpstreamResponseFormat::GeminiGenerateContent
    );
    assert_eq!(
        request.url,
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent"
    );
    assert!(request
        .query_params
        .contains(&("key".to_string(), "gem-test".to_string())));
    assert_eq!(body["systemInstruction"]["parts"][0]["text"], "system");
    assert_eq!(body["contents"][0]["parts"][0]["text"], "hello");
    assert_eq!(
        body["tools"][0]["functionDeclarations"][0]["name"],
        "search"
    );
    assert_eq!(body["toolConfig"]["functionCallingConfig"]["mode"], "ANY");
    assert_eq!(body["generationConfig"]["maxOutputTokens"], 100);
}

#[test]
fn wraps_gemini_text_thought_and_function_call_as_responses() {
    let body = serde_json::json!({
        "responseId": "gem_test",
        "modelVersion": "gemini-test",
        "candidates": [{
            "content": { "parts": [
                { "text": "consider", "thought": true },
                { "text": "done" },
                { "functionCall": { "id": "call_7", "name": "search", "args": { "q": "rust" } } }
            ] }
        }],
        "usageMetadata": {
            "promptTokenCount": 10,
            "candidatesTokenCount": 8,
            "thoughtsTokenCount": 3,
            "cachedContentTokenCount": 2,
            "totalTokenCount": 18
        }
    });

    let response =
        normalize_upstream_success_body(UpstreamResponseFormat::GeminiGenerateContent, body)
            .unwrap();

    assert_eq!(response["output"][0]["type"], "reasoning");
    assert_eq!(response["output"][1]["content"][0]["text"], "done");
    assert_eq!(response["output"][2]["name"], "search");
    assert_eq!(
        response["usage"]["output_tokens_details"]["reasoning_tokens"],
        3
    );
}

#[test]
fn discovers_openai_anthropic_and_gemini_model_catalog_shapes() {
    let openai = discover_models_from_body(&serde_json::json!({
        "data": [{ "id": "gpt-test" }, { "id": "gpt-test" }]
    }));
    let anthropic = discover_models_from_body(&serde_json::json!({
        "data": [{ "id": "claude-test", "display_name": "Claude Test" }]
    }));
    let gemini = discover_models_from_body(&serde_json::json!({
        "models": [{ "name": "models/gemini-test", "displayName": "Gemini Test" }]
    }));

    assert_eq!(openai.len(), 1);
    assert_eq!(anthropic[0].label, "Claude Test");
    assert_eq!(gemini[0].id, "gemini-test");
    assert_eq!(gemini[0].label, "Gemini Test");
}

#[test]
fn builds_no_auth_local_model_discovery_request() {
    let provider = ProviderConfig {
        provider: "ollama".to_string(),
        base_url: "http://localhost:11434/v1/".to_string(),
        auth_type: ProviderAuthType::None,
        ..ProviderConfig::default()
    };

    let request = build_model_discovery_request(&provider).unwrap();

    assert_eq!(request.url, "http://localhost:11434/v1/models");
    assert!(request.headers.is_empty());
}

#[test]
fn normalizes_non_openai_upstream_errors_for_codex() {
    let error = normalize_upstream_error_body(
        "anthropic",
        429,
        serde_json::json!({ "error": { "type": "rate_limit_error", "message": "slow down" } }),
    );

    assert_eq!(error["error"]["message"], "slow down");
    assert_eq!(error["error"]["type"], "rate_limit_error");
    assert_eq!(error["error"]["provider"], "anthropic");
    assert_eq!(error["error"]["upstream_status"], 429);
}

#[test]
fn masks_provider_key_without_returning_the_secret() {
    assert_eq!(mask_secret("sk-1234567890abcdef"), "sk-1********cdef");
    assert_eq!(mask_secret("short"), "configured");
}
