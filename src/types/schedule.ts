/**
 * Scheduled Task Types
 */

export type ScheduleFrequency = 'hourly' | 'daily' | 'weekly' | 'weekdays' | 'manual';
export type ScheduledTaskStatus = 'active' | 'paused';
export type ScheduledRunStatus = 'running' | 'completed' | 'error';

export interface ScheduleConfig {
  frequency: ScheduleFrequency;
  /** Execution time (hour:minute). For hourly, only minute is used. */
  time?: { hour: number; minute: number };
  /** Day of week for 'weekly' frequency (0=Sunday, 1=Monday, ..., 6=Saturday) */
  dayOfWeek?: number;
}

export interface EmployeeTemplateSource {
  kind: 'employee-template';
  employeeName: string;
  templateId: string;
}

export interface ScheduledTask {
  id: string;
  name: string;
  /** Optional description / purpose of the task */
  description?: string;
  prompt: string;
  schedule: ScheduleConfig;
  status: ScheduledTaskStatus;
  /** Optional skill binding */
  skillName?: string;
  /** Optional employee/agent binding for unattended execution. */
  agentName?: string;
  /** Optional workspace path */
  workspacePath?: string;
  /** Optional IM channel ID to push results to after completion */
  outputChannelId?: string;
  /** Comma-separated group chat IDs to push to */
  outputChatIds?: string;
  /** Comma-separated user open_ids to DM */
  outputUserIds?: string;
  /** Project this task belongs to */
  projectId?: string;
  /** Installed from a digital employee package workflow template. */
  source?: EmployeeTemplateSource;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
  /** Recent run history (max 20) */
  runs: ScheduledTaskRun[];
  totalRuns: number;
}

export interface ScheduledTaskRun {
  id: string;
  scheduledTaskId: string;
  /** Associated conversation ID for viewing results */
  conversationId: string;
  startedAt: number;
  completedAt?: number;
  status: ScheduledRunStatus;
  error?: string;
}
