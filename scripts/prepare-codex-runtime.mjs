import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CODEX_TARGETS = Object.freeze({
  'darwin-arm64': {
    packageSuffix: 'darwin-arm64',
    targetTriple: 'aarch64-apple-darwin',
    executableName: 'codex',
  },
  'darwin-x64': {
    packageSuffix: 'darwin-x64',
    targetTriple: 'x86_64-apple-darwin',
    executableName: 'codex',
  },
  'linux-arm64': {
    packageSuffix: 'linux-arm64',
    targetTriple: 'aarch64-unknown-linux-musl',
    executableName: 'codex',
  },
  'linux-x64': {
    packageSuffix: 'linux-x64',
    targetTriple: 'x86_64-unknown-linux-musl',
    executableName: 'codex',
  },
  'win32-arm64': {
    packageSuffix: 'win32-arm64',
    targetTriple: 'aarch64-pc-windows-msvc',
    executableName: 'codex.exe',
  },
  'win32-x64': {
    packageSuffix: 'win32-x64',
    targetTriple: 'x86_64-pc-windows-msvc',
    executableName: 'codex.exe',
  },
});

function fail(message, targetPath) {
  throw new Error(targetPath ? `${message}: ${targetPath}` : message);
}

async function pathExists(targetPath) {
  return lstat(targetPath).then(() => true, () => false);
}

async function readJson(targetPath, label) {
  try {
    return JSON.parse(await readFile(targetPath, 'utf8'));
  } catch (error) {
    fail(`${label} is missing or invalid (${error.message})`, targetPath);
  }
}

async function validateRegularTree(root) {
  const metadata = await lstat(root).catch((error) => {
    fail(`Cannot read Codex runtime (${error.message})`, root);
  });
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    fail('Codex runtime root must be a regular directory', root);
  }

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const entryMetadata = await lstat(entryPath);
      if (entryMetadata.isSymbolicLink()) {
        fail('Symbolic links are not allowed in the bundled Codex runtime', entryPath);
      }
      if (entryMetadata.isDirectory()) {
        await visit(entryPath);
      } else if (!entryMetadata.isFile()) {
        fail('Codex runtime may contain only directories and regular files', entryPath);
      }
    }
  }

  await visit(root);
}

export function resolveCodexTarget(platform = process.platform, arch = process.arch) {
  const target = CODEX_TARGETS[`${platform}-${arch}`];
  if (!target) {
    fail(`Unsupported Codex desktop target ${platform}-${arch}`);
  }
  return target;
}

export function verifyCodexExecutable(executablePath, expectedVersion) {
  const result = spawnSync(executablePath, ['--version'], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error) {
    fail(`Bundled Codex executable could not start (${result.error.message})`, executablePath);
  }
  if (result.status !== 0) {
    const detail = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    fail(`Bundled Codex executable exited with status ${result.status}${detail ? ` (${detail})` : ''}`, executablePath);
  }
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  if (!output.includes('codex-cli') || !output.includes(expectedVersion)) {
    fail(`Bundled Codex version output does not match ${expectedVersion} (${output || 'empty output'})`, executablePath);
  }
  return output.split(/\r?\n/).find((line) => line.trim())?.trim() || output;
}

async function replaceDirectoryAtomically(stagingRoot, outputRoot) {
  const backupRoot = `${outputRoot}.backup-${process.pid}`;
  await rm(backupRoot, { recursive: true, force: true });
  const hadExistingOutput = await pathExists(outputRoot);
  if (hadExistingOutput) {
    await rename(outputRoot, backupRoot);
  }
  try {
    await rename(stagingRoot, outputRoot);
    await rm(backupRoot, { recursive: true, force: true });
  } catch (error) {
    if (hadExistingOutput && !(await pathExists(outputRoot)) && await pathExists(backupRoot)) {
      await rename(backupRoot, outputRoot);
    }
    throw error;
  }
}

