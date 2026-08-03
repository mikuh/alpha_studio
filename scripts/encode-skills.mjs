import { createCipheriv, randomBytes } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RESERVED_SKILL_PREFIX = 'alpha-studio-';
export const CODEC_VERSION = 1;

const CODEC_MAGIC = Buffer.from('ALPHASX1', 'ascii');
const CODEC_KEY = Buffer.from(
  '79f284bfd3dc346f7d5e9a756c4d45b508783e7924143059b7c1b27d4598a74c',
  'hex',
);
const NONCE_BYTES = 12;

function fail(message, targetPath) {
  const suffix = targetPath ? `: ${targetPath}` : '';
  throw new Error(`${message}${suffix}`);
}

function decodeYamlScalar(value, skillPath) {
  const trimmed = value.trim();
  if (!trimmed) {
    fail('SKILL.md frontmatter has an empty name', skillPath);
  }
  if (trimmed.startsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== 'string') {
        fail('SKILL.md frontmatter name must be a string', skillPath);
      }
      return parsed;
    } catch (error) {
      fail(`SKILL.md frontmatter has an invalid quoted name (${error.message})`, skillPath);
    }
  }
  if (trimmed.startsWith("'")) {
    if (!trimmed.endsWith("'") || trimmed.length < 2) {
      fail('SKILL.md frontmatter has an invalid quoted name', skillPath);
    }
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (/\s+#/.test(trimmed)) {
    return trimmed.replace(/\s+#.*$/, '').trim();
  }
  return trimmed;
}

export function parseSkillFrontmatterName(contents, skillPath = 'SKILL.md') {
  const normalized = contents.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  const lines = normalized.split('\n');
  if (lines[0]?.trim() !== '---') {
    fail('SKILL.md must start with YAML frontmatter', skillPath);
  }
  const end = lines.slice(1).findIndex((line) => line.trim() === '---');
  if (end < 0) {
    fail('SKILL.md frontmatter is not closed', skillPath);
  }
  const nameLines = lines
    .slice(1, end + 1)
    .filter((line) => /^name\s*:/.test(line));
  if (nameLines.length !== 1) {
    fail('SKILL.md frontmatter must contain exactly one top-level name', skillPath);
  }
  return decodeYamlScalar(nameLines[0].replace(/^name\s*:/, ''), skillPath);
}

function safeRelativePath(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    fail(`${label} escapes its expected root`, candidate);
  }
  return relative;
}

async function collectRegularFiles(skillRoot, canonicalSkillRoot) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const metadata = await lstat(entryPath);
      if (metadata.isSymbolicLink()) {
        fail('Symbolic links are not allowed in built-in Skills', entryPath);
      }
      safeRelativePath(skillRoot, entryPath, 'Skill entry');
      const resolvedEntry = await realpath(entryPath);
      safeRelativePath(canonicalSkillRoot, resolvedEntry, 'Resolved Skill entry');

      if (metadata.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      if (!metadata.isFile()) {
        fail('Only directories and regular files are allowed in built-in Skills', entryPath);
      }

      const relativePath = path.relative(skillRoot, entryPath);
      if (path.basename(entryPath) === 'SKILL.md' && relativePath !== 'SKILL.md') {
        fail('Nested Skill roots are not allowed', entryPath);
      }
      files.push({ absolutePath: entryPath, relativePath });
    }
  }

  await visit(skillRoot);
  return files;
}

