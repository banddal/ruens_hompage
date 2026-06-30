insert into storage.buckets (id, name, public)
values ('portfolio-assets', 'portfolio-assets', true)
on conflict (id) do update set public = true;

create table if not exists public.projects (
  id text primary key,
  slug text unique not null,
  portfolio_no text default '',
  category text not null default 'Plan',
  metric text default '',
  title text not null,
  period text default '',
  short text default '',
  description text default '',
  role text default '',
  outcome text default '',
  tags jsonb not null default '[]'::jsonb,
  skill_tags jsonb not null default '[]'::jsonb,
  team_positions jsonb not null default '[]'::jsonb,
  gallery jsonb not null default '[]'::jsonb,
  status text not null default 'draft',
  dashboard_featured boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects add column if not exists slug text;
alter table public.projects add column if not exists portfolio_no text default '';
alter table public.projects add column if not exists category text not null default 'Plan';
alter table public.projects add column if not exists metric text default '';
alter table public.projects add column if not exists title text;
alter table public.projects add column if not exists period text default '';
alter table public.projects add column if not exists short text default '';
alter table public.projects add column if not exists description text default '';
alter table public.projects add column if not exists role text default '';
alter table public.projects add column if not exists outcome text default '';
alter table public.projects add column if not exists tags jsonb not null default '[]'::jsonb;
alter table public.projects add column if not exists skill_tags jsonb not null default '[]'::jsonb;
alter table public.projects add column if not exists team_positions jsonb not null default '[]'::jsonb;
alter table public.projects add column if not exists dashboard_featured boolean not null default false;
alter table public.projects add column if not exists gallery jsonb not null default '[]'::jsonb;
alter table public.projects add column if not exists status text not null default 'draft';
alter table public.projects add column if not exists sort_order integer not null default 0;
alter table public.projects add column if not exists created_at timestamptz not null default now();
alter table public.projects add column if not exists updated_at timestamptz not null default now();

update public.projects set slug = id where slug is null or slug = '';
update public.projects set title = id where title is null or title = '';
update public.projects
set portfolio_no = 'p' || lpad(numbered.row_number::text, 4, '0')
from (
  select id, row_number() over (order by sort_order asc, created_at asc, id asc) as row_number
  from public.projects
) numbered
where public.projects.id = numbered.id
  and (public.projects.portfolio_no is null or public.projects.portfolio_no = '');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_slug_key'
    and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects add constraint projects_slug_key unique (slug);
  end if;
end $$;

create table if not exists public.project_images (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  title text default '',
  description text default '',
  caption text default '',
  alt text default '',
  original_filename text default '',
  path text not null,
  public_url text default '',
  storage_path text default '',
  file_type text default 'image',
  mime_type text default '',
  file_size bigint default 0,
  visibility text not null default 'public',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.project_images add column if not exists project_id text;
alter table public.project_images add column if not exists title text default '';
alter table public.project_images add column if not exists description text default '';
alter table public.project_images add column if not exists caption text default '';
alter table public.project_images add column if not exists alt text default '';
alter table public.project_images add column if not exists original_filename text default '';
alter table public.project_images add column if not exists path text;
alter table public.project_images add column if not exists public_url text default '';
alter table public.project_images add column if not exists storage_path text default '';
alter table public.project_images add column if not exists file_type text default 'image';
alter table public.project_images add column if not exists mime_type text default '';
alter table public.project_images add column if not exists file_size bigint default 0;
alter table public.project_images add column if not exists visibility text not null default 'public';
alter table public.project_images add column if not exists sort_order integer not null default 0;
alter table public.project_images add column if not exists created_at timestamptz not null default now();

create table if not exists public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  title text default '',
  description text default '',
  caption text default '',
  alt text default '',
  original_filename text default '',
  path text not null,
  public_url text default '',
  storage_path text default '',
  file_type text default 'file',
  mime_type text default '',
  file_size bigint default 0,
  visibility text not null default 'request',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.project_files add column if not exists project_id text;
alter table public.project_files add column if not exists title text default '';
alter table public.project_files add column if not exists description text default '';
alter table public.project_files add column if not exists caption text default '';
alter table public.project_files add column if not exists alt text default '';
alter table public.project_files add column if not exists original_filename text default '';
alter table public.project_files add column if not exists path text;
alter table public.project_files add column if not exists public_url text default '';
alter table public.project_files add column if not exists storage_path text default '';
alter table public.project_files add column if not exists file_type text default 'file';
alter table public.project_files add column if not exists mime_type text default '';
alter table public.project_files add column if not exists file_size bigint default 0;
alter table public.project_files add column if not exists visibility text not null default 'request';
alter table public.project_files add column if not exists sort_order integer not null default 0;
alter table public.project_files add column if not exists created_at timestamptz not null default now();

create index if not exists projects_status_sort_idx on public.projects(status, sort_order);
create index if not exists project_images_project_idx on public.project_images(project_id, sort_order);
create index if not exists project_files_project_idx on public.project_files(project_id, sort_order);

alter table public.projects enable row level security;
alter table public.project_images enable row level security;
alter table public.project_files enable row level security;

drop policy if exists "public read published projects" on public.projects;
drop policy if exists "public read project images" on public.project_images;
drop policy if exists "public read public project files" on public.project_files;

create policy "public read published projects"
on public.projects for select
using (status <> 'private');

create policy "public read project images"
on public.project_images for select
using (
  exists (
    select 1 from public.projects
    where projects.id = project_images.project_id
    and projects.status <> 'private'
  )
);

create policy "public read public project files"
on public.project_files for select
using (
  visibility <> 'private'
  and exists (
    select 1 from public.projects
    where projects.id = project_files.project_id
    and projects.status <> 'private'
  )
);

-- =========================================================
-- project_memos: 방문자 메모(비공개 의견함, 관리자 전용 열람)
-- =========================================================
create table if not exists public.project_memos (
  id uuid primary key default gen_random_uuid(),
  writer text not null default '익명',
  title text not null,
  body text not null,
  source_ip text default '',
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists project_memos_created_idx
  on public.project_memos (created_at desc);

alter table public.project_memos enable row level security;

-- 보안 핵심:
--  - 방문자(anon)는 INSERT(작성)만 가능. SELECT/UPDATE/DELETE 불가.
--  - 따라서 방문자는 자기 메모조차 다시 못 읽고, 목록도 못 봄(게시판 아님).
--  - 관리자 백엔드는 service_role 키로 접근하므로 RLS를 우회해 전체 열람/관리 가능.
drop policy if exists "anon insert memo" on public.project_memos;
create policy "anon insert memo"
on public.project_memos for insert
to anon, authenticated
with check (true);
-- SELECT/UPDATE/DELETE 정책은 일부러 만들지 않음 → service_role만 가능.

-- =========================================================
-- essays: 에세이 (5개 카테고리, 링크 메타데이터 + 본문 전문)
-- =========================================================
create table if not exists public.essays (
  id text primary key,
  category text not null default 'news',   -- news / publicBusiness / worldOutside / others / thinkingEmotion
  label text default '',                   -- 카드에 표시되는 카테고리 라벨(예: "公과 Business")
  title text not null,
  summary text default '',                 -- 카드 요약
  body text default '',                    -- 본문 전문(비어있으면 링크 카드로 동작)
  source_url text default '',              -- 원본 링크(브런치/네이버)
  cover_image text default '',             -- og:image 대표 이미지
  tags jsonb not null default '[]'::jsonb,
  published_at text default '',            -- 원본 작성일(메타데이터)
  status text not null default 'published',-- published / draft / private
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists essays_category_idx on public.essays (category, sort_order);
create index if not exists essays_created_idx on public.essays (created_at desc);

alter table public.essays enable row level security;

-- 공개 글은 누구나 읽기 가능(SELECT), 쓰기는 service_role(관리자)만.
drop policy if exists "public read essays" on public.essays;
create policy "public read essays"
on public.essays for select
to anon, authenticated
using (status = 'published');
-- INSERT/UPDATE/DELETE 정책 없음 → service_role(관리자 백엔드)만 가능.

-- =========================================================
-- essay_comments: 에세이 댓글(답글 중첩 = parent_id) + 비밀번호 + IP
-- =========================================================
create table if not exists public.essay_comments (
  id uuid primary key default gen_random_uuid(),
  essay_id text not null,
  parent_id uuid references public.essay_comments(id) on delete cascade,
  writer text not null default '익명',
  body text not null,
  password_hash text default '',     -- 작성자 자가삭제용(평문 저장 안 함)
  source_ip text default '',
  is_blocked boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists essay_comments_essay_idx on public.essay_comments (essay_id, created_at);
create index if not exists essay_comments_parent_idx on public.essay_comments (parent_id);

alter table public.essay_comments enable row level security;

-- 차단되지 않은 댓글은 누구나 읽기 가능. 쓰기/수정/삭제는 service_role(백엔드)만.
drop policy if exists "public read comments" on public.essay_comments;
create policy "public read comments"
on public.essay_comments for select
to anon, authenticated
using (is_blocked = false);

-- =========================================================
-- blocked_ips: 관리자가 차단한 IP 목록
-- =========================================================
create table if not exists public.blocked_ips (
  ip text primary key,
  reason text default '',
  created_at timestamptz not null default now()
);

alter table public.blocked_ips enable row level security;
-- 정책 없음 → service_role(백엔드)만 접근 가능.

-- =========================================================
-- site_settings: 상단 공지 등 사이트 전역 설정
-- =========================================================
create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.site_settings enable row level security;
-- 정책 없음 → service_role(백엔드)만 접근 가능. 공개 노출은 /api/site-settings가 담당.

-- =========================================================
-- analytics_events: 방문/콘텐츠 조회 이벤트(관리자 분석용)
-- =========================================================
create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,          -- page_view / content_view
  content_type text default '',      -- project / essay / page
  content_id text default '',
  title text default '',
  path text default '',
  referrer text default '',
  visitor_hash text default '',      -- IP 원문 대신 일 단위 해시 저장
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_created_idx
  on public.analytics_events (created_at desc);

create index if not exists analytics_events_content_idx
  on public.analytics_events (content_type, content_id, created_at desc);

create index if not exists analytics_events_type_idx
  on public.analytics_events (event_type, created_at desc);

alter table public.analytics_events enable row level security;
-- 정책 없음 → service_role(백엔드)만 접근 가능. 방문자는 /api/analytics/track API만 사용.
