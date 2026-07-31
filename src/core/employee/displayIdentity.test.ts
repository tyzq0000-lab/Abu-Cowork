import { describe, expect, it } from 'vitest';
import type { SubagentMetadata } from '@/types';
import type { EmployeeDeploymentRecord } from '@/stores/employeeDeploymentStore';
import { resolveEmployeeIdentity } from './displayIdentity';

const AGENT = 'new-media-growth-operator';

function agent(over: Partial<SubagentMetadata> = {}): SubagentMetadata {
  return {
    name: AGENT,
    description: '从一个业务线索自主建档，按用户目标动态运营新媒体平台，完成调研、策略、图文视频、审批发布和持续复盘。',
    displayNames: { 'zh-CN': '增长运营官' },
    profession: '新媒体增长运营数字员工',
    avatar: '/pkg/avatars/expert.svg',
    ...over,
  } as SubagentMetadata;
}

function deployment(over: Partial<EmployeeDeploymentRecord> = {}): Record<string, EmployeeDeploymentRecord> {
  return {
    dep_1: {
      packageId: 'pkg_1',
      agentName: AGENT,
      workspacePath: null,
      configuredAt: 0,
      ...over,
    },
  };
}

describe('resolveEmployeeIdentity', () => {
  it('uses the package identity when nothing was deployed from the platform', () => {
    expect(resolveEmployeeIdentity(agent(), AGENT, {}, 'zh-CN')).toEqual({
      name: '增长运营官',
      avatar: '/pkg/avatars/expert.svg',
      profession: '新媒体增长运营数字员工',
    });
  });

  it('prefers the job title over the package blurb for the subtitle', () => {
    // The blurb is a marketing paragraph; cramming it under the name is what the
    // founder reported. `profession` is the field that means "job title".
    const { profession } = resolveEmployeeIdentity(agent(), AGENT, {}, 'zh-CN');
    expect(profession).toBe('新媒体增长运营数字员工');
    expect(profession).not.toContain('业务线索');
  });

  it('falls back to the description only when the package declares no profession', () => {
    const bare = agent({ profession: undefined, professionI18n: undefined });
    expect(resolveEmployeeIdentity(bare, AGENT, {}, 'zh-CN').profession)
      .toBe(agent().description);
  });

  it('lets the platform-minted identity override all three package fields', () => {
    expect(resolveEmployeeIdentity(agent(), AGENT, deployment({
      platformDisplayName: '小野同学',
      platformProfession: '新媒体增长运营数字人',
      platformAvatar: 'data:image/png;base64,iVBORw0KGgo=',
    }), 'zh-CN')).toEqual({
      name: '小野同学',
      profession: '新媒体增长运营数字人',
      avatar: 'data:image/png;base64,iVBORw0KGgo=',
    });
  });

  it('overrides only the fields the platform actually supplied', () => {
    // An employee minted without an uploaded avatar must keep the package's face
    // rather than falling all the way back to the generic robot.
    const resolved = resolveEmployeeIdentity(
      agent(),
      AGENT,
      deployment({ platformDisplayName: '小野同学' }),
      'zh-CN',
    );
    expect(resolved.name).toBe('小野同学');
    expect(resolved.avatar).toBe('/pkg/avatars/expert.svg');
    expect(resolved.profession).toBe('新媒体增长运营数字员工');
  });

  it('ignores deployments belonging to a different agent', () => {
    const other = deployment({ agentName: 'someone-else', platformDisplayName: '别人' });
    expect(resolveEmployeeIdentity(agent(), AGENT, other, 'zh-CN').name).toBe('增长运营官');
  });

  it('still resolves a name when the agent is not in the registry yet', () => {
    // Discovery is async; the header must not render `undefined` mid-refresh.
    expect(resolveEmployeeIdentity(undefined, AGENT, {}, 'zh-CN')).toEqual({
      name: AGENT,
      avatar: '🤖',
      profession: '',
    });
  });
});