export async function discoverAlphaStudioSkills(skillsRoot) {
  const rootMetadata = await lstat(skillsRoot).catch((error) => {
    fail(`Cannot read skills directory (${error.message})`, skillsRoot);
  });
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    fail('skills root must be a real directory, not a symbolic link', skillsRoot);
  }
  const canonicalSkillsRoot = await realpath(skillsRoot);
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));

  const discovered = [];
  for (const entry of entries) {
    if (!entry.name.startsWith(RESERVED_SKILL_PREFIX)) {
      continue;
    }
    const skillRoot = path.join(skillsRoot, entry.name);
    const metadata = await lstat(skillRoot);
    if (metadata.isSymbolicLink()) {
      fail('Built-in Skill roots cannot be symbolic links', skillRoot);
    }
    if (!metadata.isDirectory()) {
      fail('Alpha Studio built-in Skill entries must be directories', skillRoot);
    }
    const canonicalSkillRoot = await realpath(skillRoot);
    safeRelativePath(canonicalSkillsRoot, canonicalSkillRoot, 'Built-in Skill root');

    const skillDefinitionPath = path.join(skillRoot, 'SKILL.md');
    const skillDefinitionMetadata = await lstat(skillDefinitionPath).catch(() => {
      fail('Built-in Skill is missing its root SKILL.md', skillDefinitionPath);
    });
    if (skillDefinitionMetadata.isSymbolicLink() || !skillDefinitionMetadata.isFile()) {
      fail('Built-in Skill SKILL.md must be a regular file', skillDefinitionPath);
    }
    const skillDefinition = await readFile(skillDefinitionPath, 'utf8');
    const frontmatterName = parseSkillFrontmatterName(skillDefinition, skillDefinitionPath);
    if (!frontmatterName.startsWith(RESERVED_SKILL_PREFIX)) {
      fail(
        `Official SKILL.md frontmatter name must start with ${RESERVED_SKILL_PREFIX}`,
        skillDefinitionPath,
      );
    }
    if (frontmatterName !== entry.name) {
      fail(
        `Built-in Skill directory name "${entry.name}" does not match frontmatter name "${frontmatterName}"`,
        skillDefinitionPath,
      );
    }

    discovered.push({
      skillName: frontmatterName,
      relativePath: entry.name,
      absolutePath: skillRoot,
      files: await collectRegularFiles(skillRoot, canonicalSkillRoot),
    });
  }

  if (discovered.length === 0) {
    fail('No official Alpha Studio Skills were discovered', skillsRoot);
  }
  return discovered;
}

export async function loadOfficialSkillCatalog(skillsRoot, discoveredSkills) {
  const catalogPath = path.join(skillsRoot, 'catalog.json');
  let parsed;
  try {
    parsed = JSON.parse(await readFile(catalogPath, 'utf8'));
  } catch (error) {
    fail(`Cannot read protected Skill catalog (${error.message})`, catalogPath);
  }
  if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.skills)) {
    fail('Protected Skill catalog must use schemaVersion 1 and contain a skills array', catalogPath);
  }

  const catalogById = new Map();
  for (const entry of parsed.skills) {
    if (!entry || typeof entry !== 'object') {
      fail('Protected Skill catalog entries must be objects', catalogPath);
    }
    const requiredStrings = ['id', 'category', 'title', 'description', 'icon', 'overview'];
    for (const field of requiredStrings) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) {
        fail(`Protected Skill catalog entry has an invalid ${field}`, catalogPath);
      }
    }
    if (entry.category !== 'official'
      || !entry.id.startsWith(RESERVED_SKILL_PREFIX)
      || catalogById.has(entry.id)) {
      fail(`Protected Skill catalog contains an invalid or duplicate id "${entry.id}"`, catalogPath);
    }
    if (entry.workflow != null && (typeof entry.workflow !== 'string' || !entry.workflow.trim())) {
      fail(`Protected Skill catalog entry has an invalid workflow for "${entry.id}"`, catalogPath);
    }
    catalogById.set(entry.id, entry);
  }

  const discoveredNames = new Set(discoveredSkills.map((skill) => skill.skillName));
  const missing = [...discoveredNames].filter((name) => !catalogById.has(name));
  const stale = [...catalogById.keys()].filter((name) => !discoveredNames.has(name));
  if (missing.length || stale.length) {
    fail(
      `Protected Skill catalog does not match repository Skills (missing: ${missing.join(', ') || 'none'}; stale: ${stale.join(', ') || 'none'})`,
      catalogPath,
    );
  }
  return parsed;
}

function codecAad(logicalPath) {
  return Buffer.from(`alpha-studio-skill:${CODEC_VERSION}:${logicalPath}`, 'utf8');
}

