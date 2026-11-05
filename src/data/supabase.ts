/**
 * 저장소 접근은 src/data 아래에서만 한다.
 * 화면 코드는 supabase 클라이언트를 직접 import 하지 않고 이 폴더의 함수를 쓴다.
 * (저장소를 바꾸게 되면 이 폴더만 수정)
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 환경변수가 없습니다. .env.example 참고');
  }
  client = createClient(url, anonKey);
  return client;
}