export async function prepareCodexRuntime({
  repositoryRoot,
  platform = process.platform,
  arch = process.arch,
  outputRoot = path.join(repositoryRoot, '.alpha-codex'),
  licensePath = path.join(repositoryRoot, 'third_party', 'codex-cli', 'LICENSE'),
  logger = console,
  verifyExecutable = verifyCodexExecutable,
}) {
  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  const target = resolveCodexTarget(platform, arch);
  const codexPackageRoot = path.join(resolvedRepositoryRoot, 'node_modules', '@openai', 'codex');
  const platformPackageRoot = path.join(
    resolvedRepositoryRoot,
    'node_modules',
    '@openai',
    `codex-${target.packageSuffix}`,
  );
  const codexPackage = await readJson(path.join(codexPackageRoot, 'package.json'), '@openai/codex package metadata');
  const platformPackage = await readJson(path.join(platformPackageRoot, 'package.json'), 'platform Codex package metadata');
  const sourceRoot = path.join(platformPackageRoot, 'vendor', target.targetTriple);
  const runtimeMetadataPath = path.join(sourceRoot, 'codex-package.json');
  const runtimeMetadata = await readJson(runtimeMetadataPath, 'Codex runtime metadata');

  if (platformPackage.version !== `${codexPackage.version}-${target.packageSuffix}`) {
    fail(`Codex platform package ${platformPackage.version} does not match pinned version ${codexPackage.version}`, platformPackageRoot);
  }
  if (
    runtimeMetadata.layoutVersion !== 1
    || runtimeMetadata.version !== codexPackage.version
    || runtimeMetadata.target !== target.targetTriple
    || runtimeMetadata.entrypoint !== `bin/${target.executableName}`
  ) {
    fail('Codex runtime metadata does not match the selected desktop target', runtimeMetadataPath);
  }

  const requiredFiles = [
    runtimeMetadataPath,
    path.join(sourceRoot, runtimeMetadata.entrypoint),
    path.join(sourceRoot, 'bin', platform === 'win32' ? 'codex-code-mode-host.exe' : 'codex-code-mode-host'),
    path.join(sourceRoot, 'codex-path', platform === 'win32' ? 'rg.exe' : 'rg'),
    licensePath,
  ];
  if (platform === 'win32') {
    requiredFiles.push(
      path.join(sourceRoot, 'codex-resources', 'codex-command-runner.exe'),
      path.join(sourceRoot, 'codex-resources', 'codex-windows-sandbox-setup.exe'),
    );
  }
  for (const requiredFile of requiredFiles) {
    const metadata = await lstat(requiredFile).catch(() => null);
    if (!metadata?.isFile() || metadata.isSymbolicLink()) {
      fail('Required bundled Codex file is missing or unsafe', requiredFile);
    }
  }
  await validateRegularTree(sourceRoot);

  const executablePath = path.join(sourceRoot, runtimeMetadata.entrypoint);
  const versionOutput = verifyExecutable(executablePath, codexPackage.version);
  const resolvedOutputRoot = path.resolve(outputRoot);
  const stagingRoot = `${resolvedOutputRoot}.staging-${process.pid}-${Date.now()}`;
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(path.dirname(stagingRoot), { recursive: true });
  try {
    await cp(sourceRoot, stagingRoot, { recursive: true, errorOnExist: true, force: false });
    await cp(licensePath, path.join(stagingRoot, 'LICENSE-CODEX-CLI.txt'), {
      errorOnExist: true,
      force: false,
    });
    await replaceDirectoryAtomically(stagingRoot, resolvedOutputRoot);
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }

  logger.log(
    `[codex:prepare] Bundled ${versionOutput} for ${target.targetTriple} at ${resolvedOutputRoot}`,
  );
  return {
    version: codexPackage.version,
    targetTriple: target.targetTriple,
    executablePath: path.join(resolvedOutputRoot, runtimeMetadata.entrypoint),
    outputRoot: resolvedOutputRoot,
  };
}

async function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(scriptDirectory, '..');
  await prepareCodexRuntime({ repositoryRoot });
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`[codex:prepare] ${error.message}`);
    process.exitCode = 1;
  });
}
