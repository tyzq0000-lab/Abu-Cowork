import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readTextFile, readDir, exists } from '@tauri-apps/plugin-fs';
import { SkillLoader } from './loader';

const mockReadTextFile = vi.mocked(readTextFile);
const mockReadDir = vi.mocked(readDir);
const mockExists = vi.mocked(exists);

const SKILL_TEMPLATE = (name: string) => `---
name: ${name}
description: Test skill ${name}
---

Body content for ${name}.
`;

beforeEach(() => {
  vi.clearAllMocks();
  mockExists.mockResolvedValue(true);
  mockReadDir.mockResolvedValue([]);
  mockReadTextFile.mockRejectedValue(new Error('not found'));
});

/**
 * Set up a canned directory listing: when readDir is called with any
 * of the keys, return the given entries. Else return []. Any SKILL.md
 * content is looked up in `fileContents` keyed by absolute path.
 */
function stubFs(
  dirEntries: Record<string, string[]>,
  fileContents: Record<string, string>,
) {
  mockReadDir.mockImplementation(async (dir: string) => {
    const entries = dirEntries[dir] ?? [];
    return entries.map((name) => ({
      name,
      isDirectory: true,
      isFile: false,
      isSymlink: false,
    })) as Awaited<ReturnType<typeof readDir>>;
  });

  mockReadTextFile.mockImplementation(async (path: string) => {
    const content = fileContents[path];
    if (content === undefined) throw new Error('not found');
    return content;
  });

  // exists returns true for any path we've populated OR its parent dirs
  const liveDirs = new Set(Object.keys(dirEntries));
  mockExists.mockImplementation(async (path: string) => {
    return liveDirs.has(path) || Object.keys(fileContents).some((p) => p === path);
  });
}

