/**
 * 카테고리 아이콘 (design.md 4.1 · 5.17). 순수 함수, 화면·저장소와 무관.
 * - 저장 값: Lucide kebab-case 이름 (category.icon, null 허용)
 * - 앱이 그리는 아이콘은 아래 70개뿐. 값이 없거나 모르는 이름이면 대분류 아이콘 → 이름 첫 글자로 대신한다.
 */
import type { Category } from '../data/types';

export interface IconOption {
  key: string;
  /** 화면낭독용 한글 이름 */
  label: string;
}

export interface IconGroup {
  title: string;
  icons: IconOption[];
}

const g = (title: string, pairs: [string, string][]): IconGroup => ({
  title,
  icons: pairs.map(([key, label]) => ({ key, label })),
});

/** 아이콘 고르기 격자 (5.17 순서 그대로, 70개) */
export const ICON_GROUPS: readonly IconGroup[] = [
  g('먹기', [['utensils', '포크와 나이프'], ['coffee', '커피'], ['pizza', '피자'], ['wine', '와인'], ['cake', '케이크'], ['shopping-cart', '장바구니']]),
  g('쇼핑·생활', [['shopping-bag', '쇼핑백'], ['shirt', '옷'], ['scissors', '가위'], ['gem', '보석'], ['sofa', '소파'], ['spray-can', '세제']]),
  g('집·통신', [['house', '집'], ['key-round', '열쇠'], ['zap', '전기'], ['wifi', '와이파이'], ['smartphone', '휴대폰'], ['laptop', '노트북']]),
  g('이동', [['bus', '버스'], ['car', '자동차'], ['train-front', '기차'], ['plane', '비행기'], ['fuel', '주유'], ['bike', '자전거']]),
  g('건강·가족', [['heart-pulse', '심박'], ['pill', '약'], ['dumbbell', '운동'], ['stethoscope', '진료'], ['baby', '아기'], ['dog', '강아지']]),
  g('관계·마음', [['cat', '고양이'], ['paw-print', '발자국'], ['gift', '선물'], ['heart', '하트'], ['users', '사람들'], ['church', '교회']]),
  g('배움·여가', [['book', '책'], ['graduation-cap', '학사모'], ['palette', '팔레트'], ['guitar', '기타'], ['gamepad-2', '게임'], ['film', '영화']]),
  g('기타', [['camera', '카메라'], ['flower-2', '꽃'], ['wrench', '공구'], ['briefcase', '서류 가방'], ['coins', '동전'], ['receipt', '영수증']]),
  g('기본 카테고리 아이콘', [
    ['utensils-crossed', '엇갈린 포크와 나이프'], ['shopping-basket', '장바구니 바구니'], ['building', '건물'], ['tram-front', '전철'],
    ['parking-meter', '주차 미터기'], ['car-taxi-front', '택시'], ['tv', '텔레비전'], ['hospital', '병원 건물'], ['drama', '가면'],
    ['ticket', '티켓'], ['shield-check', '방패'], ['percent', '퍼센트'], ['banknote', '지폐'], ['sparkles', '반짝임'],
    ['hand-coins', '동전 쥔 손'], ['trending-up', '오름세'], ['piggy-bank', '저금통'], ['landmark', '은행'], ['chart-line', '그래프'],
    ['building-complex', '아파트'], ['life-buoy', '구명 튜브'], ['ellipsis', '더보기'],
  ]),
];

export const ICON_OPTIONS: readonly IconOption[] = ICON_GROUPS.flatMap((grp) => grp.icons);
const LABEL_BY_KEY = new Map(ICON_OPTIONS.map((o) => [o.key, o.label]));

export function isKnownIcon(key: string | null | undefined): key is string {
  return typeof key === 'string' && LABEL_BY_KEY.has(key);
}

export function iconLabel(key: string): string | undefined {
  return LABEL_BY_KEY.get(key);
}

/** 이름 첫 글자 (이모지·결합 문자도 한 글자로). 비어 있으면 "?" */
export function firstLetter(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const Seg = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Seg) {
    const first = new Seg('ko', { granularity: 'grapheme' }).segment(trimmed)[Symbol.iterator]().next().value;
    if (first) return first.segment.toUpperCase();
  }
  return [...trimmed][0].toUpperCase();
}

export type CategoryGlyph = { kind: 'icon'; key: string } | { kind: 'letter'; letter: string };

/**
 * 카테고리를 그릴 모양.
 * 자기 아이콘(목록 안) → 대분류 아이콘(목록 안) → 이름 첫 글자.
 */
export function categoryGlyph(
  category: Pick<Category, 'name' | 'icon'>,
  parent?: Pick<Category, 'icon'> | null,
): CategoryGlyph {
  if (isKnownIcon(category.icon)) return { kind: 'icon', key: category.icon };
  if (parent && isKnownIcon(parent.icon)) return { kind: 'icon', key: parent.icon };
  return { kind: 'letter', letter: firstLetter(category.name) };
}
