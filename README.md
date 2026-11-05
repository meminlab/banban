# banban

부부(나중엔 n명)가 같이 쓰는 공동 가계부. 모바일 웹.

## 기술 스택 (운영 비용 0원)

| 영역 | 선택 | 이유 |
|---|---|---|
| 화면 | React + TypeScript + Vite | 정적 파일로 빌드돼서 무료 호스팅에 그대로 올라간다 |
| DB·인증 | **Supabase 무료 요금제** | Postgres + 구글 로그인 + 행 단위 권한(RLS)을 서버 없이 쓸 수 있다. 무료 한도(DB 500MB, 월간 활성 사용자 5만)가 2인 가계부에 충분하다 |
| 호스팅 | **Cloudflare Pages 무료 요금제** | 대역폭 무제한·상업적 사용 제한 없음, GitHub 연결 시 `main` 푸시마다 자동 배포, PR마다 미리보기 URL |
| 테스트 | Vitest + Testing Library / Docker Postgres | 화면 테스트, 스키마·권한 규칙 테스트 |

> Supabase 무료 프로젝트는 **7일 동안 요청이 없으면 일시 정지**된다. 대시보드에서 다시 켜면 데이터는 그대로다. (비용 발생 없음)

### 폴더 구조

```
src/
  app/          라우팅, 탭 정의
  components/   공통 UI (상단바·하단 탭·아이콘)
  pages/        화면 (홈 / 가계부 / 자산 / 설정)
  data/         저장소 접근은 여기서만 (supabase 클라이언트, DB 행 타입)
supabase/
  migrations/   DB 스키마·권한 규칙 (SQL)
  tests/        스키마·권한 규칙 테스트 (Docker로 실행)
```

## 로컬 실행

필요: Node.js 20 이상 (권장 22)

```bash
npm install
cp .env.example .env.local   # Supabase 값 입력 (지금 단계 화면은 값 없이도 뜬다)
npm run dev                  # http://localhost:5173
```

휴대폰 폭 확인: 브라우저 개발자 도구 → 기기 모드 → 폭 360px.

| 명령 | 내용 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 타입 검사 + 배포용 빌드 (`dist/`) |
| `npm test` | 화면 테스트 |
| `npm run test:db` | 스키마·권한 규칙 테스트 (Docker 필요. Postgres 컨테이너를 띄워 마이그레이션 적용 후 검사하고 지움) |

### 환경변수

| 이름 | 값 | 비고 |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase 프로젝트 URL | 프로젝트 설정 → API |
| `VITE_SUPABASE_ANON_KEY` | anon public key | 브라우저에 노출돼도 되는 키. 실제 권한은 RLS가 막는다. **service_role 키는 절대 넣지 않는다** |

## Supabase 준비 (최초 1회)

1. https://supabase.com 에서 무료 프로젝트 생성 (지역: Northeast Asia (Seoul))
2. SQL Editor에서 `supabase/migrations/` 의 SQL 파일을 이름 순서대로 실행
   - Supabase CLI를 쓰면 `supabase link` 후 `supabase db push`
3. 프로젝트 설정 → API에서 URL, anon key를 복사해 `.env.local`과 호스팅 환경변수에 넣기
4. (로그인 이슈에서) Authentication → Providers → Google 설정

## 배포 (Cloudflare Pages)

1. Cloudflare 대시보드 → Workers & Pages → Create → Pages → GitHub 연결 → `meminlab/banban`
2. 빌드 설정: Framework `Vite` / Build command `npm run build` / Output `dist`
3. 환경변수: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `NODE_VERSION=22`
4. 이후 `main`에 머지하면 자동 배포. 주소를 직접 입력하거나 새로고침해도 SPA로 처리된다(404.html이 없으면 Pages가 index.html을 돌려줌)

## 데이터 모델

전체 스키마: `supabase/migrations/20261105000000_init.sql` (명세 BANB-2 "확정 명세"의 용어를 코드 이름으로 그대로 사용)

| 테이블 | 내용 | 주요 규칙 |
|---|---|---|
| `ledger` | 가계부 | `member_limit` 기본 2 (클라이언트에서 변경 불가) |
| `member` | 멤버 | role `owner`/`member`, 사용자당 참여 중인 가계부 1개, 나가기는 `left_at` 기록(행 유지 → 그 사람 내역 보존) |
| `invite` | 초대 | 8자리 코드, 7일 만료, 새로 발급하면 이전 것 `is_revoked` |
| `category` | 카테고리 | type `expense`/`income`/`saving`, 대분류(`parent_id` null) > 소분류 2단계, 숨김 |
| `pocket` | 주머니 | scope `shared`/`personal`, 숨김 |
| `transaction` | 내역 | 금액 정수 ≥1, `occurred_on` 날짜, 소분류만, 지출이면 주머니 필수, `is_fixed`는 지출만, 메모 100자, `source` 기본 `manual`, 작성자·마지막 수정자 자동 기록 |
| `asset` | 자산 | kind `checking`/`installment_saving`/`deposit`/`investment`/`cash`/`other`, `owner_id` null = 공동, 잔액 정수 ≥0 |

권한 규칙
- 모든 테이블 RLS 사용. **해당 가계부의 현재 멤버만** 읽기·쓰기 가능, 비로그인은 전부 차단
- 가계부 만들기·참여는 RPC로만: `create_ledger(name, display_name)`, `join_ledger(code, display_name)`
  - 오류 코드: `ALREADY_IN_LEDGER`, `INVITE_NOT_FOUND`, `INVITE_EXPIRED`, `MEMBER_LIMIT_REACHED`, `NOT_AUTHENTICATED`
- 다른 가계부의 카테고리·주머니·멤버는 참조 불가 (복합 외래키)
- 사용 중인 카테고리·주머니는 삭제 불가 → 숨김 처리
- 가계부 생성 시 기본 카테고리(대분류 27 / 소분류 43)와 기본 주머니 4개 자동 생성
