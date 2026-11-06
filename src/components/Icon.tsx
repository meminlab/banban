import { ChevronLeft, House, Landmark, NotebookPen, Plus, Settings, type LucideIcon } from 'lucide-react';
import type { TabIcon } from '../app/routes';

type IconName = TabIcon | 'settings' | 'back' | 'add';

/** 앱 공통 아이콘 (design.md 4절 매핑, Lucide 한 세트만) */
const ICONS: Record<IconName, LucideIcon> = {
  home: House,
  ledger: NotebookPen,
  assets: Landmark,
  settings: Settings,
  back: ChevronLeft,
  add: Plus,
};

/** 장식용 아이콘. 크기 24·선 굵기 1.75가 기본 (헤더·탭바). 색은 글자 색을 따른다. 뜻은 감싼 버튼의 aria-label이 맡는다 */
export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  const Svg = ICONS[name];
  return <Svg size={size} strokeWidth={size >= 24 ? 1.75 : 2} aria-hidden="true" focusable="false" />;
}
