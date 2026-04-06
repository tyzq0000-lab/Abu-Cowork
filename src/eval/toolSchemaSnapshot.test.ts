/**
 * L1 — Tool schema snapshot tests
 *
 * Tool schemas directly affect LLM tool-calling behavior.
 * This test catches accidental schema changes that could break Agent behavior.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { registerBuiltinTools } from '@/core/tools/builtins';
import { toolRegistry } from '@/core/tools/registry';
import { TOOL_NAMES } from '@/core/tools/toolNames';

beforeAll(() => {
  registerBuiltinTools();
});

describe('Tool schema snapshot', () => {
  it('all tool schemas match snapshot', () => {
    const tools = toolRegistry.getAll();
    // Sort by name for deterministic ordering
    const schemas = tools
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(t => ({
        name: t.name,
        // Only snapshot the schema structure, not the full description (too noisy)
        requiredParams: t.inputSchema.required ?? [],
        paramNames: Object.keys(t.inputSchema.properties).sort(),
      }));
    expect(schemas).toMatchSnapshot();
  });
});

describe('Critical tools existence', () => {
  const criticalTools = [
    TOOL_NAMES.READ_FILE,
    TOOL_NAMES.WRITE_FILE,
    TOOL_NAMES.EDIT_FILE,
    TOOL_NAMES.LIST_DIRECTORY,
    TOOL_NAMES.SEARCH_FILES,
    TOOL_NAMES.FIND_FILES,
    TOOL_NAMES.RUN_COMMAND,
    TOOL_NAMES.WEB_SEARCH,
    TOOL_NAMES.HTTP_FETCH,
    TOOL_NAMES.USE_SKILL,
    TOOL_NAMES.DELEGATE_TO_AGENT,
    TOOL_NAMES.REPORT_PLAN,
    TOOL_NAMES.UPDATE_MEMORY,
    TOOL_NAMES.RECALL,
  ];

  it.each(criticalTools)('tool "%s" is registered', (toolName) => {
    expect(toolRegistry.has(toolName)).toBe(true);
  });
});

describe('Tool count stability', () => {
  it('total builtin tool count matches snapshot', () => {
    const count = toolRegistry.getAll().length;
    // This snapshot catches unintended tool additions/removals
    expect(count).toMatchSnapshot();
  });
});

describe('Tool schema invariants', () => {
  it('all tools have non-empty name and description', () => {
    for (const tool of toolRegistry.getAll()) {
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('all tools have object-type input schema', () => {
    for (const tool of toolRegistry.getAll()) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it('all required params exist in properties', () => {
    for (const tool of toolRegistry.getAll()) {
      const required = tool.inputSchema.required ?? [];
      const propNames = Object.keys(tool.inputSchema.properties);
      for (const req of required) {
        expect(propNames).toContain(req);
      }
    }
  });

  it('all tools have an execute function', () => {
    for (const tool of toolRegistry.getAll()) {
      expect(typeof tool.execute).toBe('function');
    }
  });
});
