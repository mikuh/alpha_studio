use std::collections::HashSet;

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, Response, StatusCode},
    Json,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult},
    routes::{require_admin, require_device, write_audit},
    state::AppState,
};

const BUNDLE_FORMAT_VERSION: u16 = 1;
const SKILL_CODEC_VERSION: u16 = 1;
const MAX_ARTIFACT_BYTES: usize = 32 * 1024 * 1024;
const MAX_BUNDLE_FILES: usize = 5_000;
const ASX_MAGIC: &[u8; 8] = b"ALPHASX1";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillBundle {
    format_version: u16,
    version: String,
    channel: String,
    min_client_version: String,
    #[serde(default)]
    release_notes: String,
    manifest_summary: SkillManifestSummary,
    files: Vec<SkillBundleFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillManifestSummary {
    codec_version: u16,
    skill_count: usize,
    encoded_file_count: usize,
    skills: Vec<SkillManifestEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillManifestEntry {
    skill_name: String,
    relative_path: String,
    encoded_file_count: usize,
    original_total_bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillBundleFile {
    path: String,
    contents_base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminCreateSkillReleaseRequest {
    artifact_base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientSkillCatalogQuery {
    tenant_id: String,
    device_id: String,
    #[serde(default = "default_channel")]
    channel: String,
    #[serde(default)]
    client_version: String,
    #[serde(default)]
    installed_sha256: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientSkillDownloadQuery {
    tenant_id: String,
    device_id: String,
}

pub fn upload_body_limit() -> DefaultBodyLimit {
    // Base64 and JSON framing add roughly 34% on top of the protected artifact.
    DefaultBodyLimit::max(MAX_ARTIFACT_BYTES * 2)
}

pub async fn admin_list_skill_releases(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let rows = sqlx::query(
        r#"
        select id, version, channel, status, min_client_version, release_notes,
          codec_version, skill_count, encoded_file_count, manifest_summary,
          artifact_sha256, artifact_size, created_at, published_at
        from skill_releases
        order by created_at desc
        "#,
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({
        "releases": rows.into_iter().map(release_row_json).collect::<Vec<_>>()
    })))
}

pub async fn admin_create_skill_release(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<AdminCreateSkillReleaseRequest>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let artifact = STANDARD
        .decode(request.artifact_base64.trim())
        .map_err(|_| ApiError::BadRequest("artifactBase64 is not valid base64".to_string()))?;
    let validated = validate_bundle(&artifact)?;
    let artifact_sha256 = hex::encode(Sha256::digest(&artifact));
    let id = format!("skillrel_{}", Uuid::new_v4().simple());
    let manifest_summary = json!({
        "codecVersion": validated.manifest_summary.codec_version,
        "skillCount": validated.manifest_summary.skill_count,
        "encodedFileCount": validated.manifest_summary.encoded_file_count,
        "skills": validated.manifest_summary.skills.iter().map(|skill| json!({
            "skillName": skill.skill_name,
            "relativePath": skill.relative_path,
            "encodedFileCount": skill.encoded_file_count,
            "originalTotalBytes": skill.original_total_bytes
        })).collect::<Vec<_>>()
    });
    let row = sqlx::query(
        r#"
        insert into skill_releases (
          id, version, channel, status, min_client_version, release_notes,
          codec_version, skill_count, encoded_file_count, manifest_summary,
          artifact, artifact_sha256, artifact_size
        )
        values ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10, $11, $12)
        returning id, version, channel, status, min_client_version, release_notes,
          codec_version, skill_count, encoded_file_count, manifest_summary,
          artifact_sha256, artifact_size, created_at, published_at
        "#,
    )
    .bind(&id)
    .bind(&validated.version)
    .bind(&validated.channel)
    .bind(&validated.min_client_version)
    .bind(&validated.release_notes)
    .bind(i32::from(validated.manifest_summary.codec_version))
    .bind(validated.manifest_summary.skill_count as i32)
    .bind(validated.manifest_summary.encoded_file_count as i32)
    .bind(manifest_summary)
    .bind(artifact)
    .bind(&artifact_sha256)
    .bind(validated.artifact_size as i64)
    .fetch_one(&state.db)
    .await
    .map_err(|error| {
        if is_unique_violation(&error) {
            ApiError::Conflict(format!(
                "Skill release {} already exists in channel {}",
                validated.version, validated.channel
            ))
        } else {
            ApiError::Sqlx(error)
        }
    })?;
    write_audit(
        &state.db,
        "system",
        "skill_release.create",
        json!({
            "id": id,
            "version": validated.version,
            "channel": validated.channel,
            "artifactSha256": artifact_sha256
        }),
    )
    .await?;
    Ok(Json(release_row_json(row)))
}

pub async fn admin_publish_skill_release(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let mut transaction = state.db.begin().await?;
    let target =
        sqlx::query("select version, channel from skill_releases where id = $1 for update")
            .bind(id.trim())
            .fetch_optional(&mut *transaction)
            .await?
            .ok_or_else(|| ApiError::NotFound("Skill release not found".to_string()))?;
    let channel = target.get::<String, _>("channel");
    let version = target.get::<String, _>("version");
    sqlx::query(
        "update skill_releases set status = 'archived' where channel = $1 and status = 'published' and id <> $2",
    )
    .bind(&channel)
    .bind(id.trim())
    .execute(&mut *transaction)
    .await?;
    let row = sqlx::query(
        r#"
        update skill_releases
        set status = 'published', published_at = now()
        where id = $1
        returning id, version, channel, status, min_client_version, release_notes,
          codec_version, skill_count, encoded_file_count, manifest_summary,
          artifact_sha256, artifact_size, created_at, published_at
        "#,
    )
    .bind(id.trim())
    .fetch_one(&mut *transaction)
    .await?;
    transaction.commit().await?;
    write_audit(
        &state.db,
        "system",
        "skill_release.publish",
        json!({ "id": id, "version": version, "channel": channel }),
    )
    .await?;
    Ok(Json(release_row_json(row)))
}

pub async fn admin_delete_skill_release(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let row = sqlx::query(
        "delete from skill_releases where id = $1 and status <> 'published' returning version, channel",
    )
    .bind(id.trim())
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| {
        ApiError::Conflict("Published Skill releases must be replaced before deletion".to_string())
    })?;
    let version = row.get::<String, _>("version");
    let channel = row.get::<String, _>("channel");
    write_audit(
        &state.db,
        "system",
        "skill_release.delete",
        json!({ "id": id, "version": version, "channel": channel }),
    )
    .await?;
    Ok(Json(json!({ "id": id })))
}

pub async fn client_skill_catalog(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ClientSkillCatalogQuery>,
) -> ApiResult<Json<Value>> {
    require_device(&state, &headers, &query.tenant_id, &query.device_id).await?;
    validate_channel(&query.channel)?;
    let row = sqlx::query(
        r#"
        select id, version, channel, min_client_version, release_notes,
          codec_version, skill_count, encoded_file_count, manifest_summary,
          artifact_sha256, artifact_size, published_at
        from skill_releases
        where channel = $1 and status = 'published'
        limit 1
        "#,
    )
    .bind(&query.channel)
    .fetch_optional(&state.db)
    .await?;
    let release = row.map(|row| {
        let sha256 = row.get::<String, _>("artifact_sha256");
        json!({
            "id": row.get::<String, _>("id"),
            "version": row.get::<String, _>("version"),
            "channel": row.get::<String, _>("channel"),
            "minClientVersion": row.get::<String, _>("min_client_version"),
            "releaseNotes": row.get::<String, _>("release_notes"),
            "codecVersion": row.get::<i32, _>("codec_version"),
            "skillCount": row.get::<i32, _>("skill_count"),
            "encodedFileCount": row.get::<i32, _>("encoded_file_count"),
            "manifestSummary": row.get::<Value, _>("manifest_summary"),
            "artifactSha256": sha256,
            "artifactSize": row.get::<i64, _>("artifact_size"),
            "publishedAt": row.try_get::<Option<chrono::DateTime<Utc>>, _>("published_at").unwrap_or(None),
            "downloadPath": format!("/api/client/skills/releases/{}/download", row.get::<String, _>("id")),
            "updateAvailable": query.installed_sha256 != sha256,
            "clientVersion": query.client_version
        })
    });
    Ok(Json(json!({ "release": release })))
}

pub async fn client_download_skill_release(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<ClientSkillDownloadQuery>,
) -> ApiResult<Response<Body>> {
    require_device(&state, &headers, &query.tenant_id, &query.device_id).await?;
    let row = sqlx::query(
        r#"
        select version, artifact, artifact_sha256
        from skill_releases
        where id = $1 and status = 'published'
        "#,
    )
    .bind(id.trim())
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::NotFound("Published Skill release not found".to_string()))?;
    let version = row.get::<String, _>("version");
    let sha256 = row.get::<String, _>("artifact_sha256");
    let artifact = row.get::<Vec<u8>, _>("artifact");
    Response::builder()
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            "application/vnd.alpha-studio.skill-bundle+json",
        )
        .header(header::ETAG, format!("\"{sha256}\""))
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=alpha-studio-skills-{version}.asb.json"),
        )
        .body(Body::from(artifact))
        .map_err(|error| ApiError::Internal(format!("Failed to build Skill download: {error}")))
}

