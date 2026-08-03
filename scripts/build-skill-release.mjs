import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { encodeDiscoveredSkills } from './encode-skills.mjs';

export const SKILL_BUNDLE_FORMAT_VERSION = 1;

function fail(message, targetPath) {
  throw new Error(targetPath ? `${message}: ${targetPath}` : message);
}

function validateReleaseToken(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
    fail(`${label} must contain 1-64 letters, digits, dots, underscores, or hyphens`);
  }
  return value;
}

function safeRelativePath(relativePath) {
  if (
    typeof relativePath !== 'string'
    || relativePath.length === 0
    || relativePath.includes('\\')
    || path.posix.isAbsolute(relativePath)
    || relativePath.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    fail('Encoded Skill bundle contains an unsafe path', relativePath);
  }
  return relativePath;
}

async function collectEncodedFiles(encodedRoot) {
  const files = [];

  async function visit(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) {
        fail('Symbolic links are not allowed in encoded Skill releases', absolutePath);
      }
      const relativePath = safeRelativePath(prefix ? `${prefix}/${entry.name}` : entry.name);
      if (metadata.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (metadata.isFile() && entry.name.endsWith('.asx')) {
        files.push({
          path: relativePath,
          contentsBase64: (await readFile(absolutePath)).toString('base64'),
        });
      } else {
        fail('Encoded Skill releases may contain only directories and .asx files', absolutePath);
      }
    }
  }

  await visit(encodedRoot);
  return files;
}

export async function buildSkillRelease({
  repositoryRoot,
  version,
  channel = 'stable',
  minClientVersion,
  releaseNotes = '',
  outputPath,
  logger = console,
}) {
  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  const safeVersion = validateReleaseToken(version, 'version');
  const safeChannel = validateReleaseToken(channel, 'channel');
  if (!['dev', 'beta', 'stable'].includes(safeChannel)) {
    fail('channel must be dev, beta, or stable');
  }
  const safeMinClientVersion = validateReleaseToken(minClientVersion, 'minClientVersion');
  const encodedRoot = path.join(resolvedRepositoryRoot, '.alpha-encoded');
  const manifestSummary = await encodeDiscoveredSkills({
    skillsRoot: path.join(resolvedRepositoryRoot, 'skills'),
    outputRoot: encodedRoot,
    logger,
  });
  const files = await collectEncodedFiles(encodedRoot);
  if (!files.some((file) => file.path === 'manifest.json.asx')) {
    fail('Encoded Skill release is missing manifest.json.asx', encodedRoot);
  }
  if (files.length !== manifestSummary.encodedFileCount + 1) {
    fail('Encoded file count does not match the protected build manifest', encodedRoot);
  }

  const bundle = {
    formatVersion: SKILL_BUNDLE_FORMAT_VERSION,
    version: safeVersion,
    channel: safeChannel,
    minClientVersion: safeMinClientVersion,
    createdAt: new Date().toISOString(),
    releaseNotes: String(releaseNotes || ''),
    manifestSummary,
    files,
  };
  const contents = Buffer.from(`${JSON.stringify(bundle)}\n`, 'utf8');
  const resolvedOutputPath = path.resolve(outputPath);
  await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, contents, { flag: 'wx' });
  const sha256 = createHash('sha256').update(contents).digest('hex');
  logger.log(
    `[skills:release] Built ${safeChannel} release ${safeVersion}: ${files.length} protected file(s), ${contents.length} bytes, sha256 ${sha256}`,
  );
  logger.log(`[skills:release] Upload artifact: ${resolvedOutputPath}`);
  return { bundle, outputPath: resolvedOutputPath, sha256, artifactSize: contents.length };
}

function argumentValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(scriptDirectory, '..');
  const packageMetadata = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const version = argumentValue('version') || packageMetadata.version;
  const channel = argumentValue('channel') || 'stable';
  const minClientVersion = argumentValue('min-client-version') || packageMetadata.version;
  const releaseNotes = argumentValue('notes') || '';
  const outputPath = argumentValue('output') || path.join(
    repositoryRoot,
    '.alpha-releases',
    `alpha-studio-skills-${version}-${channel}.asb.json`,
  );
  await buildSkillRelease({
    repositoryRoot,
    version,
    channel,
    minClientVersion,
    releaseNotes,
    outputPath,
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`[skills:release] ${error.message}`);
    process.exitCode = 1;
  });
}