describe('SkillLoader.discoverSkills · workspace awareness', () => {
  it('scans global dirs only when workspacePath is null', async () => {
    stubFs(
      {
        '/Users/testuser/.uprow/skills': ['global-skill'],
      },
      {
        '/Users/testuser/.uprow/skills/global-skill/SKILL.md': SKILL_TEMPLATE('global-skill'),
      },
    );

    const loader = new SkillLoader();
    const skills = await loader.discoverSkills(null);

    expect(skills.map((s) => s.name)).toContain('global-skill');
    expect(loader.getCurrentWorkspace()).toBeNull();
  });

  it('scans workspace + global dirs when workspacePath provided', async () => {
    const workspace = '/Users/testuser/projects/myapp';
    stubFs(
      {
        [`${workspace}/.abu/skills`]: ['project-skill'],
        '/Users/testuser/.uprow/skills': ['global-skill'],
      },
      {
        [`${workspace}/.abu/skills/project-skill/SKILL.md`]: SKILL_TEMPLATE('project-skill'),
        '/Users/testuser/.uprow/skills/global-skill/SKILL.md': SKILL_TEMPLATE('global-skill'),
      },
    );

    const loader = new SkillLoader();
    const skills = await loader.discoverSkills(workspace);
    const names = skills.map((s) => s.name);

    expect(names).toContain('project-skill');
    expect(names).toContain('global-skill');
    expect(loader.getCurrentWorkspace()).toBe(workspace);
  });

  it('workspace-auto skills are discovered under ~/.uprow/projects/<key>/skills', async () => {
    const workspace = '/Users/testuser/projects/myapp';
    // sanitizePath('/Users/testuser/projects/myapp') → '-Users-testuser-projects-myapp'
    const autoDir = '/Users/testuser/.uprow/projects/-Users-testuser-projects-myapp/skills';
    stubFs(
      {
        [autoDir]: ['auto-skill'],
      },
      {
        [`${autoDir}/auto-skill/SKILL.md`]: SKILL_TEMPLATE('auto-skill'),
      },
    );

    const loader = new SkillLoader();
    await loader.discoverSkills(workspace);

    const all = loader.getAvailableSkills();
    const auto = all.find((s) => s.name === 'auto-skill');
    expect(auto).toBeDefined();
    expect(auto!.source).toBe('workspace-auto');
  });

  it('drafts are NOT in getAvailableSkills() by default (excluded from L0 index)', async () => {
    const workspace = '/Users/testuser/projects/myapp';
    const draftDir = '/Users/testuser/.uprow/projects/-Users-testuser-projects-myapp/skills/drafts';
    stubFs(
      {
        [draftDir]: ['pending-skill'],
      },
      {
        [`${draftDir}/pending-skill/SKILL.md`]: SKILL_TEMPLATE('pending-skill'),
      },
    );

    const loader = new SkillLoader();
    await loader.discoverSkills(workspace);

    // Default: drafts hidden
    const defaultList = loader.getAvailableSkills();
    expect(defaultList.find((s) => s.name === 'pending-skill')).toBeUndefined();

    // Opt-in: drafts visible (for Settings UI)
    const withDrafts = loader.getAvailableSkills({ includeDrafts: true });
    expect(withDrafts.find((s) => s.name === 'pending-skill')).toBeDefined();

    // Full draft objects available for review UI
    const drafts = loader.getDraftSkills();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].source).toBe('draft');
    expect(drafts[0].content).toContain('Body content for pending-skill');
  });

  it('discovers skills bundled in ~/.uprow/employees/<pkg>/skills with source "employee"', async () => {
    const empRoot = '/Users/testuser/.uprow/employees';
    const skillsDir = `${empRoot}/content-creator/skills`;
    stubFs(
      {
        [empRoot]: ['content-creator'],
        [skillsDir]: ['humanizer', 'novel-writer'],
      },
      {
        [`${skillsDir}/humanizer/SKILL.md`]: SKILL_TEMPLATE('humanizer'),
        [`${skillsDir}/novel-writer/SKILL.md`]: SKILL_TEMPLATE('novel-writer'),
      },
    );

    const loader = new SkillLoader();
    await loader.discoverSkills(null);

    const all = loader.getAvailableSkills();
    const humanizer = all.find((s) => s.name === 'humanizer');
    const novel = all.find((s) => s.name === 'novel-writer');
    expect(humanizer?.source).toBe('employee');
    expect(novel?.source).toBe('employee');
  });

  it('first-win: a global user skill beats an employee skill of the same name', async () => {
    // Employees are scanned last (lowest priority), so a user's own global
    // skill of the same name wins — and stays source "user" (not gated).
    const empRoot = '/Users/testuser/.uprow/employees';
    const skillsDir = `${empRoot}/content-creator/skills`;
    stubFs(
      {
        '/Users/testuser/.uprow/skills': ['humanizer'],
        [empRoot]: ['content-creator'],
        [skillsDir]: ['humanizer'],
      },
      {
        '/Users/testuser/.uprow/skills/humanizer/SKILL.md':
          SKILL_TEMPLATE('humanizer').replace('Body content', 'USER'),
        [`${skillsDir}/humanizer/SKILL.md`]:
          SKILL_TEMPLATE('humanizer').replace('Body content', 'EMPLOYEE'),
      },
    );

    const loader = new SkillLoader();
    await loader.discoverSkills(null);

    const shared = loader.getSkill('humanizer');
    expect(shared!.content).toContain('USER');
    expect(shared!.source).toBe('user');

    const employeeOwned = loader.getSkill('humanizer', 'content-creator');
    expect(employeeOwned!.content).toContain('EMPLOYEE');
    expect(employeeOwned!.source).toBe('employee');
  });

  it('resolves same-name skills by exact employee owner', async () => {
    const empRoot = '/Users/testuser/.uprow/employees';
    const alphaSkills = `${empRoot}/alpha/skills`;
    const betaSkills = `${empRoot}/beta/skills`;
    stubFs(
      {
        [empRoot]: ['alpha', 'beta'],
        [alphaSkills]: ['shared'],
        [betaSkills]: ['shared'],
      },
      {
        [`${alphaSkills}/shared/SKILL.md`]: SKILL_TEMPLATE('shared').replace('Body content', 'ALPHA'),
        [`${betaSkills}/shared/SKILL.md`]: SKILL_TEMPLATE('shared').replace('Body content', 'BETA'),
      },
    );

    const loader = new SkillLoader();
    await loader.discoverSkills(null);

    expect(loader.getSkill('shared', 'alpha')?.content).toContain('ALPHA');
    expect(loader.getSkill('shared', 'beta')?.content).toContain('BETA');
    expect(loader.getSkill('shared', 'missing-owner')).toBeUndefined();
    expect(loader.getAvailableSkills({ employeeName: 'beta' }).map((skill) => skill.name))
      .toContain('shared');
    expect(loader.getAvailableSkills({ employeeName: 'missing-owner' }).map((skill) => skill.name))
      .not.toContain('shared');
  });

  it('does not register disabled ChaWork skills', async () => {
    const empRoot = '/Users/testuser/.uprow/employees';
    const pkgDir = `${empRoot}/nature-researcher`;
    const skillsDir = `${pkgDir}/skills`;
    stubFs(
      {
        [empRoot]: ['nature-researcher'],
        [skillsDir]: ['enabled-search', 'disabled-export'],
      },
      {
        [`${pkgDir}/skills.json`]: JSON.stringify({
          version: 1,
          skills: [
            { id: 'enabled-search', source: 'hub', enabled: true },
            { id: 'disabled-export', source: 'hub', enabled: false },
          ],
        }),
        [`${skillsDir}/enabled-search/SKILL.md`]: SKILL_TEMPLATE('enabled-search'),
        [`${skillsDir}/disabled-export/SKILL.md`]: SKILL_TEMPLATE('disabled-export'),
      },
    );

    const loader = new SkillLoader();
    await loader.discoverSkills(null);

    expect(loader.getSkill('enabled-search', 'nature-researcher')).toBeDefined();
    expect(loader.getSkill('disabled-export', 'nature-researcher')).toBeUndefined();
  });

  it('resolves a declared directory alias to the SKILL.md standard name', async () => {
    const empRoot = '/Users/testuser/.uprow/employees';
    const pkgDir = `${empRoot}/brand-strategy-advisor`;
    const skillsDir = `${pkgDir}/skills`;
    stubFs(
      {
        [empRoot]: ['brand-strategy-advisor'],
        [skillsDir]: ['marketing-copywriting'],
      },
      {
        [`${pkgDir}/.codebuddy-plugin/plugin.json`]: JSON.stringify({
          name: 'brand-strategy-advisor',
          skills: ['./skills/marketing-copywriting'],
        }),
        [`${skillsDir}/marketing-copywriting/SKILL.md`]: SKILL_TEMPLATE('copywriting'),
      },
    );

    const loader = new SkillLoader();
    await loader.discoverSkills(null);

    const byAlias = loader.getSkill('marketing-copywriting', 'brand-strategy-advisor');
    const byStandardName = loader.getSkill('copywriting', 'brand-strategy-advisor');
    expect(byAlias).toBe(byStandardName);
    expect(byAlias?.name).toBe('copywriting');
    expect(loader.getAvailableSkills({ employeeName: 'brand-strategy-advisor' })
      .filter((skill) => skill.source === 'employee').map((skill) => skill.name))
      .toEqual(['copywriting']);
  });

  it('first-win: workspace skill beats global with same name', async () => {
    const workspace = '/Users/testuser/projects/myapp';
    stubFs(
      {
        [`${workspace}/.abu/skills`]: ['shared-name'],
        '/Users/testuser/.uprow/skills': ['shared-name'],
      },
      {
        [`${workspace}/.abu/skills/shared-name/SKILL.md`]:
          SKILL_TEMPLATE('shared-name').replace('Body content', 'WORKSPACE'),
        '/Users/testuser/.uprow/skills/shared-name/SKILL.md':
          SKILL_TEMPLATE('shared-name').replace('Body content', 'GLOBAL'),
      },
    );

    const loader = new SkillLoader();
    await loader.discoverSkills(workspace);

    const shared = loader.getSkill('shared-name');
    expect(shared).toBeDefined();
    // Workspace version should win (project source, priority 1)
    expect(shared!.content).toContain('WORKSPACE');
    expect(shared!.source).toBe('project');
  });

  it('switching workspace causes full re-scan', async () => {
    stubFs(
      {
        '/ws/a/.abu/skills': ['a-only'],
        '/ws/b/.abu/skills': ['b-only'],
      },
      {
        '/ws/a/.abu/skills/a-only/SKILL.md': SKILL_TEMPLATE('a-only'),
        '/ws/b/.abu/skills/b-only/SKILL.md': SKILL_TEMPLATE('b-only'),
      },
    );

    const loader = new SkillLoader();

    await loader.discoverSkills('/ws/a');
    expect(loader.has('a-only')).toBe(true);
    expect(loader.has('b-only')).toBe(false);

    await loader.discoverSkills('/ws/b');
    expect(loader.has('a-only')).toBe(false);
    expect(loader.has('b-only')).toBe(true);
    expect(loader.getCurrentWorkspace()).toBe('/ws/b');
  });
});