#[derive(Debug)]
struct ValidatedBundle {
    version: String,
    channel: String,
    min_client_version: String,
    release_notes: String,
    manifest_summary: SkillManifestSummary,
    artifact_size: usize,
}

fn validate_bundle(artifact: &[u8]) -> ApiResult<ValidatedBundle> {
    if artifact.is_empty() || artifact.len() > MAX_ARTIFACT_BYTES {
        return Err(ApiError::BadRequest(format!(
            "Skill artifact must contain between 1 and {MAX_ARTIFACT_BYTES} bytes"
        )));
    }
    let bundle: SkillBundle = serde_json::from_slice(artifact)
        .map_err(|error| ApiError::BadRequest(format!("Invalid Skill bundle JSON: {error}")))?;
    if bundle.format_version != BUNDLE_FORMAT_VERSION {
        return Err(ApiError::BadRequest(format!(
            "Unsupported Skill bundle format {}; expected {BUNDLE_FORMAT_VERSION}",
            bundle.format_version
        )));
    }
    validate_release_token(&bundle.version, "version")?;
    validate_release_token(&bundle.min_client_version, "minClientVersion")?;
    validate_channel(&bundle.channel)?;
    if bundle.release_notes.len() > 20_000 {
        return Err(ApiError::BadRequest(
            "releaseNotes must not exceed 20000 characters".to_string(),
        ));
    }
    if bundle.manifest_summary.codec_version != SKILL_CODEC_VERSION {
        return Err(ApiError::BadRequest(format!(
            "Skill codec version {} is not supported by this registry",
            bundle.manifest_summary.codec_version
        )));
    }
    if bundle.manifest_summary.skill_count == 0
        || bundle.manifest_summary.skills.len() != bundle.manifest_summary.skill_count
        || bundle.manifest_summary.encoded_file_count == 0
        || bundle.files.len() != bundle.manifest_summary.encoded_file_count + 1
        || bundle.files.len() > MAX_BUNDLE_FILES
    {
        return Err(ApiError::BadRequest(
            "Skill bundle file and manifest counts do not match".to_string(),
        ));
    }
    let mut names = HashSet::new();
    let mut manifest_file_found = false;
    for skill in &bundle.manifest_summary.skills {
        if !skill.skill_name.starts_with("alpha-studio-")
            || skill.relative_path != skill.skill_name
            || skill.encoded_file_count == 0
            || !names.insert(skill.skill_name.as_str())
        {
            return Err(ApiError::BadRequest(
                "Skill manifest contains an invalid or duplicate entry".to_string(),
            ));
        }
    }
    let mut paths = HashSet::new();
    let mut total_decoded_bytes = 0_usize;
    for file in &bundle.files {
        validate_bundle_path(&file.path)?;
        if !file.path.ends_with(".asx") || !paths.insert(file.path.as_str()) {
            return Err(ApiError::BadRequest(
                "Skill bundle contains a duplicate or non-.asx path".to_string(),
            ));
        }
        manifest_file_found |= file.path == "manifest.json.asx";
        let protected = STANDARD
            .decode(file.contents_base64.as_bytes())
            .map_err(|_| {
                ApiError::BadRequest(format!("Skill file {} is not valid base64", file.path))
            })?;
        total_decoded_bytes = total_decoded_bytes.saturating_add(protected.len());
        if protected.len() < ASX_MAGIC.len() + 2
            || &protected[..ASX_MAGIC.len()] != ASX_MAGIC
            || u16::from_be_bytes([protected[ASX_MAGIC.len()], protected[ASX_MAGIC.len() + 1]])
                != SKILL_CODEC_VERSION
        {
            return Err(ApiError::BadRequest(format!(
                "Skill file {} is not an Alpha Studio protected payload",
                file.path
            )));
        }
    }
    if !manifest_file_found || total_decoded_bytes > MAX_ARTIFACT_BYTES {
        return Err(ApiError::BadRequest(
            "Skill bundle is missing its protected manifest or exceeds the decoded size limit"
                .to_string(),
        ));
    }
    Ok(ValidatedBundle {
        version: bundle.version,
        channel: bundle.channel,
        min_client_version: bundle.min_client_version,
        release_notes: bundle.release_notes,
        manifest_summary: bundle.manifest_summary,
        artifact_size: artifact.len(),
    })
}

