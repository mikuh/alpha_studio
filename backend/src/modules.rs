use crate::error::{ApiError, ApiResult};
use serde::Deserialize;
use sqlx::PgPool;
use std::sync::LazyLock;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductModule {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub market_data: bool,
}

pub static CATALOG: LazyLock<Vec<ProductModule>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../shared/productModules.json"))
        .expect("valid module catalog")
});

pub fn validate_modules(ids: &[String]) -> ApiResult<()> {
    if ids.len() > CATALOG.len()
        || ids
            .iter()
            .any(|id| !CATALOG.iter().any(|item| item.id == *id))
    {
        return Err(ApiError::BadRequest("unknown or invalid module IDs".into()));
    }
    Ok(())
}

pub fn check_grants(granted: &[String], required: &[String]) -> ApiResult<()> {
    validate_modules(required)?;
    for id in required {
        if !granted.contains(id) {
            let title = &CATALOG.iter().find(|item| item.id == *id).unwrap().title;
            return Err(ApiError::Forbidden(format!(
                "当前客户未开通「{title}」，请联系管理员配置模块权限。"
            )));
        }
    }
    Ok(())
}

// Market snapshots are shared by the workbench, daily decision panel and
// intraday monitoring; granting one must not require granting the other UI.
pub async fn require_market_access(db: &PgPool, tenant_id: &str) -> ApiResult<()> {
    let granted: Vec<String> = sqlx::query_scalar(
        "select enabled_modules from tenants where id = $1 and status = 'active'",
    )
    .bind(tenant_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| ApiError::Forbidden("tenant is not active".into()))?;
    if !CATALOG
        .iter()
        .any(|item| item.market_data && granted.contains(&item.id))
    {
        return Err(ApiError::Forbidden(
            "当前客户未开通使用行情数据的模块。".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requires_explicit_grants_and_rejects_unknown_ids() {
        assert!(check_grants(&[], &["files".into()]).is_err());
        assert!(check_grants(&["files".into()], &["files".into()]).is_ok());
        assert!(check_grants(&["files".into()], &["browser".into()]).is_err());
        assert!(check_grants(&["unknown".into()], &["unknown".into()]).is_err());
        assert!(check_grants(&["files".into()], &["files".into(), "browser".into()]).is_err());
    }
}
