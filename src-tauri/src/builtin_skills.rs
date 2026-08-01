use crate::skill_codec::{decode_asx, CODEC_VERSION};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

pub(crate) const RESERVED_SKILL_PREFIX: &str = "alpha-studio-";
const ENCODED_SUFFIX: &str = ".asx";
const MANIFEST_FILE: &str = "manifest.json";
static STAGING_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildManifest {
    codec_version: u16,
    skill_count: usize,
    encoded_file_count: usize,
    skills: Vec<BuildManifestSkill>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildManifestSkill {
    skill_name: String,
    relative_path: String,
    encoded_file_count: usize,
    original_total_bytes: u64,
}

#[derive(Debug)]
pub(crate) struct InstalledBuiltinSkills {
    pub(crate) skill_names: Vec<String>,
    pub(crate) encoded_file_count: usize,
}

#[derive(Debug)]
struct ValidatedSkill {
    name: String,
    file_count: usize,
    total_bytes: u64,
}

fn path_is_safe_relative(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn logical_path(path: &Path) -> Result<String, String> {
    if !path_is_safe_relative(path) {
        return Err(format!("unsafe relative path {}", path.display()));
    }
    path.components()
        .map(|component| {
            component
                .as_os_str()
                .to_str()
                .map(str::to_string)
                .ok_or_else(|| format!("path is not valid UTF-8: {}", path.display()))
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|components| components.join("/"))
}

fn decoded_relative_path(encoded_relative: &Path) -> Result<PathBuf, String> {
    if !path_is_safe_relative(encoded_relative) {
        return Err(format!(
            "unsafe encoded path {}",
            encoded_relative.display()
        ));
    }
    let file_name = encoded_relative
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| {
            format!(
                "encoded filename is not valid UTF-8: {}",
                encoded_relative.display()
            )
        })?;
    let decoded_name = file_name.strip_suffix(ENCODED_SUFFIX).ok_or_else(|| {
        format!(
            "encoded file does not end in {ENCODED_SUFFIX}: {}",
            encoded_relative.display()
        )
    })?;
    if decoded_name.is_empty() {
        return Err(format!(
            "encoded file has an empty decoded name: {}",
            encoded_relative.display()
        ));
    }
    let mut decoded = encoded_relative
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default();
    decoded.push(decoded_name);
    if !path_is_safe_relative(&decoded) {
        return Err(format!("unsafe decoded path {}", decoded.display()));
    }
    Ok(decoded)
}

fn collect_encoded_files(
    encoded_root: &Path,
    directory: &Path,
    files: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let mut entries = fs::read_dir(directory)
        .map_err(|error| {
            format!(
                "Failed to read encoded Skill directory {}: {error}",
                directory.display()
            )
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read encoded Skill entry: {error}"))?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let entry_path = entry.path();
        let metadata = fs::symlink_metadata(&entry_path).map_err(|error| {
            format!(
                "Failed to inspect encoded Skill entry {}: {error}",
                entry_path.display()
            )
        })?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Encoded Skill bundle contains a forbidden symbolic link: {}",
                entry_path.display()
            ));
        }
        let relative = entry_path.strip_prefix(encoded_root).map_err(|_| {
            format!(
                "Encoded Skill entry escapes bundle root: {}",
                entry_path.display()
            )
        })?;
        if !path_is_safe_relative(relative) {
            return Err(format!(
                "Encoded Skill entry has an unsafe path: {}",
                entry_path.display()
            ));
        }
        if metadata.is_dir() {
            collect_encoded_files(encoded_root, &entry_path, files)?;
        } else if metadata.is_file() {
            if entry_path.extension().and_then(OsStr::to_str) != Some("asx") {
                return Err(format!(
                    "Encoded Skill bundle contains a non-.asx file: {}",
                    entry_path.display()
                ));
            }
            files.push(entry_path);
        } else {
            return Err(format!(
                "Encoded Skill bundle contains a non-regular entry: {}",
                entry_path.display()
            ));
        }
    }
    Ok(())
}

fn skill_label(relative: &Path) -> String {
    if relative.components().count() <= 1 {
        return "<bundle>".to_string();
    }
    relative
        .components()
        .next()
        .and_then(|component| component.as_os_str().to_str())
        .unwrap_or("<bundle>")
        .to_string()
}

