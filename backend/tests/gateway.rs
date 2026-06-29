use alpha_studio_backend::gateway::{
    build_upstream_request, mask_secret, normalize_upstream_success_body, responses_body_to_sse,
    ProviderConfig, UpstreamResponseFormat,
};

#[test]
fn builds_openai_responses_url_and_injects_upstream_model() {
    let provider = ProviderConfig {
        provider: "openai".to_string(),
        base_url: "https://api.openai.com/v1/".to_string(),
        endpoint_path: "/responses".to_string(),
        api_key: "sk-test".to_string(),
    };
    let mut body = serde_json::json!({ "model": "alpha-alias", "input": "hello" });
    let request = build_upstream_request(&provider, "gpt-5.5", &mut body).unwrap();

    assert_eq!(request.url, "https://api.openai.com/v1/responses");
    assert_eq!(request.authorization_header, "Bearer sk-test");
    assert_eq!(body["model"], "gpt-5.5");
}

#[test]
fn forces_streaming_responses_requests_to_non_streaming_upstream() {
    let provider = ProviderConfig {
        provider: "openai".to_string(),
        base_url: "https://api.openai.com/v1".to_string(),
        endpoint_path: "/responses".to_string(),
        api_key: "sk-test".to_string(),
    };
    let mut body = serde_json::json!({ "model": "alpha-alias", "stream": true });

    let request = build_upstream_request(&provider, "gpt-5.5", &mut body).unwrap();

    assert!(request.stream_response);
    assert_eq!(body["stream"], false);
    assert_eq!(body["model"], "gpt-5.5");
}

#[test]
fn translates_responses_request_for_chat_completion_endpoint() {
    let provider = ProviderConfig {
        provider: "deepseek".to_string(),
        base_url: "https://api.deepseek.com/v1".to_string(),
        endpoint_path: "/chat/completions".to_string(),
        api_key: "sk-test".to_string(),
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
    assert!(sse.contains("event: response.completed"));
    assert!(sse.contains("data: [DONE]"));
}

#[test]
fn masks_provider_key_without_returning_the_secret() {
    assert_eq!(mask_secret("sk-1234567890abcdef"), "sk-1********cdef");
    assert_eq!(mask_secret("short"), "configured");
}
