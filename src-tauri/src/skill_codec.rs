use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};

pub(crate) const CODEC_VERSION: u16 = 1;

const CODEC_MAGIC: &[u8; 8] = b"ALPHASX1";
const CODEC_KEY: [u8; 32] = [
    0x79, 0xf2, 0x84, 0xbf, 0xd3, 0xdc, 0x34, 0x6f, 0x7d, 0x5e, 0x9a, 0x75, 0x6c, 0x4d, 0x45, 0xb5,
    0x08, 0x78, 0x3e, 0x79, 0x24, 0x14, 0x30, 0x59, 0xb7, 0xc1, 0xb2, 0x7d, 0x45, 0x98, 0xa7, 0x4c,
];
const NONCE_BYTES: usize = 12;
const AUTH_TAG_BYTES: usize = 16;
const HEADER_BYTES: usize = CODEC_MAGIC.len() + 2 + NONCE_BYTES;

fn codec_aad(logical_path: &str) -> Vec<u8> {
    format!("alpha-studio-skill:{CODEC_VERSION}:{logical_path}").into_bytes()
}

pub(crate) fn decode_asx(encoded: &[u8], logical_path: &str) -> Result<Vec<u8>, String> {
    if encoded.len() < HEADER_BYTES + AUTH_TAG_BYTES {
        return Err("encoded payload is truncated".to_string());
    }
    if &encoded[..CODEC_MAGIC.len()] != CODEC_MAGIC {
        return Err("encoded payload has an invalid magic header".to_string());
    }
    let version_offset = CODEC_MAGIC.len();
    let version = u16::from_be_bytes([encoded[version_offset], encoded[version_offset + 1]]);
    if version != CODEC_VERSION {
        return Err(format!(
            "unsupported codec version {version}; runtime supports {CODEC_VERSION}"
        ));
    }

    let nonce_start = version_offset + 2;
    let nonce_end = nonce_start + NONCE_BYTES;
    let cipher = Aes256Gcm::new_from_slice(&CODEC_KEY)
        .map_err(|_| "failed to initialize the Skill codec".to_string())?;
    cipher
        .decrypt(
            Nonce::from_slice(&encoded[nonce_start..nonce_end]),
            Payload {
                msg: &encoded[nonce_end..],
                aad: &codec_aad(logical_path),
            },
        )
        .map_err(|_| {
            "authentication failed (wrong path, corrupt file, or incompatible codec)".to_string()
        })
}

#[cfg(test)]
pub(crate) fn encode_asx_for_test(contents: &[u8], logical_path: &str, nonce_seed: u8) -> Vec<u8> {
    let nonce = [nonce_seed; NONCE_BYTES];
    let cipher = Aes256Gcm::new_from_slice(&CODEC_KEY).unwrap();
    let encrypted = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: contents,
                aad: &codec_aad(logical_path),
            },
        )
        .unwrap();
    let mut encoded = Vec::with_capacity(HEADER_BYTES + encrypted.len());
    encoded.extend_from_slice(CODEC_MAGIC);
    encoded.extend_from_slice(&CODEC_VERSION.to_be_bytes());
    encoded.extend_from_slice(&nonce);
    encoded.extend_from_slice(&encrypted);
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_payloads_authenticated_for_a_different_path() {
        let encoded = encode_asx_for_test(b"fixture", "one/SKILL.md", 7);

        assert!(decode_asx(&encoded, "two/SKILL.md")
            .unwrap_err()
            .contains("authentication failed"));
        assert_eq!(decode_asx(&encoded, "one/SKILL.md").unwrap(), b"fixture");
    }
}