fn decode_bundle_to_staging(encoded_root: &Path, staging_root: &Path) -> Result<usize, String> {
    let metadata = fs::symlink_metadata(encoded_root).map_err(|error| {
        format!(
            "Failed to locate encoded built-in Skills at {}: {error}",
            encoded_root.display()
        )
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!(
            "Encoded built-in Skills root must be a real directory: {}",
            encoded_root.display()
        ));
    }

    let mut encoded_files = Vec::new();
    collect_encoded_files(encoded_root, encoded_root, &mut encoded_files)?;
    if encoded_files.is_empty() {
        return Err(format!(
            "Encoded built-in Skills bundle contains no .asx files: {}",
            encoded_root.display()
        ));
    }

    for encoded_path in &encoded_files {
        let encoded_relative = encoded_path.strip_prefix(encoded_root).map_err(|_| {
            format!(
                "Encoded Skill file escapes bundle root: {}",
                encoded_path.display()
            )
        })?;
        let decoded_relative = decoded_relative_path(encoded_relative)?;
        let logical = logical_path(&decoded_relative)?;
        let encoded = fs::read(encoded_path).map_err(|error| {
            format!(
                "Failed to read built-in Skill `{}` file {}: {error}",
                skill_label(&decoded_relative),
                encoded_relative.display()
            )
        })?;
        let decoded = decode_asx(&encoded, &logical).map_err(|error| {
            format!(
                "Failed to decode built-in Skill `{}` file {}: {error}",
                skill_label(&decoded_relative),
                encoded_relative.display()
            )
        })?;
        let output_path = staging_root.join(&decoded_relative);
        if !output_path.starts_with(staging_root) {
            return Err(format!(
                "Decoded Skill file escapes runtime root: {}",
                decoded_relative.display()
            ));
        }
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Failed to create decoded Skill directory {}: {error}",
                    parent.display()
                )
            })?;
        }
        fs::write(&output_path, decoded).map_err(|error| {
            format!(
                "Failed to restore built-in Skill `{}` file {}: {error}",
                skill_label(&decoded_relative),
                decoded_relative.display()
            )
        })?;
    }
    Ok(encoded_files.len())
}

fn parse_frontmatter_name(contents: &str, skill_path: &Path) -> Result<String, String> {
    let contents = contents.strip_prefix('\u{feff}').unwrap_or(contents);
    let mut lines = contents.lines();
    if lines.next().map(str::trim) != Some("---") {
        return Err(format!(
            "Decoded built-in Skill must start with YAML frontmatter: {}",
            skill_path.display()
        ));
    }

    let mut names = Vec::new();
    let mut closed = false;
    for line in lines {
        if line.trim() == "---" {
            closed = true;
            break;
        }
        if line.starts_with(char::is_whitespace) {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        if key.trim() == "name" {
            names.push(value.trim().to_string());
        }
    }
    if !closed {
        return Err(format!(
            "Decoded built-in Skill frontmatter is not closed: {}",
            skill_path.display()
        ));
    }
    if names.len() != 1 {
        return Err(format!(
            "Decoded built-in Skill frontmatter must contain exactly one top-level name: {}",
            skill_path.display()
        ));
    }

    let raw = names.pop().unwrap();
    let name = if raw.starts_with('"') {
        serde_json::from_str::<String>(&raw).map_err(|error| {
            format!(
                "Decoded built-in Skill has an invalid quoted name at {}: {error}",
                skill_path.display()
            )
        })?
    } else if raw.starts_with('\'') {
        if !raw.ends_with('\'') || raw.len() < 2 {
            return Err(format!(
                "Decoded built-in Skill has an invalid quoted name: {}",
                skill_path.display()
            ));
        }
        raw[1..raw.len() - 1].replace("''", "'")
    } else {
        raw.split_once(" #")
            .map(|(value, _)| value)
            .unwrap_or(&raw)
            .trim()
            .to_string()
    };
    if name.is_empty() {
        return Err(format!(
            "Decoded built-in Skill has an empty frontmatter name: {}",
            skill_path.display()
        ));
    }
    Ok(name)
}

fn count_skill_files(skill_root: &Path, directory: &Path) -> Result<(usize, u64), String> {
    let mut count = 0;
    let mut bytes = 0;
    for entry in fs::read_dir(directory).map_err(|error| {
        format!(
            "Failed to inspect decoded Skill {}: {error}",
            directory.display()
        )
    })? {
        let entry =
            entry.map_err(|error| format!("Failed to inspect decoded Skill entry: {error}"))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            format!(
                "Failed to inspect decoded Skill file {}: {error}",
                path.display()
            )
        })?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Decoded built-in Skill contains a symbolic link: {}",
                path.display()
            ));
        }
        let relative = path
            .strip_prefix(skill_root)
            .map_err(|_| format!("Decoded Skill path escapes its root: {}", path.display()))?;
        if metadata.is_dir() {
            let (nested_count, nested_bytes) = count_skill_files(skill_root, &path)?;
            count += nested_count;
            bytes += nested_bytes;
        } else if metadata.is_file() {
            if path.file_name() == Some(OsStr::new("SKILL.md")) && relative != Path::new("SKILL.md")
            {
                return Err(format!(
                    "Decoded bundle contains a nested Skill root: {}",
                    path.display()
                ));
            }
            count += 1;
            bytes += metadata.len();
        } else {
            return Err(format!(
                "Decoded Skill contains a non-regular entry: {}",
                path.display()
            ));
        }
    }
    Ok((count, bytes))
}

