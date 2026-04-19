import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  queueToInbox,
  getPendingInbox,
  markDelivered,
  cleanupInbox,
} from './inbox';
import type { Notice } from './types';

vi.mocked(invoke).mockResolvedValue(undefined);

function makeNotice(overrides: Partial<Notice> = {}): Notice {
  return {
    id: 'ntc_test',
    type: 'skill_proposal_offer',
    tier: 'L2',
    source: 'self_evolving',
    payload: {},
    dedupKey: 'k',
    createdAt: 1_000_000,
    ttl: 86_400_000,
    ...overrides,
  };
}

describe('Notice Inbox (SQLite via invoke)', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  describe('queueToInbox', () => {
    it('calls notice_inbox_insert with serialized notice', () => {
      const notice = makeNotice();
      queueToInbox(notice);

      expect(invoke).toHaveBeenCalledWith('notice_inbox_insert', {
        entry: {
          notice_id: 'ntc_test',
          notice_json: JSON.stringify(notice),
          tier: 'L2',
          queued_at: 1_000_000,
          expires_at: 1_000_000 + 86_400_000,
        },
      });
    });

    it('defaults TTL to 24h when notice.ttl is undefined', () => {
      const notice = makeNotice({ ttl: undefined });
      queueToInbox(notice);

      expect(invoke).toHaveBeenCalledWith(
        'notice_inbox_insert',
        expect.objectContaining({
          entry: expect.objectContaining({
            expires_at: 1_000_000 + 24 * 60 * 60 * 1000,
          }),
        }),
      );
    });
  });

  describe('getPendingInbox', () => {
    it('calls notice_inbox_pending with current time', async () => {
      const mockEntries = [
        {
          id: 1,
          notice_id: 'ntc_1',
          notice_json: '{}',
          tier: 'L2',
          queued_at: 1_000_000,
          expires_at: 2_000_000,
          delivered: false,
        },
      ];
      vi.mocked(invoke).mockResolvedValue(mockEntries);

      const result = await getPendingInbox();

      expect(invoke).toHaveBeenCalledWith('notice_inbox_pending', {
        now: expect.any(Number),
      });
      expect(result).toEqual(mockEntries);
    });
  });

  describe('markDelivered', () => {
    it('calls notice_inbox_mark_delivered', () => {
      markDelivered('ntc_abc');
      expect(invoke).toHaveBeenCalledWith('notice_inbox_mark_delivered', {
        noticeId: 'ntc_abc',
      });
    });
  });

  describe('cleanupInbox', () => {
    it('calls notice_inbox_cleanup and returns deleted count', async () => {
      vi.mocked(invoke).mockResolvedValue(5);
      const count = await cleanupInbox();
      expect(invoke).toHaveBeenCalledWith('notice_inbox_cleanup', {
        now: expect.any(Number),
      });
      expect(count).toBe(5);
    });
  });
});
