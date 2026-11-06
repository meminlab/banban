// 원본은 docs/brand/ (BANB-22 확정 B-1). 인라인 SVG로 넣으면 mask id가 겹쳐 웃는 입이 사라질 수 있어 <img>로 쓴다.
import lockupLight from '../../docs/brand/banban-lockup-light.svg';

/** 가로 조합 로고(심볼 + 워드마크). 장식이라 alt="" — 화면 제목은 h1이 맡는다. 색은 테마와 상관없이 고정. */
export function BrandLogo({ className }: { className?: string }) {
  // viewBox 253.1 × 64 → 높이 44px일 때 가로 174px (CSS에서 height만 고정, width: auto로 비율 유지)
  return <img className={['brand-logo', className].filter(Boolean).join(' ')} src={lockupLight} alt="" width={174} height={44} />;
}
