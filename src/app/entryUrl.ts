/**
 * 사용자가 처음 연 주소 (예: 카카오톡에서 누른 초대 링크).
 * 앱은 로그인 안 한 사용자를 /login 으로 바꿔 보내므로, 그 전에 기억해 둔다.
 * 다른 브라우저로 열 때 이 주소를 넘겨야 경로·쿼리(초대 코드 등)가 유지된다.
 * (초대 코드를 이 브라우저 저장소에 기억해 둬도 다른 브라우저에서는 보이지 않는다)
 */
let entryUrl: string | null = null;

/** 앱 시작 시 라우터가 주소를 바꾸기 전에 한 번 부른다 */
export function captureEntryUrl(href: string = window.location.href): void {
  if (entryUrl === null) entryUrl = href;
}

/** 처음 연 주소. 기억해 둔 게 없으면 지금 주소 */
export function getEntryUrl(): string {
  return entryUrl ?? window.location.href;
}

/** 테스트용 */
export function resetEntryUrl(): void {
  entryUrl = null;
}
