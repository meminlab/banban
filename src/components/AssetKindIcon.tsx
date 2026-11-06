import {
  Banknote,
  Car,
  CreditCard,
  Ellipsis,
  HandCoins,
  House,
  Landmark,
  PiggyBank,
  ReceiptText,
  TrendingUp,
  Vault,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { AssetKind } from '../data/types';

/** 자산 종류 아이콘 (design.md 5.20 표, Lucide) */
const ICONS: Record<AssetKind, LucideIcon> = {
  checking: Wallet,
  installment_saving: PiggyBank,
  deposit: Vault,
  investment: TrendingUp,
  pension: HandCoins,
  cash: Banknote,
  real_estate: House,
  vehicle: Car,
  other: Ellipsis,
  loan: Landmark,
  card_payable: CreditCard,
  other_liability: ReceiptText,
};

/** 장식용 아이콘 (종류 이름은 항상 글자로 같이 보인다) */
export function AssetKindIcon({ kind, size = 20 }: { kind: AssetKind; size?: number }) {
  const C = ICONS[kind];
  return <C size={size} strokeWidth={1.8} aria-hidden="true" focusable="false" />;
}