export function encodeAsx(contents, logicalPath, nonce = randomBytes(NONCE_BYTES)) {
  if (!Buffer.isBuffer(contents)) {
    contents = Buffer.from(contents);
  }
  if (!Buffer.isBuffer(nonce) || nonce.length !== NONCE_BYTES) {
    throw new Error(`Codec nonce must contain ${NONCE_BYTES} bytes`);
  }
  const cipher = createCipheriv('aes-256-gcm', CODEC_KEY, nonce);
  cipher.setAAD(codecAad(logicalPath));
  const ciphertext = Buffer.concat([cipher.update(contents), cipher.final()]);
  const version = Buffer.alloc(2);
  version.writeUInt16BE(CODEC_VERSION);
  return Buffer.concat([
    CODEC_MAGIC,
    version,
    nonce,
    ciphertext,
    cipher.getAuthTag(),
  ]);
}

function toLogicalPath(...parts) {
  return parts.join('/');
}

async function replaceDirectoryAtomically(stagingRoot, outputRoot) {
  const resolvedOutput = path.resolve(outputRoot);
  const parsed = path.parse(resolvedOutput);
  if (resolvedOutput === parsed.root) {
    fail('Refusing to replace a filesystem root', resolvedOutput);
  }
  await rm(outputRoot, { recursive: true, force: true });
  await rename(stagingRoot, outputRoot);
}

export async function encodeDiscoveredSkills({ skillsRoot, outputRoot, logger = console }) {
  const resolvedSkillsRoot = path.resolve(skillsRoot);
  const resolvedOutputRoot = path.resolve(outputRoot);
  if (resolvedSkillsRoot === resolvedOutputRoot) {
    fail('Encoded output cannot overwrite the source skills directory', outputRoot);
  }

  const skills = await discoverAlphaStudioSkills(resolvedSkillsRoot);
  const catalog = await loadOfficialSkillCatalog(resolvedSkillsRoot, skills);
  const stagingRoot = `${resolvedOutputRoot}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  await mkdir(stagingRoot, { recursive: false });

  try {
    const manifestSkills = [];
    for (const skill of skills) {
      let originalTotalBytes = 0;
      for (const file of skill.files) {
        const contents = await readFile(file.absolutePath);
        originalTotalBytes += contents.length;
        const sourceRelativePath = file.relativePath.split(path.sep).join('/');
        const logicalPath = toLogicalPath(skill.relativePath, sourceRelativePath);
        const encodedPath = path.join(stagingRoot, ...logicalPath.split('/')) + '.asx';
        safeRelativePath(stagingRoot, encodedPath, 'Encoded output');
        await mkdir(path.dirname(encodedPath), { recursive: true });
        await writeFile(encodedPath, encodeAsx(contents, logicalPath), { flag: 'wx' });
      }
      manifestSkills.push({
        skillName: skill.skillName,
        relativePath: skill.relativePath,
        encodedFileCount: skill.files.length,
        originalTotalBytes,
      });
    }

    const manifest = {
      codecVersion: CODEC_VERSION,
      skillCount: manifestSkills.length,
      encodedFileCount: manifestSkills.reduce(
        (total, skill) => total + skill.encodedFileCount,
        0,
      ),
      skills: manifestSkills,
      catalog,
    };
    const manifestContents = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const manifestLogicalPath = 'manifest.json';
    await writeFile(
      path.join(stagingRoot, `${manifestLogicalPath}.asx`),
      encodeAsx(manifestContents, manifestLogicalPath),
      { flag: 'wx' },
    );

    await replaceDirectoryAtomically(stagingRoot, resolvedOutputRoot);
    logger.log(
      `[skills:encode] Auto-discovered and encoded ${skills.length} official Skill(s): ${skills
        .map((skill) => skill.skillName)
        .join(', ')}`,
    );
    logger.log(
      `[skills:encode] Encoded ${manifest.encodedFileCount} file(s) into ${resolvedOutputRoot}`,
    );
    return manifest;
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(scriptDirectory, '..');
  await encodeDiscoveredSkills({
    skillsRoot: path.join(repositoryRoot, 'skills'),
    outputRoot: path.join(repositoryRoot, '.alpha-encoded'),
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`[skills:encode] ${error.message}`);
    process.exitCode = 1;
  });
}
