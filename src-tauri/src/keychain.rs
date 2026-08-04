use keyring::{Entry, Error};

const SERVICE: &str = "com.alpha-studio.desktop";
pub const JQDATA_PASSWORD_ACCOUNT: &str = "jqdata-password";

pub fn model_provider_account(profile_id: &str) -> String {
    format!("model-provider:{}", profile_id.trim())
}

pub async fn set_secret(
    account: impl Into<String>,
    secret: impl Into<String>,
) -> Result<(), String> {
    let account = account.into();
    let secret = secret.into();
    tokio::task::spawn_blocking(move || {
        let entry = Entry::new(SERVICE, &account)
            .map_err(|error| format!("系统凭据存储不可用：{error}"))?;
        entry
            .set_password(&secret)
            .map_err(|error| format!("无法写入系统凭据存储：{error}"))
    })
    .await
    .map_err(|error| format!("系统凭据存储任务失败：{error}"))?
}

pub async fn get_secret(account: impl Into<String>) -> Result<Option<String>, String> {
    let account = account.into();
    tokio::task::spawn_blocking(move || {
        let entry = Entry::new(SERVICE, &account)
            .map_err(|error| format!("系统凭据存储不可用：{error}"))?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(Error::NoEntry) => Ok(None),
            Err(error) => Err(format!("无法读取系统凭据存储：{error}")),
        }
    })
    .await
    .map_err(|error| format!("系统凭据存储任务失败：{error}"))?
}

pub async fn delete_secret(account: impl Into<String>) -> Result<(), String> {
    let account = account.into();
    tokio::task::spawn_blocking(move || {
        let entry = Entry::new(SERVICE, &account)
            .map_err(|error| format!("系统凭据存储不可用：{error}"))?;
        match entry.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("无法删除系统凭据：{error}")),
        }
    })
    .await
    .map_err(|error| format!("系统凭据存储任务失败：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_provider_accounts_are_namespaced() {
        assert_eq!(
            model_provider_account(" deepseek "),
            "model-provider:deepseek"
        );
    }
}
