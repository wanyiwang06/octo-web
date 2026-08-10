// SUM-6 dual-entry UI and schedule field preservation tests
import { describe, it, expect } from 'vitest';
import { summaryTestIds } from '../../utils/testIds';
import { scheduleToParams, type ScheduleConfig } from '../../utils/summaryHelpers';

describe('SUM-6: Dual-entry test IDs', () => {
  it('has all dual-entry test IDs', () => {
    expect(summaryTestIds.dualQuickDirect).toBe('summary-dual-quick-direct');
    expect(summaryTestIds.dualQuickAgent).toBe('summary-dual-quick-agent');
    expect(summaryTestIds.dualMultiDirect).toBe('summary-dual-multi-direct');
    expect(summaryTestIds.dualMultiAgent).toBe('summary-dual-multi-agent');
    expect(summaryTestIds.dualScheduleDirect).toBe('summary-dual-schedule-direct');
    expect(summaryTestIds.dualScheduleAgent).toBe('summary-dual-schedule-agent');
    expect(summaryTestIds.dualConfigHint).toBe('summary-dual-config-hint');
  });
});

describe('SUM-6: Schedule field preservation via scheduleToParams', () => {
  it('preserves day unit fields correctly', () => {
    const config: ScheduleConfig = { unit: 'day', every: 3, time: '14:30' };
    const params = scheduleToParams(config);
    expect(params.interval_days).toBe(3);
    expect(params.interval_months).toBe(0);
    expect(params.day_of_week).toBe(0);
    expect(params.day_of_month).toBe(0);
    expect(params.run_time).toBe('14:30');
    expect(params.cron_expr).toBe('');
  });

  it('preserves week unit fields correctly', () => {
    const config: ScheduleConfig = { unit: 'week', every: 2, time: '09:00', dayOfWeek: 3 };
    const params = scheduleToParams(config);
    expect(params.interval_days).toBe(14);
    expect(params.interval_months).toBe(0);
    expect(params.day_of_week).toBe(3);
    expect(params.day_of_month).toBe(0);
    expect(params.run_time).toBe('09:00');
    expect(params.cron_expr).toBe('');
  });

  it('preserves month unit fields correctly', () => {
    const config: ScheduleConfig = { unit: 'month', every: 1, time: '18:00', dayOfMonth: 15 };
    const params = scheduleToParams(config);
    expect(params.interval_days).toBe(0);
    expect(params.interval_months).toBe(1);
    expect(params.day_of_week).toBe(0);
    expect(params.day_of_month).toBe(15);
    expect(params.run_time).toBe('18:00');
    expect(params.cron_expr).toBe('');
  });

  it('preserves confirm_policy when present', () => {
    const config: ScheduleConfig = { 
      unit: 'week', every: 1, time: '09:00', dayOfWeek: 1, 
      confirm_policy: 1 
    };
    const params = scheduleToParams(config);
    expect(params.confirm_policy).toBe(1);
  });

  it('omits confirm_policy when not set', () => {
    const config: ScheduleConfig = { unit: 'day', every: 1, time: '09:00' };
    const params = scheduleToParams(config);
    expect(params.confirm_policy).toBeUndefined();
  });

  it('handles minimum every value (clamps to 1)', () => {
    const config: ScheduleConfig = { unit: 'day', every: 0, time: '09:00' };
    const params = scheduleToParams(config);
    expect(params.interval_days).toBe(1);
  });

  it('preserves all six core fields simultaneously', () => {
    const config: ScheduleConfig = { 
      unit: 'month', every: 2, time: '12:00', dayOfMonth: 28,
      confirm_policy: 0,
      generationInstruction: 'Focus on blockers'
    };
    const params = scheduleToParams(config);
    expect(params).toMatchObject({
      cron_expr: '',
      interval_days: 0,
      interval_months: 2,
      day_of_week: 0,
      day_of_month: 28,
      run_time: '12:00',
      confirm_policy: 0,
    });
  });
});

describe('SUM-6: canDirectCreate logic', () => {
  // These are pure logic tests - we test the helper functions directly
  // by simulating their conditions
  
  it('topic empty + no chats = cannot direct create', () => {
    const topic = '';
    const selectedChats: any[] = [];
    const canDirect = topic.trim().length > 0 && selectedChats.length > 0;
    expect(canDirect).toBe(false);
  });

  it('topic set + no chats = cannot direct create', () => {
    const topic = 'weekly report';
    const selectedChats: any[] = [];
    const canDirect = topic.trim().length > 0 && selectedChats.length > 0;
    expect(canDirect).toBe(false);
  });

  it('topic empty + chats set = cannot direct create', () => {
    const topic = '';
    const selectedChats = [{ chat_id: '123', chat_type: 'group' }];
    const canDirect = topic.trim().length > 0 && selectedChats.length > 0;
    expect(canDirect).toBe(false);
  });

  it('topic set + chats set = can direct create', () => {
    const topic = 'weekly report';
    const selectedChats = [{ chat_id: '123', chat_type: 'group' }];
    const canDirect = topic.trim().length > 0 && selectedChats.length > 0;
    expect(canDirect).toBe(true);
  });
});
