import { CircleDot, Clock, Heart, Receipt, type LucideIcon } from 'lucide-react';
import type { EventKind } from '../data/types';

/** 일정 종류 아이콘 (design.md 5.24): 기념일 Heart · 약속 Clock · 정기 지출일 Receipt · 기타 없음(행 원에서는 CircleDot) */
const KIND_ICON: Record<EventKind, LucideIcon | null> = {
  anniversary: Heart,
  appointment: Clock,
  bill_day: Receipt,
  other: null,
};

export function EventKindIcon({
  kind,
  size,
  strokeWidth = 2,
  fallback = false,
}: {
  kind: EventKind;
  size: number;
  strokeWidth?: number;
  /** 기타에도 아이콘이 필요한 곳(날짜 시트 행 원)은 CircleDot */
  fallback?: boolean;
}) {
  const Svg = KIND_ICON[kind] ?? (fallback ? CircleDot : null);
  if (!Svg) return null;
  return <Svg size={size} strokeWidth={strokeWidth} aria-hidden="true" focusable="false" />;
}