fn validate_staging(staging_root: &Path) -> Result<(BuildManifest, Vec<ValidatedSkill>), String> {
    let manifest_path = staging_root.join(MANIFEST_FILE);
    let manifest_contents = fs::read_to_string(&manifest_path).map_err(|error| {
        format!(
            "Failed to read decoded Skill build manifest {}: {error}",
            manifest_path.display()
        )
    })?;
    let manifest: BuildManifest = serde_json::from_str(&manifest_contents).map_err(|error| {
        format!(
            "Failed to parse decoded Skill build manifest {}: {error}",
            manifest_path.display()
        )
    })?;
    if manifest.codec_version != CODEC_VERSION {
        return Err(format!(
            "Decoded Skill manifest codecVersion {} does not match runtime codecVersion {}",
            manifest.codec_version, CODEC_VERSION
        ));
    }

    let mut validated = Vec::new();
    let mut root_entries = fs::read_dir(staging_root)
        .map_err(|error| format!("Failed to inspect decoded Skill root: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to inspect decoded Skill root entry: {error}"))?;
    root_entries.sort_by_key(|entry| entry.file_name());
    for entry in root_entries {
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            format!(
                "Failed to inspect decoded Skill root {}: {error}",
                path.display()
            )
        })?;
        if metadata.is_file() && entry.file_name() == OsStr::new(MANIFEST_FILE) {
            continue;
        }
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(format!(
                "Unexpected entry in decoded Skill root: {}",
                path.display()
            ));
        }
        let directory_name = entry
            .file_name()
            .to_str()
            .ok_or_else(|| {
                format!(
                    "Decoded Skill directory is not valid UTF-8: {}",
                    path.display()
                )
            })?
            .to_string();
        if !directory_name.starts_with(RESERVED_SKILL_PREFIX) {
            return Err(format!(
                "Decoded built-in Skill directory must start with {RESERVED_SKILL_PREFIX}: {}",
                path.display()
            ));
        }
        let skill_definition_path = path.join("SKILL.md");
        let skill_metadata = fs::symlink_metadata(&skill_definition_path).map_err(|error| {
            format!(
                "Decoded built-in Skill is missing SKILL.md at {}: {error}",
                skill_definition_path.display()
            )
        })?;
        if skill_metadata.file_type().is_symlink() || !skill_metadata.is_file() {
            return Err(format!(
                "Decoded built-in Skill SKILL.md must be a regular file: {}",
                skill_definition_path.display()
            ));
        }
        let skill_contents = fs::read_to_string(&skill_definition_path).map_err(|error| {
            format!(
                "Failed to read decoded built-in Skill {}: {error}",
                skill_definition_path.display()
            )
        })?;
        let frontmatter_name = parse_frontmatter_name(&skill_contents, &skill_definition_path)?;
        if !frontmatter_name.starts_with(RESERVED_SKILL_PREFIX) {
            return Err(format!(
                "Decoded built-in Skill frontmatter name must start with {RESERVED_SKILL_PREFIX}: {}",
                skill_definition_path.display()
            ));
        }
        if frontmatter_name != directory_name {
            return Err(format!(
                "Decoded built-in Skill directory `{directory_name}` does not match frontmatter name `{frontmatter_name}`: {}",
                skill_definition_path.display()
            ));
        }
        let (file_count, total_bytes) = count_skill_files(&path, &path)?;
        validated.push(ValidatedSkill {
            name: frontmatter_name,
            file_count,
            total_bytes,
        });
    }
    if validated.is_empty() {
        return Err("Decoded bundle contains no alpha-studio-* built-in Skills".to_string());
    }

    let mut manifest_by_name = HashMap::new();
    for entry in &manifest.skills {
        if entry.relative_path != entry.skill_name
            || !entry.skill_name.starts_with(RESERVED_SKILL_PREFIX)
        {
            return Err(format!(
                "Invalid Skill entry in decoded build manifest: skillName=`{}`, relativePath=`{}`",
                entry.skill_name, entry.relative_path
            ));
        }
        if manifest_by_name
            .insert(entry.skill_name.as_str(), entry)
            .is_some()
        {
            return Err(format!(
                "Duplicate Skill `{}` in decoded build manifest",
                entry.skill_name
            ));
        }
    }
    if manifest.skill_count != validated.len() || manifest.skills.len() != validated.len() {
        return Err(format!(
            "Decoded Skill count does not match manifest: found {}, manifest reports {}",
            validated.len(),
            manifest.skill_count
        ));
    }
    let validated_names = validated
        .iter()
        .map(|skill| skill.name.as_str())
        .collect::<HashSet<_>>();
    if validated_names != manifest_by_name.keys().copied().collect::<HashSet<_>>() {
        return Err("Decoded Skill names do not match the build manifest".to_string());
    }
    for skill in &validated {
        let entry = manifest_by_name[skill.name.as_str()];
        if entry.encoded_file_count != skill.file_count
            || entry.original_total_bytes != skill.total_bytes
        {
            return Err(format!(
                "Decoded Skill `{}` file totals do not match the build manifest: found {} file(s)/{} byte(s), expected {} file(s)/{} byte(s)",
                skill.name,
                skill.file_count,
                skill.total_bytes,
                entry.encoded_file_count,
                entry.original_total_bytes
            ));
        }
    }
    let total_files = validated
        .iter()
        .map(|skill| skill.file_count)
        .sum::<usize>();
    if manifest.encoded_file_count != total_files {
        return Err(format!(
            "Decoded bundle file count does not match manifest: found {total_files}, manifest reports {}",
            manifest.encoded_file_count
        ));
    }
    Ok((manifest, validated))
}