fn validate_bundle_path(path: &str) -> ApiResult<()> {
    if path.is_empty()
        || path.len() > 1_024
        || path.starts_with('/')
        || path.contains('\\')
        || path
            .split('/')
            .any(|component| component.is_empty() || component == "." || component == "..")
    {
        return Err(ApiError::BadRequest(format!(
            "Skill bundle path is unsafe: {path}"
        )));
    }
    Ok(())
}

fn validate_release_token(value: &str, label: &str) -> ApiResult<()> {
    if value.is_empty()
        || value.len() > 64
        || !value.chars().enumerate().all(|(index, character)| {
            character.is_ascii_alphanumeric() || (index > 0 && matches!(character, '.' | '_' | '-'))
        })
    {
        return Err(ApiError::BadRequest(format!(
            "{label} contains unsupported characters"
        )));
    }
    Ok(())
}

fn validate_channel(channel: &str) -> ApiResult<()> {
    if matches!(channel, "dev" | "beta" | "stable") {
        Ok(())
    } else {
        Err(ApiError::BadRequest(
            "channel must be dev, beta, or stable".to_string(),
        ))
    }
}

fn release_row_json(row: sqlx::postgres::PgRow) -> Value {
    json!({
        "id": row.get::<String, _>("id"),
        "version": row.get::<String, _>("version"),
        "channel": row.get::<String, _>("channel"),
        "status": row.get::<String, _>("status"),
        "minClientVersion": row.get::<String, _>("min_client_version"),
        "releaseNotes": row.get::<String, _>("release_notes"),
        "codecVersion": row.get::<i32, _>("codec_version"),
        "skillCount": row.get::<i32, _>("skill_count"),
        "encodedFileCount": row.get::<i32, _>("encoded_file_count"),
        "manifestSummary": row.get::<Value, _>("manifest_summary"),
        "artifactSha256": row.get::<String, _>("artifact_sha256"),
        "artifactSize": row.get::<i64, _>("artifact_size"),
        "createdAt": row.get::<chrono::DateTime<Utc>, _>("created_at"),
        "publishedAt": row.try_get::<Option<chrono::DateTime<Utc>>, _>("published_at").unwrap_or(None)
    })
}

