import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  discoverAlphaStudioSkills,
  encodeDiscoveredSkills,
  loadOfficialSkillCatalog,
  RESERVED_SKILL_PREFIX,
} from './encode-skills.mjs';
import { buildSkillRelease } from './build-skill-release.mjs';

function fixtureName(suffix) {
  return `${RESERVED_SKILL_PREFIX}fixture-${suffix}`;
}

async function createSkill(skillsRoot, name, files = {}) {
  const root = path.join(skillsRoot, name);
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, 'SKILL.md'),
    `---\nname: ${name}\ndescription: fixture\n---\n\n# Fixture\n`,
  );
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  return root;
}

async function tempWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'alpha-skill-codec-'));
  const skillsRoot = path.join(root, 'skills');
  await mkdir(skillsRoot);
  return { root, skillsRoot, outputRoot: path.join(root, '.alpha-encoded') };
}

async function writeCatalog(skillsRoot, skillNames) {
  await writeFile(
    path.join(skillsRoot, 'catalog.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      skills: skillNames.map((id) => ({
        id,
        category: 'official',
        title: id,
        description: `${id} description`,
        icon: 'skill',
        overview: `${id} overview`,
      })),
    }, null, 2)}\n`,
  );
}

test('discovers every reserved Skill and recursively encodes only regular files', async () => {
  const { skillsRoot, outputRoot } = await tempWorkspace();
  const first = fixtureName('one');
  const second = fixtureName('two');
  await createSkill(skillsRoot, first, { 'scripts/run.py': 'print("one")\n' });
  await createSkill(skillsRoot, second, { 'assets/data.bin': Buffer.from([0, 1, 2, 3]) });
  await createSkill(skillsRoot, 'user-fixture', { 'private.txt': 'not bundled' });
  await writeCatalog(skillsRoot, [first, second]);

  const messages = [];
  const manifest = await encodeDiscoveredSkills({
    skillsRoot,
    outputRoot,
    logger: { log: (message) => messages.push(message) },
  });

  assert.deepEqual(
    manifest.skills.map((skill) => skill.skillName),
    [first, second],
  );
  assert.equal(manifest.encodedFileCount, 4);
  assert.ok(messages.some((message) => message.includes('2 official Skill(s)')));
  assert.ok(await readFile(path.join(outputRoot, first, 'SKILL.md.asx')));
  assert.ok(await readFile(path.join(outputRoot, first, 'scripts', 'run.py.asx')));
  assert.ok(await readFile(path.join(outputRoot, 'manifest.json.asx')));
  await assert.rejects(readFile(path.join(outputRoot, 'user-fixture', 'SKILL.md.asx')));
});

test('fails with the concrete SKILL.md path when directory and frontmatter names differ', async () => {
  const { skillsRoot } = await tempWorkspace();
  const directoryName = fixtureName('directory');
  const root = await createSkill(skillsRoot, directoryName);
  await writeFile(
    path.join(root, 'SKILL.md'),
    `---\nname: ${fixtureName('frontmatter')}\n---\n`,
  );

  await assert.rejects(
    discoverAlphaStudioSkills(skillsRoot),
    (error) =>
      error.message.includes('does not match frontmatter name') &&
      error.message.includes(path.join(root, 'SKILL.md')),
  );
});

test('fails rather than producing an empty built-in Skill bundle', async () => {
  const { skillsRoot, outputRoot } = await tempWorkspace();
  await createSkill(skillsRoot, 'user-fixture');
  await writeCatalog(skillsRoot, []);

  await assert.rejects(
    encodeDiscoveredSkills({ skillsRoot, outputRoot }),
    /No official Alpha Studio Skills were discovered/,
  );
});

test('rejects symbolic links and path escape attempts', async (context) => {
  if (process.platform === 'win32') {
    return context.skip('Symbolic-link creation is permission-dependent on Windows');
  }
  const { root, skillsRoot } = await tempWorkspace();
  const skillName = fixtureName('linked');
  const skillRoot = await createSkill(skillsRoot, skillName);
  const outside = path.join(root, 'outside.txt');
  await writeFile(outside, 'outside');
  await symlink(outside, path.join(skillRoot, 'escaped.txt'));

  await assert.rejects(discoverAlphaStudioSkills(skillsRoot), /Symbolic links are not allowed/);
});

test('rejects a nested second Skill root', async () => {
  const { skillsRoot } = await tempWorkspace();
  const skillRoot = await createSkill(skillsRoot, fixtureName('outer'));
  const nestedRoot = path.join(skillRoot, 'nested');
  await mkdir(nestedRoot);
  await writeFile(
    path.join(nestedRoot, 'SKILL.md'),
    `---\nname: ${fixtureName('inner')}\n---\n`,
  );

  await assert.rejects(
    discoverAlphaStudioSkills(skillsRoot),
    (error) => error.message.includes('Nested Skill roots') && error.message.includes(nestedRoot),
  );
});

test('encoded output contains only asx regular files', async () => {
  const { skillsRoot, outputRoot } = await tempWorkspace();
  await createSkill(skillsRoot, fixtureName('extensions'), { 'notes/readme.md': 'fixture' });
  await writeCatalog(skillsRoot, [fixtureName('extensions')]);
  await encodeDiscoveredSkills({ skillsRoot, outputRoot, logger: { log() {} } });

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else {
        assert.ok(entry.isFile());
        assert.ok(entry.name.endsWith('.asx'), entryPath);
      }
    }
  }
  await visit(outputRoot);
});

test('builds a server-uploadable release without exposing plaintext Skill files', async () => {
  const { root, skillsRoot } = await tempWorkspace();
  const skillName = fixtureName('release');
  await createSkill(skillsRoot, skillName, { 'references/private.md': 'protected-content' });
  await writeCatalog(skillsRoot, [skillName]);
  const outputPath = path.join(root, '.alpha-releases', 'fixture.asb.json');

  const release = await buildSkillRelease({
    repositoryRoot: root,
    version: '1.2.3',
    channel: 'beta',
    minClientVersion: '0.1.0',
    releaseNotes: 'fixture',
    outputPath,
    logger: { log() {} },
  });
  const artifactText = await readFile(outputPath, 'utf8');
  const artifact = JSON.parse(artifactText);

  assert.equal(artifact.formatVersion, 1);
  assert.equal(artifact.version, '1.2.3');
  assert.equal(artifact.channel, 'beta');
  assert.equal(artifact.manifestSummary.skillCount, 1);
  assert.equal(artifact.files.length, artifact.manifestSummary.encodedFileCount + 1);
  assert.ok(artifact.files.every((file) => file.path.endsWith('.asx')));
  assert.ok(!artifactText.includes('protected-content'));
  assert.match(release.sha256, /^[a-f0-9]{64}$/);
});

test('rejects an official catalog that omits or invents repository Skills', async () => {
  const { skillsRoot } = await tempWorkspace();
  const discoveredName = fixtureName('catalogued');
  await createSkill(skillsRoot, discoveredName);
  await writeCatalog(skillsRoot, [fixtureName('stale')]);
  const discovered = await discoverAlphaStudioSkills(skillsRoot);

  await assert.rejects(
    loadOfficialSkillCatalog(skillsRoot, discovered),
    (error) => error.message.includes(`missing: ${discoveredName}`)
      && error.message.includes(`stale: ${fixtureName('stale')}`),
  );
});
