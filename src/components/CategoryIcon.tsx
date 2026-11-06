import {
  Baby, Banknote, Bike, Book, Briefcase, Building, BuildingComplex, Bus, Cake, Camera, Car, CarTaxiFront, Cat,
  ChartLine, Church, Coffee, Coins, Dog, Drama, Dumbbell, Ellipsis, Film, Flower2, Fuel, Gamepad2, Gem, Gift,
  GraduationCap, Guitar, HandCoins, Heart, HeartPulse, Hospital, House, KeyRound, Landmark, Laptop, LifeBuoy,
  Palette, ParkingMeter, PawPrint, Percent, PiggyBank, Pill, Pizza, Plane, Receipt, Scissors, ShieldCheck, Shirt,
  ShoppingBag, ShoppingBasket, ShoppingCart, Smartphone, Sofa, Sparkles, SprayCan, Stethoscope, Ticket, TrainFront,
  TramFront, TrendingUp, Tv, Users, Utensils, UtensilsCrossed, Wifi, Wine, Wrench, Zap,
  type LucideIcon,
} from 'lucide-react';
import type { Category } from '../data/types';
import { categoryGlyph, type CategoryGlyph } from '../domain/categoryIcon';

/** design.md 5.17 아이콘 목록 70개만 번들에 넣는다 (키 = Lucide kebab-case) */
export const CATEGORY_ICON_COMPONENTS: Record<string, LucideIcon> = {
  utensils: Utensils, coffee: Coffee, pizza: Pizza, wine: Wine, cake: Cake, 'shopping-cart': ShoppingCart,
  'shopping-bag': ShoppingBag, shirt: Shirt, scissors: Scissors, gem: Gem, sofa: Sofa, 'spray-can': SprayCan,
  house: House, 'key-round': KeyRound, zap: Zap, wifi: Wifi, smartphone: Smartphone, laptop: Laptop,
  bus: Bus, car: Car, 'train-front': TrainFront, plane: Plane, fuel: Fuel, bike: Bike,
  'heart-pulse': HeartPulse, pill: Pill, dumbbell: Dumbbell, stethoscope: Stethoscope, baby: Baby, dog: Dog,
  cat: Cat, 'paw-print': PawPrint, gift: Gift, heart: Heart, users: Users, church: Church,
  book: Book, 'graduation-cap': GraduationCap, palette: Palette, guitar: Guitar, 'gamepad-2': Gamepad2, film: Film,
  camera: Camera, 'flower-2': Flower2, wrench: Wrench, briefcase: Briefcase, coins: Coins, receipt: Receipt,
  'utensils-crossed': UtensilsCrossed, 'shopping-basket': ShoppingBasket, building: Building, 'tram-front': TramFront,
  'parking-meter': ParkingMeter, 'car-taxi-front': CarTaxiFront, tv: Tv, hospital: Hospital, drama: Drama,
  ticket: Ticket, 'shield-check': ShieldCheck, percent: Percent, banknote: Banknote, sparkles: Sparkles,
  'hand-coins': HandCoins, 'trending-up': TrendingUp, 'piggy-bank': PiggyBank, landmark: Landmark,
  'chart-line': ChartLine, 'building-complex': BuildingComplex, 'life-buoy': LifeBuoy, ellipsis: Ellipsis,
};

/** 아이콘 하나 (장식용, 이름은 항상 글자로 같이 보인다) */
export function LucideByKey({ iconKey, size }: { iconKey: string; size: number }) {
  const C = CATEGORY_ICON_COMPONENTS[iconKey] ?? Ellipsis;
  return <C size={size} strokeWidth={2} aria-hidden="true" focusable="false" />;
}

export type CategoryIconSize = 'row' | 'grid' | 'preview' | 'inline';

/** 원 지름 / 아이콘 크기 / 첫 글자 크기 (design.md 4.1: 목록 40/20, 격자 48/22, 미리보기 64/30) */
const SIZES: Record<CategoryIconSize, { icon: number }> = {
  inline: { icon: 16 },
  row: { icon: 20 },
  grid: { icon: 22 },
  preview: { icon: 30 },
};

/** 모양이 정해진 원 (선택 상태 색은 부모 CSS가 정한다) */
export function GlyphCircle({ glyph, size }: { glyph: CategoryGlyph; size: CategoryIconSize }) {
  return (
    <span className={`cat-icon cat-icon--${size}`} aria-hidden="true">
      {glyph.kind === 'icon' ? <LucideByKey iconKey={glyph.key} size={SIZES[size].icon} /> : <span className="cat-icon__letter">{glyph.letter}</span>}
    </span>
  );
}

/** 카테고리 아이콘 원: 자기 아이콘 → 대분류 아이콘 → 이름 첫 글자 */
export function CategoryIcon({
  category,
  parent,
  size = 'row',
}: {
  category: Pick<Category, 'name' | 'icon'>;
  parent?: Pick<Category, 'icon'> | null;
  size?: CategoryIconSize;
}) {
  return <GlyphCircle glyph={categoryGlyph(category, parent)} size={size} />;
}
