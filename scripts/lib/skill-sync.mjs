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
import { join, dirname } from 'node:path';
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
  return join(dirname(new URL(import.meta.url).pathname), '..', '..', 'skills');
}

const SKILLS_DIR = getSkillsDir();
const MANIFEST_FILE = join(SKILLS_DIR, '.manifest.json');

/**
 * Sync skills from Airlock MCP to local disk.
 * Returns the number of skills synced.
 *
 * @param {import('./airlock-client.mjs').AirlockClient} client
 */
export async function syncSkills(client) {
  // Fetch all skills from Airlock
  const skillList = await client.listSkills();
  const skills = Array.isArray(skillList) ? skillList : skillList?.skills || [];

  if (skills.length === 0) {
    return 0;
  }

  // Load existing manifest for diffing
  const oldManifest = readManifest();
  const newManifest = {};

  for (const skill of skills) {
    const slug = slugify(skill.name);
    const contentHash = hash(JSON.stringify(skill));
    newManifest[slug] = { id: skill.id, hash: contentHash };

    // Skip if unchanged
    if (oldManifest[slug]?.hash === contentHash) {
      continue;
    }

    // Fetch full skill content if not already included
    let fullSkill = skill;
    if (!skill.content && skill.name) {
      fullSkill = await client.getSkill(skill.name);
    }

    writeSkill(slug, fullSkill);
  }

  // Prune stale skills
  for (const slug of Object.keys(oldManifest)) {
    if (!newManifest[slug]) {
      const skillDir = join(SKILLS_DIR, slug);
      if (existsSync(skillDir)) {
        rmSync(skillDir, { recursive: true });
      }
    }
  }

  // Write new manifest
  writeManifest(newManifest);

  return skills.length;
}

/**
 * Write a single skill to disk as SKILL.md + attachments.
 */
function writeSkill(slug, skill) {
  const skillDir = join(SKILLS_DIR, slug);
  mkdirSync(skillDir, { recursive: true });

  // Write SKILL.md with frontmatter
  const frontmatter = [
    '---',
    `description: ${skill.description || skill.name}`,
    '---',
    '',
  ].join('\n');

  const content = frontmatter + (skill.content || '');
  writeFileSync(join(skillDir, 'SKILL.md'), content);

  // Write attachments
  const attachments = skill.attachments || [];
  for (const attachment of attachments) {
    const subdir = attachmentTypeToDir(attachment.type);
    const attachDir = join(skillDir, subdir);
    mkdirSync(attachDir, { recursive: true });
    writeFileSync(join(attachDir, attachment.filename), attachment.content);
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

function readManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeManifest(manifest) {
  mkdirSync(SKILLS_DIR, { recursive: true });
  writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
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
