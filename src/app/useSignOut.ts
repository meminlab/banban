import { useState } from 'react';
import { signOut } from '../data/auth';

/** 로그아웃 버튼 상태. 성공하면 로그인 상태가 바뀌어 RequireAuth 가 로그인 화면으로 보낸다 */
export function useSignOut() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function run() {
    setBusy(true);
    setError(false);
    try {
      await signOut();
    } catch {
      setError(true);
      setBusy(false);
    }
  }
  return { run, busy, error };
}
