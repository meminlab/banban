/**
 * 초대 링크로 들어왔는데 로그인이 필요할 때, 구글 로그인을 다녀오는 동안 코드를 기억해 둔다.
 * (구글 로그인은 다른 사이트로 이동했다 돌아오므로 화면 상태가 사라진다)
 */
const KEY = 'banban.pendingInvite';

export function savePendingInvite(code: string): void {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // 저장 못 해도 로그인 후 링크를 다시 열면 된다
  }
}

export function readPendingInvite(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearPendingInvite(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 무시
  }
}