fn copy_directory_contents(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|error| {
        format!(
            "Failed to create runtime Skill directory {}: {error}",
            target.display()
        )
    })?;
    for entry in fs::read_dir(source).map_err(|error| {
        format!(
            "Failed to read decoded Skill directory {}: {error}",
            source.display()
        )
    })? {
        let entry =
            entry.map_err(|error| format!("Failed to read decoded Skill entry: {error}"))?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_path).map_err(|error| {
            format!(
                "Failed to inspect decoded Skill {}: {error}",
                source_path.display()
            )
        })?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Refusing to install decoded Skill symbolic link: {}",
                source_path.display()
            ));
        }
        if metadata.is_dir() {
            copy_directory_contents(&source_path, &target_path)?;
        } else if metadata.is_file() {
            fs::copy(&source_path, &target_path).map_err(|error| {
                format!(
                    "Failed to install decoded Skill file {}: {error}",
                    source_path.display()
                )
            })?;
        } else {
            return Err(format!(
                "Refusing to install non-regular Skill entry: {}",
                source_path.display()
            ));
        }
    }
    Ok(())
}

fn remove_path(path: &Path) -> Result<(), String> {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return Ok(());
    };
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path).map_err(|error| {
            format!(
                "Failed to replace runtime Skill {}: {error}",
                path.display()
            )
        })
    } else {
        fs::remove_file(path).map_err(|error| {
            format!(
                "Failed to replace runtime Skill {}: {error}",
                path.display()
            )
        })
    }
}

