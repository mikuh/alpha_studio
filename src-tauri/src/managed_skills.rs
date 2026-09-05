use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::builtin_skills;

const BUNDLE_FORMAT_VERSION: u16 = 1;
const MAX_ARTIFACT_BYTES: usize = 32 * 1024 * 1024;
const MAX_BUNDLE_FILES: usize = 5_000;
const ASX_MAGIC: &[u8; 8] = b"ALPHASX1";
static SYNC_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedSkillsSyncRequest {
    api_base_url: String,
    tenant_id: String,
    device_id: String,
    access_token: String,
    #[serde(default = "default_channel")]
    channel: String,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedSkillsSyncResult {
    status: String,
    version: Option<String>,
    channel: String,
    skill_names: Vec<String>,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogResponse {
    release: Option<CatalogRelease>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogRelease {
    id: String,
    version: String,
    channel: String,
    min_client_version: String,
    artifact_sha256: String,
    artifact_size: u64,
    download_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillBundle {
    format_version: u16,
    version: String,
    channel: String,
    min_client_version: String,
    files: Vec<SkillBundleFile>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillBundleFile {
    path: String,
    contents_base64: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActiveManagedRelease {
    release_id: String,
    cache_key: String,
    version: String,
    channel: String,
    artifact_sha256: String,
    skill_names: Vec<String>,
}

#[tauri::command]
pub(crate) async fn managed_skills_sync(
    request: ManagedSkillsSyncRequest,
) -> Result<ManagedSkillsSyncResult, String> {
    validate_request(&request)?;
    let managed_root = managed_skills_root()?;
    let current = read_active_release(&managed_root).ok();
    let installed_sha256 = current
        .as_ref()
        .map(|release| release.artifact_sha256.as_str())
        .unwrap_or("");
    let api_base = reqwest::Url::parse(request.api_base_url.trim())
        .map_err(|error| format!("Invalid managed Skill API URL: {error}"))?;
    if !matches!(api_base.scheme(), "http" | "https") {
        return Err("Managed Skill API URL must use HTTP or HTTPS".to_string());
    }
    let mut catalog_url = api_base
        .join("/api/client/skills/catalog")
        .map_err(|error| format!("Failed to build managed Skill catalog URL: {error}"))?;
    catalog_url
        .query_pairs_mut()
        .append_pair("tenantId", &request.tenant_id)
        .append_pair("deviceId", &request.device_id)
        .append_pair("channel", &request.channel)
        .append_pair("clientVersion", env!("CARGO_PKG_VERSION"))
        .append_pair("installedSha256", installed_sha256);
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|error| format!("Failed to initialize managed Skill client: {error}"))?;
    let response = http
        .get(catalog_url)
        .bearer_auth(request.access_token.trim())
        .send()
        .await
        .map_err(|error| format!("Failed to fetch managed Skill catalog: {error}"))?;
    let response = require_success(response, "fetch managed Skill catalog").await?;
    let catalog = response
        .json::<CatalogResponse>()
        .await
        .map_err(|error| format!("Managed Skill catalog response is invalid: {error}"))?;
    let Some(release) = catalog.release else {
        return Ok(ManagedSkillsSyncResult {
            status: "no-release".to_string(),
            version: current.as_ref().map(|release| release.version.clone()),
            channel: request.channel,
            skill_names: current
                .map(|release| release.skill_names)
                .unwrap_or_default(),
            message: "No published managed Skill release; retained the cached or built-in release."
                .to_string(),
        });
    };
    validate_catalog_release(&release, &request.channel)?;
    if version_is_older(env!("CARGO_PKG_VERSION"), &release.min_client_version) {
        return Ok(ManagedSkillsSyncResult {
            status: "incompatible".to_string(),
            version: current.as_ref().map(|release| release.version.clone()),
            channel: request.channel,
            skill_names: current
                .map(|release| release.skill_names)
                .unwrap_or_default(),
            message: format!(
                "Managed Skill {} requires Alpha Studio {} or newer.",
                release.version, release.min_client_version
            ),
        });
    }
    if current
        .as_ref()
        .is_some_and(|active| active.artifact_sha256 == release.artifact_sha256)
        && active_encoded_path(&managed_root, current.as_ref().unwrap()).is_dir()
    {
        let active = current.unwrap();
        return Ok(ManagedSkillsSyncResult {
            status: "current".to_string(),
            version: Some(active.version),
            channel: active.channel,
            skill_names: active.skill_names,
            message: "Managed Skills are already current.".to_string(),
        });
    }

    let mut download_url = api_base
        .join(&release.download_path)
        .map_err(|error| format!("Failed to build managed Skill download URL: {error}"))?;
    download_url
        .query_pairs_mut()
        .append_pair("tenantId", &request.tenant_id)
        .append_pair("deviceId", &request.device_id);
    let response = http
        .get(download_url)
        .bearer_auth(request.access_token.trim())
        .send()
        .await
        .map_err(|error| format!("Failed to download managed Skill release: {error}"))?;
    let response = require_success(response, "download managed Skill release").await?;
    let artifact = response
        .bytes()
        .await
        .map_err(|error| format!("Failed to read managed Skill release: {error}"))?;
    if artifact.len() != release.artifact_size as usize || artifact.len() > MAX_ARTIFACT_BYTES {
        return Err("Managed Skill artifact size does not match the catalog".to_string());
    }
    let sha256 = hex_sha256(&artifact);
    if sha256 != release.artifact_sha256 {
        return Err("Managed Skill artifact checksum verification failed".to_string());
    }
    let installed = install_release_artifact(&managed_root, &release, &artifact)?;
    Ok(ManagedSkillsSyncResult {
        status: "installed".to_string(),
        version: Some(installed.version),
        channel: installed.channel,
        skill_names: installed.skill_names,
        message: "Managed Skill release downloaded, authenticated, and activated.".to_string(),
    })
}

pub(crate) fn active_encoded_skills_path() -> Option<PathBuf> {
    let root = managed_skills_root().ok()?;
    let active = read_active_release(&root).ok()?;
    let path = active_encoded_path(&root, &active);
    path.is_dir().then_some(path)
}

async fn require_success(
    response: reqwest::Response,
    action: &str,
) -> Result<reqwest::Response, String> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status();
    let message = response
        .text()
        .await
        .unwrap_or_else(|_| "response body unavailable".to_string());
    Err(format!(
        "Failed to {action}: HTTP {status}: {}",
        message.chars().take(500).collect::<String>()
    ))
}

fn install_release_artifact(
    managed_root: &Path,
    release: &CatalogRelease,
    artifact: &[u8],
) -> Result<ActiveManagedRelease, String> {
    let bundle: SkillBundle = serde_json::from_slice(artifact)
        .map_err(|error| format!("Managed Skill bundle JSON is invalid: {error}"))?;
    validate_bundle(&bundle, release)?;
    fs::create_dir_all(managed_root)
        .map_err(|error| format!("Failed to create managed Skill cache: {error}"))?;
    let staging = managed_root.join(format!(
        ".release-staging-{}-{}",
        std::process::id(),
        SYNC_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    remove_internal_directory(managed_root, &staging)?;
    let encoded_root = staging.join("encoded");
    fs::create_dir_all(&encoded_root)
        .map_err(|error| format!("Failed to create managed Skill staging directory: {error}"))?;
    let materialize_result = (|| {
        for file in &bundle.files {
            let relative = safe_relative_path(&file.path)?;
            let protected = STANDARD
                .decode(file.contents_base64.as_bytes())
                .map_err(|_| format!("Managed Skill file {} is not valid base64", file.path))?;
            if protected.len() < ASX_MAGIC.len() + 2
                || &protected[..ASX_MAGIC.len()] != ASX_MAGIC
                || u16::from_be_bytes([protected[ASX_MAGIC.len()], protected[ASX_MAGIC.len() + 1]])
                    != crate::skill_codec::CODEC_VERSION
            {
                return Err(format!(
                    "Managed Skill file {} is not a supported protected .asx payload",
                    file.path
                ));
            }
            let output = encoded_root.join(relative);
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("Failed to create managed Skill directory: {error}")
                })?;
            }
            fs::write(&output, protected)
                .map_err(|error| format!("Failed to cache managed Skill file: {error}"))?;
        }
        let verification_runtime = staging.join("verified-runtime");
        let verification_users = staging.join("verified-users");
        fs::create_dir_all(&verification_runtime)
            .and_then(|_| fs::create_dir_all(&verification_users))
            .map_err(|error| format!("Failed to prepare managed Skill verification: {error}"))?;
        let installed = builtin_skills::install_builtin_skills(
            &encoded_root,
            &verification_runtime,
            &verification_users,
        )?;
        fs::remove_dir_all(&verification_runtime)
            .and_then(|_| fs::remove_dir_all(&verification_users))
            .map_err(|error| format!("Failed to clean managed Skill verification data: {error}"))?;
        Ok(installed)
    })();
    let installed = match materialize_result {
        Ok(installed) => installed,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
    };
    let cache_key = format!("{}-{}", release.id, &release.artifact_sha256[..12]);
    validate_release_token(&cache_key, "cache key")?;
    let releases_root = managed_root.join("releases");
    fs::create_dir_all(&releases_root)
        .map_err(|error| format!("Failed to create managed Skill release cache: {error}"))?;
    let destination = releases_root.join(&cache_key);
    if destination.exists() {
        remove_internal_directory(&releases_root, &destination)?;
    }
    fs::rename(&staging, &destination)
        .map_err(|error| format!("Failed to activate managed Skill cache: {error}"))?;
    let active = ActiveManagedRelease {
        release_id: release.id.clone(),
        cache_key,
        version: release.version.clone(),
        channel: release.channel.clone(),
        artifact_sha256: release.artifact_sha256.clone(),
        skill_names: installed.skill_names,
    };
    let active_json = serde_json::to_vec_pretty(&active)
        .map_err(|error| format!("Failed to serialize managed Skill state: {error}"))?;
    fs::write(managed_root.join("active.json"), active_json)
        .map_err(|error| format!("Failed to save managed Skill state: {error}"))?;
    Ok(active)
}

fn validate_bundle(bundle: &SkillBundle, release: &CatalogRelease) -> Result<(), String> {
    if bundle.format_version != BUNDLE_FORMAT_VERSION
        || bundle.version != release.version
        || bundle.channel != release.channel
        || bundle.min_client_version != release.min_client_version
        || bundle.files.is_empty()
        || bundle.files.len() > MAX_BUNDLE_FILES
    {
        return Err("Managed Skill bundle metadata does not match the catalog".to_string());
    }
    let mut paths = HashSet::new();
    for file in &bundle.files {
        safe_relative_path(&file.path)?;
        if !file.path.ends_with(".asx") || !paths.insert(file.path.as_str()) {
            return Err("Managed Skill bundle contains duplicate or non-.asx paths".to_string());
        }
    }
    if !paths.contains("manifest.json.asx") {
        return Err("Managed Skill bundle is missing manifest.json.asx".to_string());
    }
    Ok(())
}

fn validate_request(request: &ManagedSkillsSyncRequest) -> Result<(), String> {
    if request.api_base_url.trim().is_empty()
        || request.tenant_id.trim().is_empty()
        || request.device_id.trim().is_empty()
        || request.access_token.trim().is_empty()
    {
        return Err(
            "Managed Skill sync requires API, tenant, device, and access token".to_string(),
        );
    }
    validate_channel(&request.channel)
}

fn validate_catalog_release(
    release: &CatalogRelease,
    requested_channel: &str,
) -> Result<(), String> {
    validate_release_token(&release.id, "release id")?;
    validate_release_token(&release.version, "release version")?;
    validate_release_token(&release.min_client_version, "minimum client version")?;
    validate_channel(&release.channel)?;
    if release.channel != requested_channel
        || release.artifact_sha256.len() != 64
        || !release
            .artifact_sha256
            .chars()
            .all(|character| character.is_ascii_hexdigit() && !character.is_ascii_uppercase())
        || release.artifact_size == 0
        || release.artifact_size > MAX_ARTIFACT_BYTES as u64
        || !release
            .download_path
            .starts_with("/api/client/skills/releases/")
    {
        return Err("Managed Skill catalog contains an invalid release".to_string());
    }
    Ok(())
}

fn safe_relative_path(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if value.is_empty()
        || value.contains('\\')
        || value.len() > 1_024
        || path.is_absolute()
        || !path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err(format!("Managed Skill bundle path is unsafe: {value}"));
    }
    Ok(path)
}

fn validate_release_token(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 96
        || !value.chars().enumerate().all(|(index, character)| {
            character.is_ascii_alphanumeric() || (index > 0 && matches!(character, '.' | '_' | '-'))
        })
    {
        Err(format!("Managed Skill {label} contains invalid characters"))
    } else {
        Ok(())
    }
}

fn validate_channel(channel: &str) -> Result<(), String> {
    if matches!(channel, "dev" | "beta" | "stable") {
        Ok(())
    } else {
        Err("Managed Skill channel must be dev, beta, or stable".to_string())
    }
}

fn managed_skills_root() -> Result<PathBuf, String> {
    let home =
        crate::home_dir().ok_or_else(|| "Failed to resolve HOME for managed Skills".to_string())?;
    Ok(PathBuf::from(home)
        .join(".alpha-studio")
        .join("managed-skills"))
}

fn read_active_release(root: &Path) -> Result<ActiveManagedRelease, String> {
    let contents = fs::read(root.join("active.json"))
        .map_err(|error| format!("Failed to read managed Skill state: {error}"))?;
    let active: ActiveManagedRelease = serde_json::from_slice(&contents)
        .map_err(|error| format!("Managed Skill state is invalid: {error}"))?;
    validate_release_token(&active.release_id, "release id")?;
    validate_release_token(&active.cache_key, "cache key")?;
    validate_channel(&active.channel)?;
    Ok(active)
}

fn active_encoded_path(root: &Path, active: &ActiveManagedRelease) -> PathBuf {
    root.join("releases")
        .join(&active.cache_key)
        .join("encoded")
}

fn remove_internal_directory(root: &Path, target: &Path) -> Result<(), String> {
    if target == root || !target.starts_with(root) {
        return Err(format!(
            "Refusing to remove managed Skill path outside its cache: {}",
            target.display()
        ));
    }
    match fs::symlink_metadata(target) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            fs::remove_dir_all(target)
                .map_err(|error| format!("Failed to replace managed Skill cache: {error}"))
        }
        Ok(_) => fs::remove_file(target)
            .map_err(|error| format!("Failed to replace managed Skill cache entry: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to inspect managed Skill cache: {error}")),
    }
}

fn hex_sha256(contents: &[u8]) -> String {
    Sha256::digest(contents)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn version_is_older(current: &str, minimum: &str) -> bool {
    fn parts(value: &str) -> Vec<u64> {
        value
            .split(['.', '-', '+'])
            .take(3)
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .chain(std::iter::repeat(0))
            .take(3)
            .collect()
    }
    parts(current) < parts(minimum)
}

fn default_channel() -> String {
    "stable".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_skill_paths_that_can_escape_the_cache() {
        assert!(safe_relative_path("alpha-studio-ok/SKILL.md.asx").is_ok());
        assert!(safe_relative_path("../SKILL.md.asx").is_err());
        assert!(safe_relative_path("/tmp/SKILL.md.asx").is_err());
        assert!(safe_relative_path("alpha-studio-ok\\SKILL.md.asx").is_err());
    }

    #[test]
    fn compares_client_compatibility_versions() {
        assert!(version_is_older("0.1.0", "0.2.0"));
        assert!(!version_is_older("0.2.1", "0.2.0"));
        assert!(!version_is_older("1.0.0", "0.9.9"));
    }
}
