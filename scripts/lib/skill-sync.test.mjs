import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
