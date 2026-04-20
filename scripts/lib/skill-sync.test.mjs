import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncSkills } from './skill-sync.mjs';

// Test the pure functions from skill-sync by extracting their logic

describe('skill-sync logic', () => {
  const testDir = join(tmpdir(), `airlock-skill-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('slugify', () => {
    function slugify(name) {
      return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }

    it('converts spaces to hyphens', () => {
      expect(slugify('My Cool Skill')).toBe('my-cool-skill');
    });

    it('removes special characters', () => {
      expect(slugify('skill@v2.0!')).toBe('skill-v2-0');
    });

    it('trims leading and trailing hyphens', () => {
      expect(slugify('--test--')).toBe('test');
    });

    it('handles already-slugified names', () => {
      expect(slugify('already-good')).toBe('already-good');
    });
  });

  describe('attachmentTypeToDir', () => {
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

    it('maps script to scripts/', () => {
      expect(attachmentTypeToDir('script')).toBe('scripts');
    });

    it('maps reference to references/', () => {
      expect(attachmentTypeToDir('reference')).toBe('references');
    });

    it('maps asset to assets/', () => {
      expect(attachmentTypeToDir('asset')).toBe('assets');
    });

    it('defaults unknown types to assets/', () => {
      expect(attachmentTypeToDir('unknown')).toBe('assets');
    });
  });

  describe('SKILL.md generation', () => {
    it('writes correct frontmatter + content', () => {
      const skill = {
        name: 'test-skill',
        description: 'A test skill for validation',
        content: '## Instructions\n\nDo the thing.',
      };

      const frontmatter = [
        '---',
        `description: ${skill.description}`,
        '---',
        '',
      ].join('\n');

      const expected = frontmatter + skill.content;
      const skillDir = join(testDir, 'test-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), expected);

      const written = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8');
      expect(written).toContain('---');
      expect(written).toContain('description: A test skill for validation');
      expect(written).toContain('## Instructions');
      expect(written).toContain('Do the thing.');
    });
  });

  describe('syncSkills write path', () => {
    let prevRoot;
    beforeEach(() => {
      prevRoot = process.env.CLAUDE_PLUGIN_ROOT;
      process.env.CLAUDE_PLUGIN_ROOT = testDir;
    });
    afterEach(() => {
      if (prevRoot === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
      else process.env.CLAUDE_PLUGIN_ROOT = prevRoot;
    });

    function fakeClient(skill) {
      return {
        listSkills: async () => [{ name: skill.name }],
        getSkill: async () => skill,
        readSkillAttachment: async (id) => {
          const a = (skill.attachments || []).find((x) => x.id === id);
          return a?.content ?? '';
        },
      };
    }

    it('strips path-traversal components from attachment filenames', async () => {
      await syncSkills(
        fakeClient({
          id: '1',
          name: 'test-skill',
          description: 'desc',
          content: 'body',
          attachments: [
            { id: 'a1', filename: '../../../etc/passwd', type: 'reference', content: 'x' },
          ],
        })
      );
      const skillRoot = join(testDir, 'skills', 'test-skill');
      expect(existsSync(join(skillRoot, 'references', 'passwd'))).toBe(true);
      expect(existsSync(join(testDir, 'skills', 'etc'))).toBe(false);
      expect(existsSync(join(testDir, 'etc'))).toBe(false);
    });

    it('skips attachments whose filename resolves to . or ..', async () => {
      await syncSkills(
        fakeClient({
          id: '1',
          name: 'test-skill',
          attachments: [
            { id: 'a1', filename: '..', type: 'reference', content: 'x' },
            { id: 'a2', filename: '.', type: 'reference', content: 'y' },
          ],
        })
      );
      const refs = join(testDir, 'skills', 'test-skill', 'references');
      expect(existsSync(refs)).toBe(false);
    });

    it('skips skills whose slug would be empty', async () => {
      await syncSkills(fakeClient({ id: '1', name: '???', content: 'body' }));
      const manifest = JSON.parse(
        readFileSync(join(testDir, 'skills', '.manifest.json'), 'utf-8')
      );
      expect(manifest).toEqual({});
    });

    it('ignores unsafe slugs in the old manifest during stale-prune', async () => {
      const skillsDir = join(testDir, 'skills');
      mkdirSync(skillsDir, { recursive: true });
      writeFileSync(
        join(skillsDir, '.manifest.json'),
        JSON.stringify({ '../..': { id: 'evil', hash: 'x' }, 'foo/bar': { id: 'e2', hash: 'y' } })
      );
      const sentinel = join(testDir, 'sentinel');
      mkdirSync(sentinel, { recursive: true });
      writeFileSync(join(sentinel, 'keep.txt'), 'must survive');

      await syncSkills(
        fakeClient({ id: '1', name: 'test-skill', content: 'body', attachments: [] })
      );
      expect(existsSync(join(sentinel, 'keep.txt'))).toBe(true);
    });

    it('returns the count of actually-synced skills, not listed ones', async () => {
      const client = {
        listSkills: async () => [
          { name: 'good-skill' },
          { name: '???' }, // slug empty, skipped
          { name: '' }, // no name, skipped
        ],
        getSkill: async (name) => ({ id: name, name, content: 'body' }),
        readSkillAttachment: async () => '',
      };
      const count = await syncSkills(client);
      expect(count).toBe(1);
    });

    it('throws on post-sanitisation filename collisions instead of silently dropping', async () => {
      await expect(
        syncSkills(
          fakeClient({
            id: '1',
            name: 'test-skill',
            content: 'body',
            attachments: [
              { id: 'a1', filename: 'docs/readme.md', type: 'reference', content: 'first' },
              { id: 'a2', filename: '../../readme.md', type: 'reference', content: 'second' },
            ],
          })
        )
      ).rejects.toThrow(/Duplicate attachment filename/);
    });

    it('prunes stale attachment files from prior syncs', async () => {
      const skillRoot = join(testDir, 'skills', 'test-skill');
      const refs = join(skillRoot, 'references');
      mkdirSync(refs, { recursive: true });
      writeFileSync(join(refs, 'stale.md'), 'stale content');

      await syncSkills(
        fakeClient({
          id: '1',
          name: 'test-skill',
          content: 'body',
          attachments: [{ id: 'a1', filename: 'fresh.md', type: 'reference', content: 'fresh' }],
        })
      );
      expect(existsSync(join(refs, 'stale.md'))).toBe(false);
      expect(existsSync(join(refs, 'fresh.md'))).toBe(true);
    });
  });

  describe('manifest idempotency', () => {
    it('detects unchanged skills via hash comparison', async () => {
      const { createHash } = await import('node:crypto');
      function hash(str) {
        return createHash('sha256').update(str).digest('hex').slice(0, 16);
      }

      const skill = { id: '1', name: 'test', content: 'hello' };
      const hash1 = hash(JSON.stringify(skill));
      const hash2 = hash(JSON.stringify(skill));

      expect(hash1).toBe(hash2);

      const modified = { ...skill, content: 'changed' };
      const hash3 = hash(JSON.stringify(modified));
      expect(hash3).not.toBe(hash1);
    });

    it('identifies stale skills for pruning', () => {
      const oldManifest = {
        'skill-a': { id: '1', hash: 'aaa' },
        'skill-b': { id: '2', hash: 'bbb' },
        'skill-c': { id: '3', hash: 'ccc' },
      };
      const newManifest = {
        'skill-a': { id: '1', hash: 'aaa' },
        'skill-b': { id: '2', hash: 'bbb-updated' },
      };

      const stale = Object.keys(oldManifest).filter((slug) => !newManifest[slug]);
      expect(stale).toEqual(['skill-c']);

      const changed = Object.keys(newManifest).filter(
        (slug) => oldManifest[slug]?.hash !== newManifest[slug].hash
      );
      expect(changed).toEqual(['skill-b']);
    });
  });
});
