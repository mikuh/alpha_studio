use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

#[derive(Clone)]
pub struct RunTokenService {
    secret: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunTokenClaims {
    pub tenant_id: String,
    pub user_id: String,
    pub device_id: String,
    pub run_id: String,
    pub model_id: String,
    pub budget_cents: u64,
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
        budget_cents: u64,
        ttl_seconds: i64,
    ) -> Self {
        let now = Utc::now();
        Self {
            tenant_id,
            user_id,
            device_id,
            run_id,
            model_id,
            budget_cents,
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
        decode::<RunTokenClaims>(
            token,
            &DecodingKey::from_secret(self.secret.as_bytes()),
            &Validation::default(),
        )
        .map(|data| data.claims)
    }
}
