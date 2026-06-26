# Supabase 연결 배포 절차

## 1. Supabase SQL 실행

Supabase Dashboard의 SQL Editor에서 `supabase-schema.sql` 내용을 실행합니다.

생성되는 항목:

- `portfolio-assets` Storage bucket
- `projects` table
- `project_images` table
- `project_files` table
- 기본 read policy

## 2. Render 환경변수 설정

Render Web Service의 Environment에 아래 값을 추가합니다.

```text
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET=portfolio-assets
ADMIN_PASSWORD=관리자비밀번호
ADMIN_SECRET=긴랜덤문자열
```

`SUPABASE_SERVICE_ROLE_KEY`는 브라우저 코드에 넣으면 안 됩니다.
반드시 Render 환경변수와 `server.js`에서만 사용합니다.

## 3. Render 재배포

```text
Manual Deploy
→ Clear build cache & deploy
```

## 4. 연결 확인

아래 주소를 확인합니다.

```text
/api/health
```

정상 연결 시:

```json
{
  "ok": true,
  "service": "homo-ruens-portfolio",
  "storage": "supabase"
}
```

## 5. 프로젝트 자동 초기화

Supabase `projects` 테이블이 비어 있으면 서버가 처음 조회할 때:

1. `backend-data/projects.json`이 있으면 그 파일을 사용
2. 없으면 `content-data/projects.json` 사용
3. Supabase `projects` 테이블에 자동 저장

## 6. 업로드 동작

관리자 화면에서 이미지나 첨부파일을 올리면:

1. 파일은 Supabase Storage `portfolio-assets` bucket에 저장
2. 메타데이터는 `project_images` 또는 `project_files` table에 저장
3. 프로젝트 API에서 `images`, `files` 배열로 반환

