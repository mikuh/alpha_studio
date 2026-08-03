use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

const RUN_TOKEN_TYPE: &str = "run";
const ADMIN_TOKEN_TYPE: &str = "admin";
const DEVICE_TOKEN_TYPE: &str = "device";

#[derive(Clone)]
pub struct RunTokenService {
    secret: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunTokenClaims {
    pub token_type: String,
    pub tenant_id: String,
    pub user_id: String,
    pub device_id: String,
    pub run_id: String,
    pub model_id: String,
    pub budget_yuan: f64,
    pub iat: usize,
    pub exp: usize,
}

impl RunTokenClaims {
    pub fn new(
        tenant_id: String,
        user_id: String,
        device_id: String,
        run_id: String,
        model_id: String,
        budget_yuan: f64,
        ttl_seconds: i64,
    ) -> Self {
        let now = Utc::now();
        Self {
            token_type: RUN_TOKEN_TYPE.to_string(),
            tenant_id,
            user_id,
            device_id,
            run_id,
            model_id,
            budget_yuan,
            iat: now.timestamp() as usize,
            exp: (now + Duration::seconds(ttl_seconds)).timestamp() as usize,
        }
    }
}

impl RunTokenService {
    pub fn new(secret: String) -> Self {
        Self { secret }
    }

    pub fn issue(&self, claims: RunTokenClaims) -> Result<String, jsonwebtoken::errors::Error> {
        encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(self.secret.as_bytes()),
        )
    }

    pub fn verify(&self, token: &str) -> Result<RunTokenClaims, jsonwebtoken::errors::Error> {
        let claims = decode::<RunTokenClaims>(
            token,
            &DecodingKey::from_secret(self.secret.as_bytes()),
            &strict_validation(),
        )
        .map(|data| data.claims)?;
        if claims.token_type != RUN_TOKEN_TYPE {
            return Err(jsonwebtoken::errors::Error::from(
                jsonwebtoken::errors::ErrorKind::InvalidToken,
            ));
        }
        Ok(claims)
    }
}

#[derive(Clone)]
pub struct AdminTokenService {
    secret: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AdminTokenClaims {
    pub token_type: String,
    pub email: String,
    pub role: String,
    pub iat: usize,
    pub exp: usize,
}

impl AdminTokenClaims {
    pub fn new(email: String, ttl_seconds: i64) -> Self {
        let now = Utc::now();
        Self {
            token_type: ADMIN_TOKEN_TYPE.to_string(),
            email,
            role: "owner".to_string(),
            iat: now.timestamp() as usize,
            exp: (now + Duration::seconds(ttl_seconds)).timestamp() as usize,
        }
    }
}

impl AdminTokenService {
    pub fn new(secret: String) -> Self {
        Self { secret }
    }

    pub fn issue(&self, claims: AdminTokenClaims) -> Result<String, jsonwebtoken::errors::Error> {
        encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(self.secret.as_bytes()),
        )
    }

    pub fn verify(&self, token: &str) -> Result<AdminTokenClaims, jsonwebtoken::errors::Error> {
        let claims = decode::<AdminTokenClaims>(
            token,
            &DecodingKey::from_secret(self.secret.as_bytes()),
            &strict_validation(),
        )
        .map(|data| data.claims)?;
        if claims.token_type != ADMIN_TOKEN_TYPE || claims.role != "owner" {
            return Err(jsonwebtoken::errors::Error::from(
                jsonwebtoken::errors::ErrorKind::InvalidToken,
            ));
        }
        Ok(claims)
    }
}

#[derive(Clone)]
pub struct DeviceTokenService {
    secret: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceTokenClaims {
    pub token_type: String,
    pub tenant_id: String,
    pub user_id: String,
    pub device_id: String,
    pub fingerprint_hash: String,
    pub iat: usize,
    pub exp: usize,
}

impl DeviceTokenClaims {
    pub fn new(
        tenant_id: String,
        user_id: String,
        device_id: String,
        fingerprint_hash: String,
        ttl_seconds: i64,
    ) -> Self {
        let now = Utc::now();
        Self {
            token_type: DEVICE_TOKEN_TYPE.to_string(),
            tenant_id,
            user_id,
            device_id,
            fingerprint_hash,
            iat: now.timestamp() as usize,
            exp: (now + Duration::seconds(ttl_seconds)).timestamp() as usize,
        }
    }
}

impl DeviceTokenService {
    pub fn new(secret: String) -> Self {
        Self { secret }
    }

    pub fn issue(&self, claims: DeviceTokenClaims) -> Result<String, jsonwebtoken::errors::Error> {
        encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(self.secret.as_bytes()),
        )
    }

    pub fn verify(&self, token: &str) -> Result<DeviceTokenClaims, jsonwebtoken::errors::Error> {
        let claims = decode::<DeviceTokenClaims>(
            token,
            &DecodingKey::from_secret(self.secret.as_bytes()),
            &strict_validation(),
        )
        .map(|data| data.claims)?;
        if claims.token_type != DEVICE_TOKEN_TYPE {
            return Err(jsonwebtoken::errors::Error::from(
                jsonwebtoken::errors::ErrorKind::InvalidToken,
            ));
        }
        Ok(claims)
    }
}

fn strict_validation() -> Validation {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.leeway = 15;
    validation.set_required_spec_claims(&["exp", "iat"]);
    validation
}
