# PROJECT_STATE.md — Homo Ruens

> Claude와 Codex가 함께 보는 작업 상태 문서입니다.  
> 새 라운드를 시작하기 전 이 파일을 먼저 읽고, 라운드가 끝나면 이 파일을 갱신하세요.

마지막 갱신: 2026-06-30 / 작성: Codex

---

## 1. 현재 기준

- 작업 폴더: `C:\Users\HP\Desktop\새 폴더`
- 배포 방향: Render 제거, Vercel 중심
- 운영 도메인 목표: `https://kimsung-won.com`
- 데이터/파일 저장: Supabase DB + Supabase Storage
- 주요 파일:
  - `index.html`, `styles.css`, `app.js`
  - `admin.html`, `admin.css`, `admin.js`
  - `api/index.js`
  - `supabase-schema.sql`
  - `data.js`, `content-data/projects.json`

---

## 2. 이번 라운드 변경 요약

### H. Essay 에디터 개선

관리자 `Essays` 에디터를 실사용 가능한 글쓰기 도구에 가깝게 개선.

변경 내용:

- 툴바 정리 및 확장
  - `P`, `H2`, `H3`
  - `B`, `I`, `U`
  - `Quote`
  - `UL`, `OL`
  - `Link`
  - `Image`
  - `Line`
  - `Clear`
- 기존 이모지/기호 중심 버튼을 일반 텍스트 버튼으로 정리.
- 에디터 글꼴을 관리자 굵은 폰트 느낌에서 일반 웹 기본 산세리프 계열로 조정.
- 에디터 기본 글자 굵기를 낮추고, 제목/강조도 과하게 보이지 않도록 조정.
- 붙여넣기 이미지 처리 개선.
  - 네이버/브런치에서 HTML로 복사된 `<img>`는 정리 후 보존.
  - 클립보드에 이미지 파일이 들어오는 경우 Data URL로 본문에 직접 삽입.
  - `Image` 버튼으로 로컬 이미지 파일을 선택해 본문에 삽입 가능.
- `<figure>`, `<figcaption>` 구조 허용.
- 링크 붙여넣기/삽입 시 `http/https`만 허용하고 `target="_blank"`, `rel="noopener"` 부여.
- 에세이 미리보기 모달 추가.
  - 현재 입력 중인 제목/카테고리/날짜/태그/본문을 사이트 모달에 가까운 형태로 확인 가능.
- 에세이 저장 API 요청 크기 제한을 `1MB`에서 `10MB`로 확대.
  - 이유: 본문에 이미지가 Data URL로 들어갈 경우 저장 요청이 커질 수 있음.

수정 파일:

- `admin.html`
- `admin.js`
- `admin.css`
- `api/index.js`

검증:

```powershell
node --check "C:\Users\HP\Desktop\새 폴더\admin.js"
node --check "C:\Users\HP\Desktop\새 폴더\api\index.js"
```

주의:

- 현재 에세이 이미지는 별도 Storage 업로드가 아니라 본문 HTML 안에 Data URL로 들어갈 수 있음.
- 큰 이미지를 많이 붙이면 Supabase row 또는 Vercel 요청 제한에 걸릴 수 있음.
- 장기적으로는 `essay_images` 테이블 + Storage 업로드 방식의 별도 이미지 관리 모달을 만드는 것이 더 안정적.

### A. Google Analytics 태그 추가

`index.html`의 `<head>`에 Google tag 삽입.

- 측정 ID: `G-0YRE7D04ZF`
- 관리자 페이지 `admin.html`에는 삽입하지 않음.

### B. 푸터 이메일 수정

푸터 영문 문구의 분쟁 접수 이메일 수정.

- 기존: `help@email.com`
- 변경: `band17dal@gmail.com`

### C. 관리자 Dashboard 추가

관리자 로그인 후 첫 화면을 `Dashboard`로 변경.

대시보드에 표시되는 항목:

- 전체 Project 수
- 전체 Essay 수
- 전체 Memo 수
- 전체 Comment 수
- 방문자수
- 조회 포스트 수
- 최신 Memo
- 최신 Comment
- 조회 포스트 목록

연결:

- `보기` 버튼 → `Memos`, `Comments`
- `분석 보기` 버튼 → `Analytics`

수정 파일:

- `admin.html`
- `admin.js`
- `admin.css`

### D. Projects / Essays 관리자 목록 구조 변경

기존 좌측 고정 목록을 상단 게시판형 목록으로 변경.

현재 구조:

- 상단: 게시판 프레임
- 게시판 내부: 자체 스크롤
- 하단: 에디터

목록 컬럼:

- 게시일자
- 제목
- 태그
- 작성 시간
- 상태

