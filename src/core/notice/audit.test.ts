import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { recordAudit, queryAudit, aggregateDecisions } from './audit';
import type { Notice } from './types';
import type { GateDecision } from './gate';
import type { DeliveryTarget } from './router';

vi.mocked(invoke).mockResolvedValue(undefined);

function makeNotice(overrides: Partial<Notice> = {}): Notice {
  return {
    id: 'ntc_test',
    type: 'task_complete',
    tier: 'L1',
    source: 'agent',
    payload: {},
    dedupKey: 'k',
    createdAt: 1_000_000,
    ...overrides,
  };
}

describe('Notice Audit (SQLite via invoke)', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  describe('recordAudit', () => {
    it('calls notice_audit_insert with correct shape', () => {
      const notice = makeNotice();
      const decision: GateDecision = { action: 'allow' };
      const targets: DeliveryTarget[] = [
        { channel: 'system_notification' },
        { channel: 'menubar' },
      ];

      recordAudit(notice, decision, targets);

      expect(invoke).toHaveBeenCalledWith('notice_audit_insert', {
        entry: {
          notice_id: 'ntc_test',
          type: 'task_complete',
          tier: 'L1',
          source: 'agent',
          decision: 'allow',
          reason: null,
          delivered_to: ['system_notification', 'menubar'],
          timestamp: 1_000_000,
        },
      });
    });

    it('includes reason for non-allow decisions', () => {
      const notice = makeNotice({ tier: 'L2', type: 'skill_proposal_offer' });
      const decision: GateDecision = {
        action: 'queue_inbox',
        reason: 'fullscreen:Keynote',
      };

      recordAudit(notice, decision, []);

      expect(invoke).toHaveBeenCalledWith(
        'notice_audit_insert',
        expect.objectContaining({
          entry: expect.objectContaining({
            decision: 'queue_inbox',
            reason: 'fullscreen:Keynote',
            delivered_to: [],
          }),
        }),
      );
    });
  });

  describe('queryAudit', () => {
    it('calls notice_audit_query and returns results', async () => {
      const mockEntries = [
        {
          id: 1,
          notice_id: 'ntc_1',
          type: 'task_complete',
          tier: 'L1',
          source: 'agent',
          decision: 'allow',
          reason: null,
          delivered_to: ['system_notification'],
          timestamp: 1_000_000,
        },
      ];
      vi.mocked(invoke).mockResolvedValue(mockEntries);

      const result = await queryAudit(900_000, 1_100_000, 'task_complete', 50);

      expect(invoke).toHaveBeenCalledWith('notice_audit_query', {
        since: 900_000,
        until: 1_100_000,
        noticeType: 'task_complete',
        limit: 50,
      });
      expect(result).toEqual(mockEntries);
    });
  });

  describe('aggregateDecisions', () => {
    it('calls notice_audit_aggregate and converts pairs to record', async () => {
      vi.mocked(invoke).mockResolvedValue([
        ['allow', 10],
        ['drop', 3],
        ['queue_inbox', 2],
      ]);

      const result = await aggregateDecisions(0, 2_000_000);

      expect(invoke).toHaveBeenCalledWith('notice_audit_aggregate', {
        since: 0,
        until: 2_000_000,
      });
      expect(result).toEqual({ allow: 10, drop: 3, queue_inbox: 2 });
    });
  });
});
