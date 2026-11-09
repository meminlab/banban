/**
 * 일정 조회·추가·수정·삭제. 권한은 DB 행 단위 규칙이 가계부 현재 멤버로 제한한다.
 * 만든 사람·수정한 사람·시각·D-day 고정 시각은 DB 트리거가 정한다(보낸 값은 무시).
 */
import type { EventInput } from '../domain/event';
import { getSupabase } from './supabase';
import type { CalendarEvent } from './types';

const COLUMNS =
  'id, ledger_id, title, kind, event_date, all_day, start_time, repeat, lunar_month, lunar_day, target_member_id, place, memo, pinned_at, created_by, updated_by, created_at, updated_at';

/** 수정·삭제하려는 일정이 없음 (다른 멤버가 지웠거나 권한이 없어짐) */
export class EventNotFoundError extends Error {
  constructor() {
    super('EVENT_NOT_FOUND');
    this.name = 'EventNotFoundError';
  }
}

/** D-day 고정이 이미 2개 (다른 멤버가 먼저 고정한 경우 포함) */
export class EventPinLimitError extends Error {
  constructor() {
    super('EVENT_PIN_LIMIT');
    this.name = 'EventPinLimitError';
  }
}

function toRow(input: EventInput, keepPinnedAt?: string | null) {
  const { pinned, ...rest } = input;
  // 고정 시각은 서버가 정한다. 보낸 값은 "고정 여부"로만 쓰인다
  return { ...rest, pinned_at: pinned ? (keepPinnedAt ?? new Date().toISOString()) : null };
}

function rethrow(error: { message?: string }): never {
  if (error.message?.includes('EVENT_PIN_LIMIT')) throw new EventPinLimitError();
  throw error;
}

/**
 * [start, end] 달력에 보일 수 있는 일정: 그 범위 안의 반복 안 함 일정 + 범위 끝 전에 시작한 반복 일정.
 * 펼치기는 domain/event 의 expandEvents
 */
export async function listEventsForRange(ledgerId: string, start: string, end: string): Promise<CalendarEvent[]> {
  const { data, error } = await getSupabase()
    .from('event')
    .select(COLUMNS)
    .eq('ledger_id', ledgerId)
    .lte('event_date', end)
    .or(`repeat.neq.none,event_date.gte.${start}`)
    .order('event_date')
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as CalendarEvent[];
}

/**
 * 홈 함께한 날 카드용 기념일 (BANB-43): 반복 기념일 전부 + 오늘 이후의 반복 안 함 기념일.
 * 고를 줄(고정 먼저·30일 안)은 domain/togetherCard 의 pickDdays
 */
export async function listUpcomingAnniversaries(ledgerId: string, today: string): Promise<CalendarEvent[]> {
  const { data, error } = await getSupabase()
    .from('event')
    .select(COLUMNS)
    .eq('ledger_id', ledgerId)
    .eq('kind', 'anniversary')
    .or(`repeat.neq.none,event_date.gte.${today}`)
    .order('event_date')
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as CalendarEvent[];
}

/** 이 가계부에 일정이 하나라도 있나 (일정 없음 안내) */
export async function hasAnyEvent(ledgerId: string): Promise<boolean> {
  const { data, error } = await getSupabase().from('event').select('id').eq('ledger_id', ledgerId).limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** D-day 고정한 일정 id (가계부당 최대 2개) */
export async function listPinnedEventIds(ledgerId: string): Promise<string[]> {
  const { data, error } = await getSupabase()
    .from('event')
    .select('id')
    .eq('ledger_id', ledgerId)
    .not('pinned_at', 'is', null);
  if (error) throw error;
  return (data ?? []).map((r) => r.id as string);
}

export async function getEvent(id: string): Promise<CalendarEvent | null> {
  const { data, error } = await getSupabase().from('event').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as CalendarEvent | null) ?? null;
}

export async function createEvent(ledgerId: string, input: EventInput): Promise<CalendarEvent> {
  const { data, error } = await getSupabase()
    .from('event')
    .insert({ ledger_id: ledgerId, ...toRow(input) })
    .select(COLUMNS)
    .single();
  if (error) rethrow(error);
  return data as CalendarEvent;
}

/** 나중에 저장한 쪽으로 덮어쓴다. 반복 일정은 1건이라 모든 날짜에 반영된다 */
export async function updateEvent(id: string, input: EventInput, pinnedAt: string | null): Promise<CalendarEvent> {
  const { data, error } = await getSupabase().from('event').update(toRow(input, pinnedAt)).eq('id', id).select(COLUMNS);
  if (error) rethrow(error);
  if (!data || data.length === 0) throw new EventNotFoundError();
  return data[0] as CalendarEvent;
}

/** 삭제 (반복 일정이면 모든 날짜). 이미 없으면 EventNotFoundError */
export async function deleteEvent(id: string): Promise<void> {
  const { data, error } = await getSupabase().from('event').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new EventNotFoundError();
}
