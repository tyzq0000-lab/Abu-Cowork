import { beforeEach, describe, expect, it } from 'vitest';
import { useEmployeeDeploymentStore, type EmployeeDeploymentRecord } from './employeeDeploymentStore';

function deployment(over: Partial<EmployeeDeploymentRecord>): EmployeeDeploymentRecord {
  return {
    packageId: 'pkg_shared',
    agentName: 'shared-agent',
    workspacePath: null,
    configuredAt: 1,
    ...over,
  };
}

describe('employee deployment store tenant identity', () => {
  beforeEach(() => useEmployeeDeploymentStore.setState({ deployments: {}, integrity: {} }));

  it('keeps different hires of the same package as separate deployment records', () => {
    const store = useEmployeeDeploymentStore.getState();
    store.saveDeployment(deployment({ hireId: 'hire_a', deploymentId: 'dep_a' }));
    store.saveDeployment(deployment({ hireId: 'hire_b', deploymentId: 'dep_b' }));
    expect(Object.keys(useEmployeeDeploymentStore.getState().deployments).sort()).toEqual(['dep_a', 'dep_b']);
  });

  it('replaces only the prior deployment for the same hire', () => {
    const store = useEmployeeDeploymentStore.getState();
    store.saveDeployment(deployment({ hireId: 'hire_a', deploymentId: 'dep_a_old' }));
    store.saveDeployment(deployment({ hireId: 'hire_b', deploymentId: 'dep_b' }));
    store.saveDeployment(deployment({ hireId: 'hire_a', deploymentId: 'dep_a_new', configuredAt: 2 }));
    expect(Object.keys(useEmployeeDeploymentStore.getState().deployments).sort())
      .toEqual(['dep_a_new', 'dep_b']);
  });
});
