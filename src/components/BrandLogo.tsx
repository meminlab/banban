// 원본은 docs/brand/ (BANB-22 확정 B-1). 인라인 SVG로 넣으면 mask id가 겹쳐 웃는 입이 사라질 수 있어 <img>로 쓴다.
import lockupDark from '../../docs/brand/banban-lockup-dark.svg';
import lockupLight from '../../docs/brand/banban-lockup-light.svg';

/**
 * 가로 조합 로고(심볼 + 워드마크). 장식이라 alt="" — 화면 제목은 h1이 맡는다.
 * 로고 색은 테마(클린·베리·포근)를 따르지 않고 고정. 기기가 다크 모드일 때만 다크용 로고 (docs/brand/README.md).
 */
export function BrandLogo({ className }: { className?: string }) {
  // viewBox 253.1 × 64 → 높이 44px일 때 가로 174px (CSS에서 height만 고정, width: auto로 비율 유지)
  return (
    <picture className="brand-logo-picture">
      <source srcSet={lockupDark} media="(prefers-color-scheme: dark)" />
      <img className={['brand-logo', className].filter(Boolean).join(' ')} src={lockupLight} alt="" width={174} height={44} />
    </picture>
  );
}
