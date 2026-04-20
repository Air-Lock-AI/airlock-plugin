/**
 * Skill sync — pulls skills from Airlock MCP and writes them as local SKILL.md files.
 *
 * Each skill becomes:
 *   skills/<slug>/SKILL.md          (frontmatter + content)
 *   skills/<slug>/scripts/*         (script attachments)
 *   skills/<slug>/references/*      (reference attachments)
 *   skills/<slug>/assets/*          (asset attachments)
 *
 * Uses a manifest file (skills/.manifest.json) for idempotency and stale pruning.
 */

import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

/**
 * Resolve the plugin's skills directory.
 * Uses CLAUDE_PLUGIN_ROOT if available, otherwise falls back to relative path.
 */
function getSkillsDir() {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (pluginRoot) {
    return join(pluginRoot, 'skills');
  }
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills');
}

const MANIFEST_FILENAME = '.manifest.json';

/**
 * Sync skills from Airlock MCP to local disk.
 * Returns the number of skills synced.
 *
 * @param {import('./airlock-client.mjs').AirlockClient} client
 */
export async function syncSkills(client) {
  const skillList = await client.listSkills();
  const skills = Array.isArray(skillList) ? skillList : skillList?.skills || [];

  if (skills.length === 0) {
    return 0;
  }

  const skillsDir = getSkillsDir();
  const oldManifest = readManifest(skillsDir);
  const newManifest = {};

  for (const summary of skills) {
    if (!summary?.name) continue;

    const slug = slugify(summary.name);
    if (!slug) continue;

    const fullSkill = await client.getSkill(summary.name);
    const attachments = await hydrateAttachments(client, fullSkill?.attachments || []);
    const skill = { ...fullSkill, attachments };

    const contentHash = hash(JSON.stringify(skill));
    newManifest[slug] = { id: skill.id, hash: contentHash };

    if (oldManifest[slug]?.hash === contentHash) {
      continue;
    }

    writeSkill(skillsDir, slug, skill);
  }

  for (const slug of Object.keys(oldManifest)) {
    if (!isSafeSlug(slug)) continue;
    if (!newManifest[slug]) {
      const skillDir = join(skillsDir, slug);
      if (existsSync(skillDir)) {
        rmSync(skillDir, { recursive: true });
      }
    }
  }

  writeManifest(skillsDir, newManifest);

  return Object.keys(newManifest).length;
}

function isSafeSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

/**
 * Fetch the body of every attachment referenced by `activate_skill`.
 * Returns attachments with a `content` field populated.
 */
async function hydrateAttachments(client, attachmentStubs) {
  const hydrated = [];
  for (const stub of attachmentStubs) {
    if (!stub?.id) continue;
    const result = await client.readSkillAttachment(stub.id);
    const content = typeof result === 'string' ? result : result?.content ?? '';
    hydrated.push({ ...stub, content });
  }
  return hydrated;
}

/**
 * Write a single skill to disk as SKILL.md + attachments.
 */
function writeSkill(skillsDir, slug, skill) {
  const skillDir = join(skillsDir, slug);
  mkdirSync(skillDir, { recursive: true });

  for (const subdir of ['scripts', 'references', 'assets']) {
    const dir = join(skillDir, subdir);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }

  const frontmatter = [
    '---',
    `description: ${skill.description || skill.name}`,
    '---',
    '',
  ].join('\n');

  const content = frontmatter + (skill.content || '');
  writeFileSync(join(skillDir, 'SKILL.md'), content);

  const writtenTargets = new Set();
  for (const attachment of skill.attachments || []) {
    if (!attachment.filename) continue;
    const safeName = basename(attachment.filename);
    if (!safeName || safeName === '.' || safeName === '..') continue;
    const subdir = attachmentTypeToDir(attachment.type);
    const attachDir = join(skillDir, subdir);
    const target = join(attachDir, safeName);
    if (writtenTargets.has(target)) {
      throw new Error(
        `Duplicate attachment filename after sanitisation in skill '${slug}': ${attachment.filename}`
      );
    }
    writtenTargets.add(target);
    mkdirSync(attachDir, { recursive: true });
    writeFileSync(target, attachment.content ?? '');
  }
}

/**
 * Map Airlock attachment type to Claude Code skill subdirectory.
 */
function attachmentTypeToDir(type) {
  switch (type) {
    case 'script':
      return 'scripts';
    case 'reference':
      return 'references';
    case 'asset':
      return 'assets';
    default:
      return 'assets';
  }
}

function readManifest(skillsDir) {
  try {
    return JSON.parse(readFileSync(join(skillsDir, MANIFEST_FILENAME), 'utf-8'));
  } catch {
    return {};
  }
}

function writeManifest(skillsDir, manifest) {
  mkdirSync(skillsDir, { recursive: true });
  writeFileSync(join(skillsDir, MANIFEST_FILENAME), JSON.stringify(manifest, null, 2));
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function hash(str) {
  return createHash('sha256').update(str).digest('hex').slice(0, 16);
}
