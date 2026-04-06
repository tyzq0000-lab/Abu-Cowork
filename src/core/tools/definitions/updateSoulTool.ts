import type { ToolDefinition } from '../../../types';
import { saveSoul } from '../../agent/soulConfig';
import { useSettingsStore } from '../../../stores/settingsStore';
import { TOOL_NAMES } from '../toolNames';

export const updateSoulTool: ToolDefinition = {
  name: TOOL_NAMES.UPDATE_SOUL,
  description: '更新你的性格设定。当用户要求你调整性格或沟通风格时调用此工具。写入完整内容（不是增量），会替换现有设定。',
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: '完整的性格设定内容（markdown 格式）',
      },
    },
    required: ['content'],
  },
  execute: async (input) => {
    const content = (input.content as string || '').trim();
    if (!content) {
      return '错误：性格设定内容不能为空。';
    }

    try {
      await saveSoul(content);
      // Mark soul as initialized (bootstrap won't trigger again)
      useSettingsStore.getState().setSoulInitialized(true);
      return '性格设定已更新，下次新对话生效。';
    } catch (err) {
      return `更新失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