fn is_unique_violation(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|error| error.code())
        .is_some_and(|code| code == "23505")
}

fn default_channel() -> String {
    "stable".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn protected_payload() -> String {
        let mut payload = Vec::from(ASX_MAGIC.as_slice());
        payload.extend_from_slice(&SKILL_CODEC_VERSION.to_be_bytes());
        payload.extend_from_slice(&[0; 32]);
        STANDARD.encode(payload)
    }

    fn fixture_artifact(path: &str) -> Vec<u8> {
        let manifest_skills = vec![json!({
            "skillName": "alpha-studio-fixture",
            "relativePath": "alpha-studio-fixture",
            "encodedFileCount": 1,
            "originalTotalBytes": 10
        })];
        let files = vec![
            json!({ "path": "manifest.json.asx", "contentsBase64": protected_payload() }),
            json!({ "path": path, "contentsBase64": protected_payload() }),
        ];
        serde_json::to_vec(&json!({
            "formatVersion": 1,
            "version": "1.2.3",
            "channel": "stable",
            "minClientVersion": "0.1.0",
            "manifestSummary": {
                "codecVersion": 1,
                "skillCount": manifest_skills.len(),
                "encodedFileCount": manifest_skills.len(),
                "skills": manifest_skills
            },
            "files": files
        }))
        .unwrap()
    }

    #[test]
    fn accepts_only_protected_release_files_with_safe_paths() {
        let valid = validate_bundle(&fixture_artifact("alpha-studio-fixture/SKILL.md.asx"))
            .expect("valid protected bundle");
        assert_eq!(valid.version, "1.2.3");

        let error = validate_bundle(&fixture_artifact("../escaped.asx")).unwrap_err();
        assert!(error.to_string().contains("unsafe"));
    }

    #[test]
    fn rejects_plaintext_disguised_as_an_asx_file() {
        let mut artifact: Value =
            serde_json::from_slice(&fixture_artifact("alpha-studio-fixture/SKILL.md.asx")).unwrap();
        artifact["files"][1]["contentsBase64"] = json!(STANDARD.encode(b"plaintext"));
        let error = validate_bundle(&serde_json::to_vec(&artifact).unwrap()).unwrap_err();
        assert!(error.to_string().contains("protected payload"));
    }
}
