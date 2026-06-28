insert into storage.buckets (id, name, public)
values ('portfolio-assets', 'portfolio-assets', true)
on conflict (id) do update set public = true;

create table if not exists public.projects (
  id text primary key,
  slug text unique not null,
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
