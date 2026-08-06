import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareCodexRuntime, resolveCodexTarget } from './prepare-codex-runtime.mjs';

async function createFixture({ platform = 'darwin', arch = 'arm64', version = '1.2.3' } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'alpha-codex-runtime-'));
  const target = resolveCodexTarget(platform, arch);
  const codexPackageRoot = path.join(root, 'node_modules', '@openai', 'codex');
  const platformPackageRoot = path.join(root, 'node_modules', '@openai', `codex-${target.packageSuffix}`);
  const sourceRoot = path.join(platformPackageRoot, 'vendor', target.targetTriple);
  const executableName = target.executableName;
  const hostName = platform === 'win32' ? 'codex-code-mode-host.exe' : 'codex-code-mode-host';
  const rgName = platform === 'win32' ? 'rg.exe' : 'rg';
  await mkdir(codexPackageRoot, { recursive: true });
  await mkdir(path.join(sourceRoot, 'bin'), { recursive: true });
  await mkdir(path.join(sourceRoot, 'codex-path'), { recursive: true });
  await writeFile(path.join(codexPackageRoot, 'package.json'), JSON.stringify({ version }));
  await writeFile(
    path.join(platformPackageRoot, 'package.json'),
    JSON.stringify({ version: `${version}-${target.packageSuffix}` }),
  );
  await writeFile(
    path.join(sourceRoot, 'codex-package.json'),
    JSON.stringify({
      layoutVersion: 1,
      version,
      target: target.targetTriple,
      entrypoint: `bin/${executableName}`,
      resourcesDir: 'codex-resources',
      pathDir: 'codex-path',
    }),
  );
  await writeFile(path.join(sourceRoot, 'bin', executableName), 'codex');
  await writeFile(path.join(sourceRoot, 'bin', hostName), 'host');
  await writeFile(path.join(sourceRoot, 'codex-path', rgName), 'rg');
  if (platform === 'win32') {
    await mkdir(path.join(sourceRoot, 'codex-resources'), { recursive: true });
    await writeFile(path.join(sourceRoot, 'codex-resources', 'codex-command-runner.exe'), 'runner');
    await writeFile(path.join(sourceRoot, 'codex-resources', 'codex-windows-sandbox-setup.exe'), 'setup');
  }
  const licensePath = path.join(root, 'third_party', 'codex-cli', 'LICENSE');
  await mkdir(path.dirname(licensePath), { recursive: true });
  await writeFile(licensePath, 'Apache License 2.0');
  return { root, sourceRoot, licensePath, target, version };
}

test('maps every supported desktop host to the official Codex target triple', () => {
  assert.equal(resolveCodexTarget('darwin', 'arm64').targetTriple, 'aarch64-apple-darwin');
  assert.equal(resolveCodexTarget('darwin', 'x64').targetTriple, 'x86_64-apple-darwin');
  assert.equal(resolveCodexTarget('win32', 'x64').targetTriple, 'x86_64-pc-windows-msvc');
  assert.equal(resolveCodexTarget('linux', 'arm64').targetTriple, 'aarch64-unknown-linux-musl');
  assert.throws(() => resolveCodexTarget('freebsd', 'x64'), /Unsupported Codex desktop target/);
});

test('copies the complete package layout and replaces stale generated output', async () => {
  const fixture = await createFixture();
  const outputRoot = path.join(fixture.root, '.alpha-codex');
  await mkdir(outputRoot);
  await writeFile(path.join(outputRoot, 'stale.txt'), 'stale');

  const result = await prepareCodexRuntime({
    repositoryRoot: fixture.root,
    platform: 'darwin',
    arch: 'arm64',
    outputRoot,
    licensePath: fixture.licensePath,
    verifyExecutable: () => `codex-cli ${fixture.version}`,
    logger: { log: () => undefined },
  });

  assert.equal(result.version, fixture.version);
  assert.equal(await readFile(path.join(outputRoot, 'bin', 'codex'), 'utf8'), 'codex');
  assert.equal(await readFile(path.join(outputRoot, 'codex-path', 'rg'), 'utf8'), 'rg');
  assert.equal(await readFile(path.join(outputRoot, 'LICENSE-CODEX-CLI.txt'), 'utf8'), 'Apache License 2.0');
  await assert.rejects(readFile(path.join(outputRoot, 'stale.txt'), 'utf8'));
});

test('requires Windows sandbox helpers before producing an MSI runtime', async () => {
  const fixture = await createFixture({ platform: 'win32', arch: 'x64' });
  await writeFile(
    path.join(fixture.sourceRoot, 'codex-resources', 'codex-command-runner.exe'),
    '',
  );
  const missingHelper = path.join(fixture.sourceRoot, 'codex-resources', 'codex-windows-sandbox-setup.exe');
  const renamedHelper = `${missingHelper}.missing`;
  await rename(missingHelper, renamedHelper);

  await assert.rejects(
    prepareCodexRuntime({
      repositoryRoot: fixture.root,
      platform: 'win32',
      arch: 'x64',
      licensePath: fixture.licensePath,
      verifyExecutable: () => `codex-cli ${fixture.version}`,
      logger: { log: () => undefined },
    }),
    (error) => error.message.includes('Required bundled Codex file') && error.message.includes('codex-windows-sandbox-setup.exe'),
  );
});

test('rejects symbolic links in the platform runtime', async (context) => {
  if (process.platform === 'win32') {
    return context.skip('Symbolic-link creation is permission-dependent on Windows');
  }
  const fixture = await createFixture();
  await symlink(
    path.join(fixture.sourceRoot, 'bin', 'codex'),
    path.join(fixture.sourceRoot, 'linked-codex'),
  );
  await assert.rejects(
    prepareCodexRuntime({
      repositoryRoot: fixture.root,
      platform: 'darwin',
      arch: 'arm64',
      licensePath: fixture.licensePath,
      verifyExecutable: () => `codex-cli ${fixture.version}`,
      logger: { log: () => undefined },
    }),
    /Symbolic links are not allowed/,
  );
});
