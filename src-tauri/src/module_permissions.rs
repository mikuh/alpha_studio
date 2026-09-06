use crate::agent_network::RelayConfig;
use serde::Deserialize;
use serde_json::json;
use std::{path::Path, sync::LazyLock, time::Duration};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductModule {
    id: String,
    skill_id: Option<String>,
}
static CATALOG: LazyLock<Vec<ProductModule>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../shared/productModules.json"))
        .expect("valid module catalog")
});

fn required_modules(
    prompt: &str,
    skill_id: Option<&str>,
    instructions: Option<&str>,
) -> Vec<String> {
    CATALOG
        .iter()
        .filter(|item| {
            item.skill_id
                .as_deref()
                .is_some_and(|skill| Some(skill) == skill_id || prompt.contains(skill))
                || (item.id == "coworkers"
                    && (prompt.contains("用户为本次任务召集了以下 AI 同事")
                        || instructions
                            .is_some_and(|text| text.contains("用户为本次任务召集了以下 AI 同事"))))
        })
        .map(|item| item.id.clone())
        .collect()
}

pub async fn authorize_task(
    identity: Option<&RelayConfig>,
    prompt: &str,
    skill_id: Option<&str>,
    instructions: Option<&str>,
) -> Result<Vec<String>, String> {
    let required = required_modules(prompt, skill_id, instructions);
    let Some(identity) = identity else {
        return if required.is_empty() {
            Ok(vec![])
        } else {
            Err("模块功能需要有效的客户授权。".into())
        };
    };
    let result = fetch_grants(identity, &required).await;
    // Base chat can remain available during a temporary network outage, with
    // all protected runtime modules removed. Module tasks must fail closed.
    if required.is_empty() && result.is_err() {
        return Ok(vec![]);
    }
    result
}

async fn fetch_grants(identity: &RelayConfig, required: &[String]) -> Result<Vec<String>, String> {
    let base = reqwest::Url::parse(&identity.api_base_url).map_err(|_| "模块授权服务地址无效")?;
    let local = matches!(base.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if (base.scheme() != "https" && !(base.scheme() == "http" && local))
        || !base.username().is_empty()
        || base.password().is_some()
    {
        return Err("模块授权需要 HTTPS 服务地址。".into());
    }
    let response = reqwest::Client::builder().timeout(Duration::from_secs(15)).redirect(reqwest::redirect::Policy::none()).build()
        .map_err(|e| e.to_string())?
        .post(format!("{}/api/client/modules/authorize", identity.api_base_url.trim_end_matches('/')))
        .bearer_auth(&identity.access_token)
        .json(&json!({"tenantId": identity.tenant_id, "deviceId": identity.device_id, "moduleIds": required}))
        .send().await.map_err(|_| "无法校验模块权限，请连接服务后重试。")?;
    let success = response.status().is_success();
    let body: serde_json::Value = response.json().await.map_err(|_| "模块授权响应无效")?;
    if !success || body["authorized"] != true {
        return Err(body["error"]["message"]
            .as_str()
            .unwrap_or("当前客户无权使用此模块，请联系管理员。")
            .to_string());
    }
    let granted: Vec<String> = serde_json::from_value(body["enabledModules"].clone())
        .map_err(|_| "模块授权响应缺少权限清单")?;
    if required.iter().any(|id| !granted.contains(id)) {
        return Err("当前客户无权使用此模块。".into());
    }
    Ok(granted)
}

pub fn filter_runtime_modules(codex_home: &Path, granted: &[String]) -> Result<(), String> {
    for item in CATALOG.iter().filter(|item| !granted.contains(&item.id)) {
        if let Some(skill) = &item.skill_id {
            crate::remove_existing_path(&codex_home.join("skills").join(skill))?;
        }
    }
    if !granted.iter().any(|id| id == "coworkers") {
        crate::remove_existing_path(&codex_home.join("agents"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detects_protected_skills_and_coworker_orchestration() {
        assert!(required_modules("hello", None, None).is_empty());
        assert_eq!(
            required_modules("使用 $alpha-studio-daily-theme-research", None, None),
            vec!["daily-report"]
        );
        assert_eq!(
            required_modules("", Some("alpha-studio-a-share-factor-mining"), None),
            vec!["factor-mining"]
        );
        assert_eq!(
            required_modules("", None, Some("用户为本次任务召集了以下 AI 同事")),
            vec!["coworkers"]
        );
    }
    #[tokio::test]
    async fn cannot_run_protected_skill_without_customer_identity() {
        assert!(
            authorize_task(None, "", Some("alpha-studio-intraday-monitor"), None)
                .await
                .is_err()
        );
        assert!(authorize_task(None, "hello", None, None)
            .await
            .unwrap()
            .is_empty());
    }
    async fn authorization_server(status: &str, body: serde_json::Value) -> RelayConfig {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let body = body.to_string();
        let response = format!("HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = vec![0; 8192];
            let read = stream.read(&mut request).await.unwrap();
            assert!(read > 0);
            stream.write_all(response.as_bytes()).await.unwrap();
        });
        RelayConfig {
            api_base_url: format!("http://{address}"),
            tenant_id: "tenant".into(),
            device_id: "device".into(),
            access_token: "test-token".into(),
        }
    }

    #[tokio::test]
    async fn uses_live_server_grants_and_rejects_revoked_or_malformed_authorization() {
        let identity = authorization_server(
            "200 OK",
            json!({"authorized":true,"enabledModules":["daily-report"]}),
        )
        .await;
        assert_eq!(
            authorize_task(
                Some(&identity),
                "",
                Some("alpha-studio-daily-theme-research"),
                None
            )
            .await
            .unwrap(),
            vec!["daily-report"]
        );
        let identity =
            authorization_server("403 Forbidden", json!({"error":{"message":"revoked"}})).await;
        assert_eq!(
            authorize_task(
                Some(&identity),
                "",
                Some("alpha-studio-daily-theme-research"),
                None
            )
            .await
            .unwrap_err(),
            "revoked"
        );
        let identity =
            authorization_server("200 OK", json!({"authorized":true,"enabledModules":[]})).await;
        assert!(authorize_task(
            Some(&identity),
            "",
            Some("alpha-studio-daily-theme-research"),
            None
        )
        .await
        .is_err());
    }

    #[test]
    fn removes_only_ungranted_managed_runtime_modules() {
        let root = std::env::temp_dir().join(format!("alpha-modules-{}", uuid::Uuid::new_v4()));
        for name in [
            "alpha-studio-daily-theme-research",
            "alpha-studio-intraday-monitor",
            "personal",
        ] {
            std::fs::create_dir_all(root.join("skills").join(name)).unwrap();
        }
        std::fs::create_dir_all(root.join("agents")).unwrap();
        filter_runtime_modules(&root, &["daily-report".into()]).unwrap();
        assert!(root
            .join("skills/alpha-studio-daily-theme-research")
            .exists());
        assert!(root.join("skills/personal").exists());
        assert!(!root.join("skills/alpha-studio-intraday-monitor").exists());
        assert!(!root.join("agents").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
