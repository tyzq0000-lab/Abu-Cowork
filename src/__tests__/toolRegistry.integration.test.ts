/**
 * Integration test: toolRegistry + commandSafety + pathSafety
 * Tests the full safety check pipeline through executeAnyTool
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toolRegistry, executeAnyTool } from '../core/tools/registry';
import { authorizeWorkspace, revokeWorkspace } from '../core/tools/pathSafety';
import { setPlatformForTest as _setPlatformForTest } from '../test/helpers';
import { useSettingsStore } from '../stores/settingsStore';

// Mock i18n
vi.mock('../i18n', () => ({
  getI18n: () => ({
    commandConfirm: {
      blocked: '已阻止',
      userCancelled: '用户取消了操作',
      externalActionReason: '对外操作必须逐次人工批准',
      externalApprovalUnavailable: '当前通道无法提供人工批准',
    },
    toolErrors: {
      disabledByEmployeePolicy: '员工工具策略已禁用 {tool}',
    },
  }),
}));

// Mock MCP manager
vi.mock('../core/mcp/client', () => ({
  mcpManager: {
    listTools: () => [],
    isConnected: () => false,
    callTool: vi.fn(),
  },
}));

describe('toolRegistry integration', () => {
  beforeEach(() => {
    // Clean up workspace authorizations
    revokeWorkspace('/Users/testuser/Projects/myapp');
    useSettingsStore.setState({ permissionMode: 'standard' });
  });

  // ── Command safety through executeAnyTool ──
  describe('command safety pipeline', () => {
    it('blocks dangerous commands via executeAnyTool', async () => {
      toolRegistry.register({
        name: 'run_command',
        description: 'Run shell command',
        inputSchema: { type: 'object', properties: { command: { type: 'string', description: 'cmd' } } },
        execute: vi.fn().mockResolvedValue('executed'),
      });

      const result = await executeAnyTool('run_command', { command: 'rm -rf /' });
      expect(result).toContain('已阻止');
      // The underlying execute should NOT have been called
    });

    it('allows safe commands through', async () => {
      const executeFn = vi.fn().mockResolvedValue('file list');
      toolRegistry.register({
        name: 'run_command',
        description: 'Run shell command',
        inputSchema: { type: 'object', properties: { command: { type: 'string', description: 'cmd' } } },
        execute: executeFn,
      });

      const result = await executeAnyTool('run_command', { command: 'ls -la' });
      expect(result).toBe('file list');
      expect(executeFn).toHaveBeenCalled();
    });

    it('requests confirmation for warn-level commands', async () => {
      toolRegistry.register({
        name: 'run_command',
        description: 'Run shell command',
        inputSchema: { type: 'object', properties: { command: { type: 'string', description: 'cmd' } } },
        execute: vi.fn().mockResolvedValue('pushed'),
      });

      const onConfirm = vi.fn().mockResolvedValue(true);
      const result = await executeAnyTool(
        'run_command',
        { command: 'git push origin main' },
        onConfirm
      );
      expect(onConfirm).toHaveBeenCalled();
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(result).toBe('pushed');
    });

    it('cancels when user declines confirmation', async () => {
      toolRegistry.register({
        name: 'run_command',
        description: 'Run shell command',
        inputSchema: { type: 'object', properties: { command: { type: 'string', description: 'cmd' } } },
        execute: vi.fn().mockResolvedValue('should not reach'),
      });

      const onConfirm = vi.fn().mockResolvedValue(false);
      const result = await executeAnyTool(
        'run_command',
        { command: 'sudo rm something' },
        onConfirm
      );
      expect(result).toContain('用户取消');
    });

    it('cannot bypass external-action approval in autonomous mode', async () => {
      const executeFn = vi.fn().mockResolvedValue('pushed');
      toolRegistry.register({
        name: 'run_command',
        description: 'Run shell command',
        inputSchema: { type: 'object', properties: { command: { type: 'string', description: 'cmd' } } },
        execute: executeFn,
      });
      useSettingsStore.setState({ permissionMode: 'autonomous' });

      const onConfirm = vi.fn().mockResolvedValue(false);
      const result = await executeAnyTool('run_command', { command: 'git push origin main' }, onConfirm);

      expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'external-action',
        externalActionKind: 'publish',
      }));
      expect(result).toContain('用户取消');
      expect(executeFn).not.toHaveBeenCalled();
    });
  });

  describe('external action approval', () => {
    it('allows reads, but fails closed for HTTP writes without an approval channel', async () => {
      const executeFn = vi.fn().mockResolvedValue('ok');
      toolRegistry.register({
        name: 'http_fetch',
        description: 'HTTP',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'url' },
            method: { type: 'string', description: 'method' },
          },
          required: ['url'],
        },
        execute: executeFn,
      });

      expect(await executeAnyTool('http_fetch', { url: 'https://example.com/data' })).toBe('ok');
      const denied = await executeAnyTool('http_fetch', {
        method: 'POST',
        url: 'https://example.com/messages',
      });

      expect(denied).toContain('当前通道无法提供人工批准');
      expect(executeFn).toHaveBeenCalledTimes(1);
    });

    it('executes an HTTP write only after a fresh approval', async () => {
      const executeFn = vi.fn().mockResolvedValue('sent');
      toolRegistry.register({
        name: 'http_fetch',
        description: 'HTTP',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'url' },
            method: { type: 'string', description: 'method' },
          },
          required: ['url'],
        },
        execute: executeFn,
      });
      const onConfirm = vi.fn().mockResolvedValue(true);

      const result = await executeAnyTool('http_fetch', {
        method: 'POST',
        url: 'https://example.com/messages?token=secret',
      }, onConfirm);

      expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
        command: 'POST https://example.com/messages',
        kind: 'external-action',
        externalActionKind: 'send',
      }));
      expect(result).toBe('sent');
      expect(executeFn).toHaveBeenCalledTimes(1);
    });
  });

  // ── Path safety through executeAnyTool ──
  describe('path safety pipeline', () => {
    it('blocks read of sensitive paths', async () => {
      toolRegistry.register({
        name: 'read_file',
        description: 'Read file',
        inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'path' } } },
        execute: vi.fn().mockResolvedValue('secret data'),
      });

      const result = await executeAnyTool('read_file', { path: '/Users/testuser/.ssh/id_rsa' });
      expect(result).toContain('Error');
    });

    it('allows authorized workspace paths', async () => {
      authorizeWorkspace('/Users/testuser/Projects/myapp');
      const executeFn = vi.fn().mockResolvedValue('file content');
      toolRegistry.register({
        name: 'read_file',
        description: 'Read file',
        inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'path' } } },
        execute: executeFn,
      });

      const result = await executeAnyTool('read_file', { path: '/Users/testuser/Projects/myapp/src/main.ts' });
      expect(result).toBe('file content');
    });

    it('requests file permission when path needs authorization', async () => {
      const executeFn = vi.fn().mockResolvedValue('file data');
      toolRegistry.register({
        name: 'read_file',
        description: 'Read file',
        inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'path' } } },
        execute: executeFn,
      });

      const onFilePermission = vi.fn().mockImplementation(async ({ path }) => {
        // Simulate granting permission by authorizing the workspace
        authorizeWorkspace(path);
        return true;
      });

      await executeAnyTool(
        'read_file',
        { path: '/Users/testuser/Desktop/report.pdf' },
        undefined,
        onFilePermission
      );
      expect(onFilePermission).toHaveBeenCalled();
    });
  });

  // ── Tool registry basics ──
  describe('registry operations', () => {
    it('blocks a disabled employee tool at the final execution gate', async () => {
      const executeFn = vi.fn().mockResolvedValue('should not execute');
      toolRegistry.register({
        name: 'employee_write',
        description: 'Employee write action',
        inputSchema: { type: 'object', properties: {} },
        execute: executeFn,
      });

      const result = await executeAnyTool(
        'employee_write',
        {},
        undefined,
        undefined,
        {
          toolPolicy: {
            overrides: { employee_write: 'disabled' },
          },
        },
      );

      expect(result).toContain('员工工具策略已禁用 employee_write');
      expect(executeFn).not.toHaveBeenCalled();
    });

    it('registers and retrieves tools', () => {
      toolRegistry.register({
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => 'ok',
      });
      expect(toolRegistry.has('test_tool')).toBe(true);
      expect(toolRegistry.get('test_tool')?.name).toBe('test_tool');
    });

    it('returns error for unknown tools', async () => {
      const result = await executeAnyTool('nonexistent_tool', {});
      expect(result).toContain('Unknown tool');
    });

    it('handles execution errors gracefully', async () => {
      toolRegistry.register({
        name: 'error_tool',
        description: 'Tool that throws',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => { throw new Error('Tool broke'); },
      });
      const result = await toolRegistry.execute('error_tool', {});
      expect(result).toContain('Error');
      expect(result).toContain('Tool broke');
    });
  });
});
