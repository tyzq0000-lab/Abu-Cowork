import { useSyncExternalStore } from 'react';
import {
  subscribeToBackgroundAgents,
  getBackgroundAgentsSnapshot,
  getBackgroundAgents,
  removeBackgroundAgent,
} from '@/core/agent/backgroundAgentRegistry';
import { cancelSubagent } from '@/core/agent/subagentAbort';
import { useI18n } from '@/i18n';
import { Bot, X, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function BackgroundAgents() {
  const { t } = useI18n();
  useSyncExternalStore(subscribeToBackgroundAgents, getBackgroundAgentsSnapshot);
  const agents = getBackgroundAgents();

  if (agents.length === 0) return null;

  return (
    <div className="px-4 pb-2 flex flex-wrap gap-1.5">
      {agents.map((agent) => {
        const elapsed = Math.round(((agent.endTime ?? Date.now()) - agent.startTime) / 1000);
        const isRunning = agent.status === 'running';
        const isError = agent.status === 'error';

        return (
          <div
            key={agent.taskId}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-all',
              isRunning && 'border-blue-300/50 bg-blue-50/50 text-blue-700',
              agent.status === 'completed' && 'border-green-300/50 bg-green-50/50 text-green-700',
              isError && 'border-red-300/50 bg-red-50/50 text-red-700',
            )}
          >
            {isRunning ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : agent.status === 'completed' ? (
              <CheckCircle className="h-3 w-3" />
            ) : (
              <AlertCircle className="h-3 w-3" />
            )}

            <Bot className="h-3 w-3" />
            <span className="font-medium max-w-[120px] truncate">{agent.agentName}</span>
            <span className="text-[10px] opacity-60">{elapsed}s</span>

            {isRunning && (
              <button
                onClick={() => {
                  cancelSubagent(agent.subagentId);
                  removeBackgroundAgent(agent.taskId);
                }}
                className="ml-0.5 p-0.5 rounded-full hover:bg-red-100 text-red-400 hover:text-red-600"
                title={t.chat.stop}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
