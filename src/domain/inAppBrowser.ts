/**
 * 인앱 브라우저 판별·외부 브라우저 열기 주소 (화면과 분리된 순수 함수).
 * 지금은 카카오톡만 다룬다. 다른 인앱 브라우저(네이버·인스타그램 등)는 같은 형태로 늘리면 된다.
 */

/** 카카오톡 인앱 브라우저인지 (User-Agent 에 KAKAOTALK 이 들어 있다. 대소문자 무시) */
export function isKakaoInAppBrowser(userAgent: string | null | undefined): boolean {
  return /kakaotalk/i.test(userAgent ?? '');
}

/**
 * 카카오톡에서 휴대폰 기본 브라우저(크롬·사파리)로 같은 주소를 여는 스킴.
 * 경로·쿼리·해시까지 그대로 넘기도록 전체 주소를 인코딩한다.
 */
export function kakaoOpenExternalUrl(url: string): string {
  return `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;
}
