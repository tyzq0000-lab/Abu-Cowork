/**
 * Notice menubar store — tracks notices delivered to the menubar channel.
 *
 * Purely ephemeral (no persist): menubar state resets on restart.
 *
 * Wired via `registerChannel('menubar', ...)` from pipeline.
 * When count changes, calls Rust `update_tray_notice_count` to update
 * the tray icon title/tooltip.
 */

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { registerChannel } from '@/core/notice/pipeline';
import type { Notice } from '@/core/notice/types';

interface MenubarNotice {
  id: string;
  type: string;
  tier: string;
  summary: string;
  createdAt: number;
}

interface NoticeMenubarState {
  /** Pending notices shown in menubar, newest first. */
  notices: MenubarNotice[];
}

interface NoticeMenubarActions {
  addNotice: (notice: Notice) => void;
  dismiss: (noticeId: string) => void;
  dismissAll: () => void;
}

type NoticeMenubarStore = NoticeMenubarState & NoticeMenubarActions;

function summarize(notice: Notice): string {
  const typeLabels: Record<string, string> = {
    meeting_prep: '会议准备',
    permission_request: '权限请求',
    user_input_needed: '需要输入',
    agent_error: 'Agent 错误',
    schedule_fired: '定时任务触发',
    task_complete: '任务完成',
    skill_proposal_offer: '技能建议',
    skill_draft_ready: '技能草稿就绪',
    skill_patch: '技能更新',
    stuck_detection: '任务卡住',
    im_inbound: '收到消息',
    context_resume: '上下文恢复',
    deep_focus_enter: '进入深度专注',
    deep_focus_exit: '退出深度专注',
  };
  return typeLabels[notice.type] ?? notice.type;
}

function syncTrayCount(count: number) {
  try {
    const result = invoke('update_tray_notice_count', { count });
    if (result && typeof (result as Promise<void>).catch === 'function') {
      (result as Promise<void>).catch(() => {
        // Tray might not be available in dev/test
      });
    }
  } catch {
    // invoke mock may not return a Promise in test env
  }
}

export const useNoticeMenubarStore = create<NoticeMenubarStore>()((set) => ({
  notices: [],

  addNotice: (notice: Notice) => {
    const entry: MenubarNotice = {
      id: notice.id,
      type: notice.type,
      tier: notice.tier,
      summary: summarize(notice),
      createdAt: notice.createdAt,
    };
    set((state) => {
      const next = [entry, ...state.notices].slice(0, 50);
      syncTrayCount(next.length);
      return { notices: next };
    });
  },

  dismiss: (noticeId: string) => {
    set((state) => {
      const next = state.notices.filter((n) => n.id !== noticeId);
      syncTrayCount(next.length);
      return { notices: next };
    });
  },

  dismissAll: () => {
    set({ notices: [] });
    syncTrayCount(0);
  },
}));

/** Count of pending menubar notices. */
export function useMenubarNoticeCount(): number {
  return useNoticeMenubarStore((s) => s.notices.length);
}

// ── Channel registration ───────────────────────────────────────────────

let registered = false;

/**
 * Register the menubar channel handler. Call once at app init.
 * Idempotent — safe to call multiple times.
 */
export function initMenubarChannel(): void {
  if (registered) return;
  registered = true;

  registerChannel('menubar', (notice: Notice) => {
    useNoticeMenubarStore.getState().addNotice(notice);
  });
}