정렬 기능:

- Projects:
  - 기본 순서
  - 게시일자 최신순
  - 게시일자 오래된순
  - 제목 가나다순
  - 태그 가나다순
  - 작성 시간 최신순
- Essays:
  - 게시일자 최신순
  - 게시일자 오래된순
  - 제목 가나다순
  - 태그 가나다순
  - 작성 시간 최신순

### E. 저장하기 / 수정하기 분리

관리자에서 의도치 않은 복제를 줄이기 위해 버튼 의미를 분리.

- `저장하기`: 새 프로젝트/새 에세이 생성용
- `수정하기`: 기존 항목 수정용

현재 동작:

- 기존 ID가 있는 항목을 `저장하기`로 저장하려 하면 차단
- 기존 항목을 수정하려면 `수정하기` 사용

### F. Portfolio 관리번호 추가

프로젝트별 포트폴리오 관리번호 필드 추가.

- 형식: `p0001`, `p0002`, ...
- 관리자 게시판에 `No.` 열로 표시
- 프로젝트 에디터에 `포트폴리오 번호` 입력칸 추가
- API 매핑 추가
- DB 컬럼 추가

수정 위치:

- `supabase-schema.sql`
  - `projects.portfolio_no text default ''`
  - 기존 row에 `p0001` 형식 자동 부여 쿼리 추가
- `api/index.js`
  - `portfolioNo` ↔ `portfolio_no` 매핑
- `admin.html`
  - 포트폴리오 번호 입력 필드
- `admin.js`
  - 목록 표시, 폼 read/write

주의:

- Supabase SQL Editor에서 `supabase-schema.sql` 변경분을 실행해야 `portfolio_no` 저장 가능.

### G. 이미지 업로드/관리 모달 분리

프로젝트 에디터 안에 있던 이미지 업로드 UI를 분리.

현재 구조:

- 에디터 안에는 `Images` 요약 + `이미지 관리` 버튼만 표시
- 버튼 클릭 시 이미지 관리 모달 오픈
- 모달 안에서 이미지 업로드/썸네일 확인/삭제/순서 변경

모달 기능:

- 다중 이미지 업로드
- 썸네일 표시
- 다중 선택 삭제
- 드래그로 순서 변경
- `이미지 관리 확정` 버튼

첨부파일 업로드:

- 기존 기능 유지
- 이미지 영역이 빠진 만큼 에디터 영역을 더 넓게 사용

수정 파일:

- `admin.html`
- `admin.js`
- `admin.css`

---

## 3. 검증 완료

아래 문법 검사를 통과함.

```powershell
node --check "C:\Users\HP\Desktop\새 폴더\admin.js"
node --check "C:\Users\HP\Desktop\새 폴더\api\index.js"
```

---

## 4. 다음 작업자가 바로 확인할 것

1. Supabase SQL Editor에서 `supabase-schema.sql`의 `portfolio_no` 추가 쿼리 실행 필요.
2. 관리자 `Projects`에서 기존 프로젝트 선택 후:
   - `p0001` 형식 번호가 뜨는지 확인
   - `수정하기`로 저장되는지 확인
   - `저장하기`로 기존 항목 저장 시 차단되는지 확인
3. 이미지 관리 모달에서:
   - 이미지 업로드
   - 썸네일 표시
   - 드래그 순서변경
   - 선택 삭제
   - 확정 버튼
   확인 필요.
4. `portfolio_no`는 아직 프론트의 Portfolio/News 노출 순서 제어에 직접 연결하지 않았음. 다음 라운드에서 연결 가능.
5. 에세이도 현재 `저장하기/수정하기`는 프론트에서만 의미 분리됨. 서버 API는 기존 `POST /api/admin/essays` upsert 구조 유지.

---

## 5. 현재 남은 큰 설계 메모

- 방문자 분석은 자체 `analytics_events` 테이블 + Google Analytics 병행 구조.
- 관리자 Dashboard는 자체 API들을 모아 보여주는 프론트 집계 방식.
- Portfolio 노출 순서 제어는 앞으로 `portfolioNo`, `sortOrder`, `dashboardFeatured` 중 무엇을 최종 기준으로 삼을지 결정 필요.
- 이미지 업로드는 업로드 즉시 저장됨. `이미지 관리 확정`은 UX상 확인 버튼이며 DB commit 버튼은 아님.
- 프로젝트 본문 저장/수정과 이미지 업로드 저장은 아직 별도 흐름임.

---

## 6. 최근 수정 파일 목록

- `index.html`
- `admin.html`
- `admin.js`
- `admin.css`
- `api/index.js`
- `supabase-schema.sql`
- `PROJECT_STATE.md`
