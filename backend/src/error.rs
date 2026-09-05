use axum::{http::StatusCode, response::IntoResponse, Json};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Unauthorized(String),
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    TooManyRequests(String),
    #[error("{0}")]
    GatewayBusy(String),
    #[error("{0}")]
    Internal(String),
    #[error("{0}")]
    Upstream(String),
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error(transparent)]
    Reqwest(#[from] reqwest::Error),
    #[error(transparent)]
    Jwt(#[from] jsonwebtoken::errors::Error),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let status = match self {
            ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ApiError::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            ApiError::Forbidden(_) => StatusCode::FORBIDDEN,
            ApiError::NotFound(_) => StatusCode::NOT_FOUND,
            ApiError::Conflict(_) => StatusCode::CONFLICT,
            ApiError::TooManyRequests(_) => StatusCode::TOO_MANY_REQUESTS,
            ApiError::GatewayBusy(_) => StatusCode::CONFLICT,
            ApiError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
            ApiError::Upstream(_) => StatusCode::BAD_GATEWAY,
            ApiError::Jwt(_) => StatusCode::UNAUTHORIZED,
            ApiError::Sqlx(_) | ApiError::Reqwest(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let message = self.to_string();
        let mut body = json!({ "error": { "message": message } });
        if matches!(self, ApiError::GatewayBusy(_)) {
            body["error"]["code"] = json!("gateway_queue_timeout");
            body["error"]["source"] = json!("gateway_queue");
        }
        (status, Json(body)).into_response()
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
