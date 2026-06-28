# Vercel 배포 가이드 (Homo Ruens)

GitHub(`banddal/ruens_hompage`)에 push하면 Vercel이 자동 빌드·배포합니다.
단, **최초 1회**는 아래 설정이 필요합니다.

---

## 0. 사전 준비 (한 번만)

### 0-1. Supabase 스키마 실행
Supabase Dashboard → SQL Editor → `supabase-schema.sql` 전체 붙여넣고 실행.
생성물: `projects` / `project_images` / `project_files` 테이블,
`portfolio-assets` Storage 버킷, 공개 read 정책(RLS).

### 0-2. Vercel ↔ GitHub 연결
Vercel 대시보드 → Add New Project → `ruens_hompage` 레포 Import.
프레임워크 프리셋: **Other** (정적 + api 함수 구조라 별도 빌드 명령 불필요).

### 0-3. Vercel 환경변수 등록 (가장 중요)
Project → Settings → Environment Variables 에 아래 5개 등록.
Production / Preview 둘 다 체크.

| 키 | 값 |
| --- | --- |
| `SUPABASE_URL` | https://lzwkhsbfpachkaudszjo.supabase.co |
| `SUPABASE_SERVICE_ROLE_KEY` | (Supabase → Settings → API → service_role 키) |
| `SUPABASE_STORAGE_BUCKET` | portfolio-assets |
| `ADMIN_PASSWORD` | (관리자 비밀번호, 최소 10자) |
| `ADMIN_SECRET` | (긴 랜덤 문자열) |

> 🔴 `SUPABASE_SERVICE_ROLE_KEY`는 절대 코드/깃에 넣지 마세요. Vercel 환경변수에만.
> 환경변수는 push로 안 들어갑니다. 여기서 직접 등록해야 합니다.

---

## 1. 배포 (이후 반복)

```text
git add .
git commit -m "메시지"
git push origin main
```

→ Vercel이 자동 감지 → 빌드 → 배포 → https://ruens-hompage.vercel.app/ 반영.

> 환경변수를 새로 추가/변경한 경우엔 push 없이도 Vercel 대시보드에서
> **Redeploy** 를 한 번 눌러줘야 새 값이 적용됩니다.

---

## 2. 배포 확인 (체크리스트)

1. `https://ruens-hompage.vercel.app/api/health` 접속
   → `{ "ok": true, "storage": "supabase" }` 가 나오면 Supabase 연결 성공.
   ("storage": "local-json" 이면 환경변수가 안 들어간 것.)
2. 메인 페이지에서 프로젝트 목록이 보이는지.
3. `/admin.html` 접속 → ADMIN_PASSWORD로 로그인되는지.
4. 관리자에서 이미지 업로드 → Supabase Storage `portfolio-assets`에 파일이 쌓이는지.

---

## 3. 자주 나는 문제

- **프로젝트가 안 보임 / API 404** → `vercel.json`이 레포 루트에 있는지 확인.
- **/api/health 가 local-json** → 환경변수 미등록 또는 Redeploy 안 함.
- **업로드 실패** → service_role 키 오타, 또는 버킷 이름 불일치.
- **관리자 로그인 불가** → ADMIN_PASSWORD 미설정(403) 또는 10자 미만.

---

## 4. 레거시 파일 정리 (선택)

`server.js`, `SUPABASE_DEPLOY.md`(Render 기준)는 Vercel 운영에는 불필요.
로컬 개발용으로 남겨도 무방하나, 혼선을 줄이려면 삭제 가능.
삭제 전 PROJECT_STATE.md 작업 로그에 기록할 것.
