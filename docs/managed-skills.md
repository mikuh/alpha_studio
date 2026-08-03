# Managed Skill releases

Alpha Studio keeps official Skill source and its presentation catalog in `skills/` and Git. Protected official Skills live as `skills/alpha-studio-*`. Production clients install immutable release artifacts from the backend registry; the server never receives plaintext Skill source.

`skills/catalog.json` must contain exactly one matching `official` entry for every protected Skill directory. Encoding fails on missing, stale, duplicate, or non-official entries.

System Skills are supplied by the Codex/plugin runtime. Personal and recommended Skills are managed separately. None of these categories is copied into `skills/`, `.alpha-encoded`, or a managed Skill release, and none passes through Alpha Studio's codec.

## Build and publish

1. Edit and review Skill source together with the application code.
2. Build an upload artifact:

   ```bash
   npm run skills:release -- --version=1.2.3 --channel=stable --min-client-version=0.1.0 --notes="release notes"
   ```

   The generated file is written under `.alpha-releases/`, which is ignored by Git. Every contained Skill file is still an AES-256-GCM authenticated `.asx` payload whose authentication data binds it to its logical path.

3. Open `/admin/skills`, upload the `.asb.json` file, and inspect the draft metadata.
4. Publish the draft. Publishing archives the previously active release in the same `dev`, `beta`, or `stable` channel.
5. To roll back, publish an archived version again. Release rows and their artifact checksums are immutable.

## Client behavior

At every desktop startup, before GPT authorization or the first chat, the client decodes and validates the bundled official release into `~/.alpha-studio/codex-home/skills/alpha-studio-*`. A same-named personal copy is replaced only inside the regenerated Alpha Studio runtime, while the user's source under `~/.codex/skills` remains untouched.

After device activation or lease refresh, the desktop client requests the `stable` catalog with its signed device token. A new artifact becomes active only after all of these checks pass:

- HTTPS/API authorization and catalog metadata validation;
- exact artifact byte length and SHA-256 checksum;
- safe relative paths with no traversal or duplicate entries;
- `.asx` magic and codec-version checks;
- AES-GCM authentication bound to every logical file path;
- protected manifest, official Skill path/name, file-count, and original-byte-count validation.

The encoded artifact is cached under `~/.alpha-studio/managed-skills`. If network access, download, authentication, decoding, or validation fails, the client keeps the last authenticated managed release. If no managed release has ever been installed, it uses the protected bundle shipped in the application.

Debug builds deliberately prefer the repository-generated `.alpha-encoded` directory, so development follows the checked-out code version even when a managed release is cached.

## API surface

- `GET/POST /api/admin/skill-releases`
- `POST /api/admin/skill-releases/:id/publish`
- `DELETE /api/admin/skill-releases/:id`
- `GET /api/client/skills/catalog`
- `GET /api/client/skills/releases/:id/download`

Admin routes require the admin JWT. Client routes require a valid signed device token whose tenant, device, user, and fingerprint still match an active lease.
