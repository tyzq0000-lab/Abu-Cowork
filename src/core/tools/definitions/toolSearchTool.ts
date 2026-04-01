import type { ToolDefinition, ToolResult } from '../../../types';
import { TOOL_NAMES } from '../toolNames';
import { getAllTools } from '../registry';
import { searchTools, promoteToolToSession } from '../toolSearch';

/**
 * tool_search — lets the LLM discover and load deferred tools on demand.
 *
 * When tools are deferred (only name + description in system prompt),
 * the LLM calls this tool to get the full input schema before invoking them.
 * Matched tools are automatically promoted to session-core for subsequent turns.
 */
export const toolSearchTool: ToolDefinition = {
  name: TOOL_NAMES.TOOL_SEARCH,
  description: '搜索并加载延迟加载的工具。当你需要使用系统提示中列出的延迟加载工具时，先用此工具获取完整参数定义，然后就可以在后续回合中直接调用该工具。',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词，可以是工具名称或功能描述',
      },
      max_results: {
        type: 'number',
        description: '最多返回几个结果（默认 5）',
      },
    },
    required: ['query'],
  },
  isConcurrencySafe: true,
  async execute(input): Promise<ToolResult> {
    const query = input.query as string;
    const maxResults = (input.max_results as number) ?? 5;

    const allTools = getAllTools();
    const matched = searchTools(query, allTools, maxResults);

    if (matched.length === 0) {
      return `未找到匹配 "${query}" 的工具。请尝试其他关键词。`;
    }

    // Promote matched tools to session core
    for (const tool of matched) {
      promoteToolToSession(tool.name);
    }

    // Return full schema for each matched tool
    const results = matched.map(tool => {
      const schema = JSON.stringify(tool.inputSchema, null, 2);
      return `### ${tool.name}\n${tool.description}\n\n参数 Schema:\n\`\`\`json\n${schema}\n\`\`\``;
    });

    return `找到 ${matched.length} 个工具：\n\n${results.join('\n\n---\n\n')}\n\n以上工具已加载，可以在后续回合中直接调用。`;
  },
};
