use std::path::PathBuf;
use std::process::Command;

fn main() {
    let manifest_dir =
        PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is required"));
    let repository_root = manifest_dir
        .parent()
        .expect("src-tauri must be inside the repository root");
    let encoder = repository_root.join("scripts").join("encode-skills.mjs");
    let skills_root = repository_root.join("skills");

    println!("cargo:rerun-if-changed={}", encoder.display());
    println!("cargo:rerun-if-changed={}", skills_root.display());

    let output = Command::new("node")
        .arg(&encoder)
        .current_dir(repository_root)
        .output()
        .unwrap_or_else(|error| panic!("failed to start built-in Skill encoder: {error}"));
    if !output.status.success() {
        panic!(
            "built-in Skill encoding failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        println!("cargo:warning={line}");
    }

    tauri_build::build();
}
