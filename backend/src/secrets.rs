use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use sha2::{Digest, Sha256};

const CIPHERTEXT_PREFIX: &str = "v1.";
const MANAGED_CIPHERTEXT_PREFIX: &str = "kms-v1.";
const NONCE_BYTES: usize = 12;
const AUTHORIZATION_CODE_AAD: &[u8] = b"alpha-studio.authorization-code.v1";
const PROVIDER_API_KEY_AAD: &[u8] = b"alpha-studio.provider-api-key.v1";
const CODEX_LOGIN_SECRET_AAD: &[u8] = b"alpha-studio.codex-login-secret.v1";

#[derive(Clone)]
pub struct AuthorizationCodeCipher {
    key: [u8; 32],
}

#[derive(Clone)]
pub struct ManagedSecretCipher {
    key: [u8; 32],
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SecretCipherError {
    #[error("authorization code encryption failed")]
    EncryptionFailed,
    #[error("authorization code ciphertext is invalid")]
    InvalidCiphertext,
}

impl ManagedSecretCipher {
    pub fn new(kms_master_key: &str) -> Self {
        let key: [u8; 32] = Sha256::digest(kms_master_key.as_bytes()).into();
        Self { key }
    }

    pub fn encrypt_provider_api_key(&self, plaintext: &str) -> Result<String, SecretCipherError> {
        encrypt_with_aad(
            &self.key,
            plaintext,
            PROVIDER_API_KEY_AAD,
            MANAGED_CIPHERTEXT_PREFIX,
        )
    }

    pub fn decrypt_provider_api_key(&self, ciphertext: &str) -> Result<String, SecretCipherError> {
        decrypt_with_aad(
            &self.key,
            ciphertext,
            PROVIDER_API_KEY_AAD,
            MANAGED_CIPHERTEXT_PREFIX,
        )
    }

    pub fn encrypt_codex_login_secret(&self, plaintext: &str) -> Result<String, SecretCipherError> {
        encrypt_with_aad(
            &self.key,
            plaintext,
            CODEX_LOGIN_SECRET_AAD,
            MANAGED_CIPHERTEXT_PREFIX,
        )
    }

    pub fn decrypt_codex_login_secret(
        &self,
        ciphertext: &str,
    ) -> Result<String, SecretCipherError> {
        decrypt_with_aad(
            &self.key,
            ciphertext,
            CODEX_LOGIN_SECRET_AAD,
            MANAGED_CIPHERTEXT_PREFIX,
        )
    }
}

impl AuthorizationCodeCipher {
    pub fn new(secret: &str) -> Self {
        let key: [u8; 32] = Sha256::digest(secret.as_bytes()).into();
        Self { key }
    }

    pub fn encrypt(&self, plaintext: &str) -> Result<String, SecretCipherError> {
        encrypt_with_aad(
            &self.key,
            plaintext,
            AUTHORIZATION_CODE_AAD,
            CIPHERTEXT_PREFIX,
        )
    }

    pub fn decrypt(&self, ciphertext: &str) -> Result<String, SecretCipherError> {
        decrypt_with_aad(
            &self.key,
            ciphertext,
            AUTHORIZATION_CODE_AAD,
            CIPHERTEXT_PREFIX,
        )
    }
}

fn encrypt_with_aad(
    key: &[u8; 32],
    plaintext: &str,
    aad: &[u8],
    prefix: &str,
) -> Result<String, SecretCipherError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| SecretCipherError::EncryptionFailed)?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let encrypted = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext.as_bytes(),
                aad,
            },
        )
        .map_err(|_| SecretCipherError::EncryptionFailed)?;
    let mut sealed = Vec::with_capacity(NONCE_BYTES + encrypted.len());
    sealed.extend_from_slice(&nonce);
    sealed.extend_from_slice(&encrypted);
    Ok(format!("{prefix}{}", URL_SAFE_NO_PAD.encode(sealed)))
}

fn decrypt_with_aad(
    key: &[u8; 32],
    ciphertext: &str,
    aad: &[u8],
    prefix: &str,
) -> Result<String, SecretCipherError> {
    let encoded = ciphertext
        .strip_prefix(prefix)
        .ok_or(SecretCipherError::InvalidCiphertext)?;
    let sealed = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| SecretCipherError::InvalidCiphertext)?;
    if sealed.len() <= NONCE_BYTES {
        return Err(SecretCipherError::InvalidCiphertext);
    }
    let (nonce, encrypted) = sealed.split_at(NONCE_BYTES);
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|_| SecretCipherError::InvalidCiphertext)?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: encrypted,
                aad,
            },
        )
        .map_err(|_| SecretCipherError::InvalidCiphertext)?;
    String::from_utf8(plaintext).map_err(|_| SecretCipherError::InvalidCiphertext)
}
#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "test-authorization-code-encryption-key-123456789";

    #[test]
    fn authorization_code_round_trips_without_deterministic_ciphertext() {
        let cipher = AuthorizationCodeCipher::new(SECRET);
        let first = cipher.encrypt("AS-1234-5678-ABCD").unwrap();
        let second = cipher.encrypt("AS-1234-5678-ABCD").unwrap();

        assert_ne!(first, second);
        assert_eq!(cipher.decrypt(&first).unwrap(), "AS-1234-5678-ABCD");
        assert_eq!(cipher.decrypt(&second).unwrap(), "AS-1234-5678-ABCD");
    }

    #[test]
    fn wrong_key_and_tampering_are_rejected() {
        let cipher = AuthorizationCodeCipher::new(SECRET);
        let ciphertext = cipher.encrypt("AS-SECRET").unwrap();
        let wrong = AuthorizationCodeCipher::new("another-encryption-key-that-is-long-enough");
        assert_eq!(
            wrong.decrypt(&ciphertext),
            Err(SecretCipherError::InvalidCiphertext)
        );

        let mut tampered = ciphertext.into_bytes();
        let last = tampered.last_mut().unwrap();
        *last = if *last == b'A' { b'B' } else { b'A' };
        assert_eq!(
            cipher.decrypt(std::str::from_utf8(&tampered).unwrap()),
            Err(SecretCipherError::InvalidCiphertext)
        );
    }

    #[test]
    fn managed_secrets_use_separate_authenticated_contexts() {
        let cipher = ManagedSecretCipher::new(SECRET);
        let provider = cipher.encrypt_provider_api_key("sk-provider").unwrap();
        let login = cipher.encrypt_codex_login_secret("one-time-note").unwrap();

        assert!(provider.starts_with(MANAGED_CIPHERTEXT_PREFIX));
        assert_eq!(
            cipher.decrypt_provider_api_key(&provider).unwrap(),
            "sk-provider"
        );
        assert_eq!(
            cipher.decrypt_codex_login_secret(&login).unwrap(),
            "one-time-note"
        );
        assert_eq!(
            cipher.decrypt_codex_login_secret(&provider),
            Err(SecretCipherError::InvalidCiphertext)
        );
    }
}