pub(crate) fn install_builtin_skills(
    encoded_root: &Path,
    runtime_skills_root: &Path,
    user_skills_root: &Path,
) -> Result<InstalledBuiltinSkills, String> {
    let staging_parent = runtime_skills_root.parent().ok_or_else(|| {
        format!(
            "Runtime Skills root has no parent: {}",
            runtime_skills_root.display()
        )
    })?;
    let staging_root = staging_parent.join(format!(
        ".builtin-skills-staging-{}-{}",
        std::process::id(),
        STAGING_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    remove_path(&staging_root)?;
    fs::create_dir(&staging_root)
        .map_err(|error| format!("Failed to create Skill decode staging directory: {error}"))?;

    let result = (|| {
        let decoded_file_count = decode_bundle_to_staging(encoded_root, &staging_root)?;
        let (manifest, validated) = validate_staging(&staging_root)?;
        debug_assert_eq!(decoded_file_count, manifest.encoded_file_count + 1);

        for skill in &validated {
            let user_skill_path = user_skills_root.join(&skill.name);
            if user_skill_path.exists() {
                eprintln!(
                    "[Alpha Studio] Warning: built-in Skill `{}` takes precedence over the user Skill at {}",
                    skill.name,
                    user_skill_path.display()
                );
            }
            let installed_path = runtime_skills_root.join(&skill.name);
            if !installed_path.starts_with(runtime_skills_root) {
                return Err(format!(
                    "Runtime Skill path escapes its root: {}",
                    installed_path.display()
                ));
            }
            remove_path(&installed_path)?;
            copy_directory_contents(&staging_root.join(&skill.name), &installed_path)?;
        }

        let skill_names = validated
            .into_iter()
            .map(|skill| skill.name)
            .collect::<Vec<_>>();
        eprintln!(
            "[Alpha Studio] Decoded and validated {} built-in Skill(s), {} file(s), into {}",
            skill_names.len(),
            manifest.encoded_file_count,
            runtime_skills_root.display()
        );
        Ok(InstalledBuiltinSkills {
            skill_names,
            encoded_file_count: manifest.encoded_file_count,
        })
    })();

    let cleanup_result = fs::remove_dir_all(&staging_root).map_err(|error| {
        format!(
            "Failed to remove Skill decode staging directory {}: {error}",
            staging_root.display()
        )
    });
    match (result, cleanup_result) {
        (Err(error), _) => Err(error),
        (Ok(_), Err(error)) => Err(error),
        (Ok(summary), Ok(())) => Ok(summary),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skill_codec::encode_asx_for_test;
    use serde_json::json;

    fn fixture_name(suffix: &str) -> String {
        format!("{RESERVED_SKILL_PREFIX}fixture-{suffix}")
    }

    fn write_encoded_file(root: &Path, logical_path: &str, contents: &[u8], seed: u8) {
        let encoded_path = root.join(format!("{logical_path}{ENCODED_SUFFIX}"));
        fs::create_dir_all(encoded_path.parent().unwrap()).unwrap();
        fs::write(
            encoded_path,
            encode_asx_for_test(contents, logical_path, seed),
        )
        .unwrap();
    }

    fn write_fixture_bundle(root: &Path, skills: &[(&str, Vec<(&str, &[u8])>)]) {
        fs::create_dir_all(root).unwrap();
        let mut manifest_skills = Vec::new();
        let mut total_files = 0;
        let mut seed = 1;
        for (name, files) in skills {
            let mut skill_files = vec![(
                "SKILL.md",
                format!("---\nname: {name}\ndescription: fixture\n---\n").into_bytes(),
            )];
            skill_files.extend(
                files
                    .iter()
                    .map(|(relative, contents)| (*relative, contents.to_vec())),
            );
            let total_bytes = skill_files
                .iter()
                .map(|(_, contents)| contents.len() as u64)
                .sum::<u64>();
            for (relative, contents) in &skill_files {
                let logical = format!("{name}/{relative}");
                write_encoded_file(root, &logical, contents, seed);
                seed = seed.wrapping_add(1);
            }
            total_files += skill_files.len();
            manifest_skills.push(json!({
                "skillName": name,
                "relativePath": name,
                "encodedFileCount": skill_files.len(),
                "originalTotalBytes": total_bytes,
            }));
        }
        let manifest = format!(
            "{}\n",
            serde_json::to_string_pretty(&json!({
                "codecVersion": CODEC_VERSION,
                "skillCount": skills.len(),
                "encodedFileCount": total_files,
                "skills": manifest_skills,
            }))
            .unwrap()
        );
        write_encoded_file(root, MANIFEST_FILE, manifest.as_bytes(), seed);
    }

    fn temp_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "alpha-studio-builtin-skill-{label}-{}-{}",
            std::process::id(),
            STAGING_COUNTER.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn installs_all_discovered_skills_and_preserves_unrelated_user_skills() {
        let root = temp_root("install");
        let encoded = root.join("encoded");
        let users = root.join("users");
        let runtime = root.join("runtime");
        let first = fixture_name("one");
        let second = fixture_name("two");
        write_fixture_bundle(
            &encoded,
            &[
                (&first, vec![("scripts/run.py", b"one")]),
                (&second, vec![("assets/data.txt", b"two")]),
            ],
        );
        fs::create_dir_all(users.join("user-fixture")).unwrap();
        fs::create_dir_all(&runtime).unwrap();
        fs::write(runtime.join("keep.txt"), "keep").unwrap();

        let installed = install_builtin_skills(&encoded, &runtime, &users).unwrap();

        assert_eq!(installed.skill_names, vec![first.clone(), second.clone()]);
        assert_eq!(installed.encoded_file_count, 4);
        assert!(runtime.join(&first).join("scripts/run.py").is_file());
        assert!(runtime.join(&second).join("assets/data.txt").is_file());
        assert_eq!(
            fs::read_to_string(runtime.join("keep.txt")).unwrap(),
            "keep"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_corrupt_file_reports_its_dynamic_skill_name_and_path() {
        let root = temp_root("corrupt");
        let encoded = root.join("encoded");
        let users = root.join("users");
        let runtime = root.join("runtime");
        let skill = fixture_name("corrupt");
        write_fixture_bundle(&encoded, &[(&skill, vec![("notes.txt", b"fixture")])]);
        let corrupt_path = encoded.join(&skill).join("notes.txt.asx");
        let mut corrupt = fs::read(&corrupt_path).unwrap();
        *corrupt.last_mut().unwrap() ^= 0xff;
        fs::write(&corrupt_path, corrupt).unwrap();
        fs::create_dir_all(&users).unwrap();
        fs::create_dir_all(&runtime).unwrap();

        let error = install_builtin_skills(&encoded, &runtime, &users).unwrap_err();

        assert!(error.contains(&skill), "{error}");
        assert!(error.contains("notes.txt.asx"), "{error}");
        assert!(error.contains("authentication failed"), "{error}");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_directory_and_frontmatter_name_mismatches_after_decode() {
        let root = temp_root("mismatch");
        let encoded = root.join("encoded");
        let users = root.join("users");
        let runtime = root.join("runtime");
        let directory_name = fixture_name("directory");
        let frontmatter_name = fixture_name("frontmatter");
        write_fixture_bundle(&encoded, &[(&directory_name, vec![])]);
        let logical = format!("{directory_name}/SKILL.md");
        let contents = format!("---\nname: {frontmatter_name}\n---\n");
        write_encoded_file(&encoded, &logical, contents.as_bytes(), 91);
        fs::create_dir_all(&users).unwrap();
        fs::create_dir_all(&runtime).unwrap();

        let error = install_builtin_skills(&encoded, &runtime, &users).unwrap_err();

        assert!(error.contains(&directory_name), "{error}");
        assert!(error.contains(&frontmatter_name), "{error}");
        assert!(error.contains("SKILL.md"), "{error}");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn built_in_copy_replaces_only_a_conflicting_reserved_user_copy() {
        let root = temp_root("collision");
        let encoded = root.join("encoded");
        let users = root.join("users");
        let runtime = root.join("runtime");
        let skill = fixture_name("collision");
        write_fixture_bundle(&encoded, &[(&skill, vec![("origin.txt", b"built-in")])]);
        fs::create_dir_all(users.join(&skill)).unwrap();
        fs::create_dir_all(runtime.join(&skill)).unwrap();
        fs::write(runtime.join(&skill).join("origin.txt"), "user").unwrap();
        fs::create_dir_all(runtime.join("user-fixture")).unwrap();
        fs::write(runtime.join("user-fixture").join("SKILL.md"), "user").unwrap();

        install_builtin_skills(&encoded, &runtime, &users).unwrap();

        assert_eq!(
            fs::read_to_string(runtime.join(&skill).join("origin.txt")).unwrap(),
            "built-in"
        );
        assert!(runtime.join("user-fixture").join("SKILL.md").is_file());
        let _ = fs::remove_dir_all(root);
    }
}
