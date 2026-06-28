// Homo Ruens API — Vercel serverless handler.
// 기존 server.js 로직을 의존성 0으로 이전. 저장소는 Supabase 전용.
// 로컬 파일시스템 쓰기는 Vercel에서 불가하므로 제거됨(content-data 시드만 읽기 전용 사용).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Vercel 함수 기준 프로젝트 루트(레포 최상단). __dirname 은 /var/task/api 이므로 한 단계 위.
const ROOT = path.join(__dirname, "..");
const CONTENT_PROJECTS_DB = path.join(ROOT, "content-data", "projects.json");
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 50 * 1024 * 1024);
// 레거시 로컬 저장 경로 — 서버리스에서는 사용하지 않음(읽기 전용 FS).
// 비활성 분기에서 참조될 때 ReferenceError가 나지 않도록 null 센티넬로 둠.
const PROJECTS_DB = null;
const MEDIA_DB = null;
const SECURITY_DB = null;
const UPLOAD_ROOT = null;
const SESSION_COOKIE = "homo_ruens_admin";
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "portfolio-assets";

const ALLOWED_UPLOAD_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".avif",
  ".pdf", ".ppt", ".pptx", ".hwp", ".hwpx", ".doc", ".docx", ".xls", ".xlsx"
]);

function ensureDir() {
  // no-op: 읽기 전용 환경. (구 로컬 저장 경로 호환용 스텁)
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson() {
  // Vercel 서버리스는 읽기 전용 파일시스템입니다.
  // 모든 쓰기는 Supabase로 가야 하므로 로컬 쓰기 경로는 의도적으로 막습니다.
  throw new Error("Local filesystem writes are disabled. Configure Supabase (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).");
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    ...corsHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function sessionSecret() {
  return process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD || "local-development-session-secret";
}

function signSession() {
  const payload = base64url(JSON.stringify({
    iat: Date.now(),
    exp: Date.now() + SESSION_TTL_SECONDS * 1000
  }));
  const signature = crypto
    .createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function verifySession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token || !token.includes(".")) return false;
  const [payload, signature] = token.split(".");
  const expected = crypto
    .createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
  if (signature.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(data.exp || 0) > Date.now();
  } catch {
    return false;
  }
}

function secureCookieFlag(req) {
  const host = req.headers.host || "";
  return req.headers["x-forwarded-proto"] === "https" || (!host.startsWith("localhost") && !host.startsWith("127.0.0.1"));
}

function setSessionCookie(req, res) {
  const flags = [
    `${SESSION_COOKIE}=${encodeURIComponent(signSession())}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`
  ];
  if (secureCookieFlag(req)) flags.push("Secure");
  res.setHeader("Set-Cookie", flags.join("; "));
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function passwordRecord() {
  // 서버리스 환경에서는 관리자 비밀번호를 환경변수로만 관리합니다.
  // (구 admin 페이지의 로컬 SECURITY_DB 저장 방식은 읽기 전용 FS에서 동작하지 않음)
  if (process.env.ADMIN_PASSWORD) return { source: "env", plain: process.env.ADMIN_PASSWORD };
  return null;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const iterations = 120000;
  return {
    algorithm: "pbkdf2-sha256",
    iterations,
    salt,
    hash: crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex"),
    updatedAt: new Date().toISOString()
  };
}

function sameString(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyPassword(password) {
  const current = passwordRecord();
  if (!current) return false;
  if (current.plain) return sameString(password, current.plain);

  const record = current.record;
  const hash = crypto
    .pbkdf2Sync(password, record.salt, Number(record.iterations || 120000), 32, "sha256")
    .toString("hex");
  return sameString(hash, record.hash);
}

function requireAdmin(req, res) {
  if (!passwordRecord()) {
    sendError(res, 403, "Admin password is not configured.");
    return false;
  }
  if (!verifySession(req)) {
    sendError(res, 401, "Admin login is required.");
    return false;
  }
  return true;
}

function securityStatus(req) {
  const current = passwordRecord();
  const authenticated = Boolean(current && verifySession(req));
  return {
    authConfigured: Boolean(current),
    authenticated,
    passwordSource: current?.source || "not-configured",
    sessionHours: SESSION_TTL_SECONDS / 3600,
    adminApiProtected: true,
    uploads: {
      maxBytes: MAX_UPLOAD_BYTES,
      maxMB: Math.round(MAX_UPLOAD_BYTES / 1024 / 1024),
      allowedExtensions: Array.from(ALLOWED_UPLOAD_EXTS).sort()
    },
    storage: {
      mode: supabaseEnabled() ? "supabase" : "local",
      bucket: supabaseEnabled() ? SUPABASE_STORAGE_BUCKET : "",
      note: supabaseEnabled()
        ? "Supabase Database와 Storage를 우선 저장소로 사용 중입니다."
        : "Supabase 미설정(로컬 개발). 운영에서는 환경변수로 Supabase를 연결하세요."
    }
  };
}

function safeSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9가-힣._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function safeStorageSegment(value, fallback = "asset") {
  const segment = String(value || "")
    .trim()
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return segment || fallback;
}

function publicProject(project) {
  return {
    id: project.id,
    slug: project.slug || project.id,
    category: project.category,
    metric: project.metric,
    title: project.title,
    period: project.period,
    short: project.short,
    description: project.description,
    role: project.role,
    outcome: project.outcome,
    tags: project.tags || [],
    skillTags: project.skillTags || [],
    teamPositions: project.teamPositions || [],
    gallery: project.gallery || [],
    images: project.images || [],
    files: (project.files || []).filter(file => file.visibility !== "private"),
    status: project.status || "published",
    dashboardFeatured: Boolean(project.dashboardFeatured),
    sortOrder: project.sortOrder || 0,
    updatedAt: project.updatedAt
  };
}

function adminProject(project) {
  return {
    ...project,
    slug: project.slug || project.id,
    tags: project.tags || [],
    skillTags: project.skillTags || [],
    teamPositions: project.teamPositions || [],
    gallery: project.gallery || [],
    images: project.images || [],
    files: project.files || [],
    status: project.status || "published",
    sortOrder: project.sortOrder || 0
  };
}

function findProject(projects, key) {
  return projects.find(project => project.id === key || project.slug === key);
}

function normalizeProject(project, index = 0) {
  const id = safeSegment(project.id || project.slug || project.title || `project-${index + 1}`);
  return {
    id,
    slug: safeSegment(project.slug || id),
    category: project.category || "Plan",
    metric: project.metric || "",
    title: project.title || id,
    period: project.period || "",
    short: project.short || "",
    description: project.description || "",
    role: project.role || "",
    outcome: project.outcome || "",
    tags: project.tags || [],
    skillTags: project.skillTags || [],
    teamPositions: project.teamPositions || [],
    gallery: project.gallery || [],
    images: project.images || [],
    files: project.files || [],
    status: project.status || "published",
    dashboardFeatured: Boolean(project.dashboardFeatured),
    sortOrder: project.sortOrder || index + 1,
    createdAt: project.createdAt || project.updatedAt || new Date().toISOString(),
    updatedAt: project.updatedAt || new Date().toISOString()
  };
}

function initializeBackendData() {
  // Vercel 서버리스: 로컬 초기화 불필요.
  // Supabase projects 테이블이 비어 있으면 getProjectsStore()가
  // content-data/projects.json을 읽어 자동 시딩합니다.
}

function localSeedProjects() {
  const seedProjects = readJson(CONTENT_PROJECTS_DB, []);
  return Array.isArray(seedProjects)
    ? seedProjects.map(normalizeProject)
    : [];
}

function supabaseEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra
  };
}

async function supabaseRequest(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${pathname}`, {
    ...options,
    headers: supabaseHeaders(options.headers || {})
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text ? { message: text } : null;
  }
  if (!response.ok) {
    throw new Error(parsed?.message || parsed?.error || `Supabase request failed: ${response.status}`);
  }
  return parsed;
}

function dbProjectToProject(row, images = [], files = []) {
  return normalizeProject({
    id: row.id,
    slug: row.slug,
    category: row.category,
    metric: row.metric,
    title: row.title,
    period: row.period,
    short: row.short,
    description: row.description,
    role: row.role,
    outcome: row.outcome,
    tags: row.tags || [],
    skillTags: row.skill_tags || [],
    teamPositions: row.team_positions || [],
    gallery: row.gallery || [],
    images,
    files,
    status: row.status,
    dashboardFeatured: Boolean(row.dashboard_featured),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }, Number(row.sort_order || 0));
}

function projectToDbRow(project) {
  const normalized = normalizeProject(project);
  return {
    id: normalized.id,
    slug: normalized.slug,
    category: normalized.category,
    metric: normalized.metric,
    title: normalized.title,
    period: normalized.period,
    short: normalized.short,
    description: normalized.description,
    role: normalized.role,
    outcome: normalized.outcome,
    tags: normalized.tags,
    skill_tags: normalized.skillTags,
    team_positions: normalized.teamPositions,
    gallery: normalized.gallery,
    status: normalized.status,
    dashboard_featured: normalized.dashboardFeatured,
    sort_order: normalized.sortOrder,
    updated_at: new Date().toISOString()
  };
}

function dbAssetToAsset(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title || "",
    description: row.description || "",
    caption: row.caption || "",
    alt: row.alt || "",
    originalFilename: row.original_filename || "",
    path: row.path || row.public_url || "",
    publicUrl: row.public_url || row.path || "",
    storagePath: row.storage_path || "",
    fileType: row.file_type || "file",
    mimeType: row.mime_type || "",
    fileSize: Number(row.file_size || 0),
    visibility: row.visibility || "request",
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at
  };
}

function assetToDbRow(asset) {
  return {
    id: asset.id,
    project_id: asset.projectId,
    title: asset.title || "",
    description: asset.description || "",
    caption: asset.caption || "",
    alt: asset.alt || "",
    original_filename: asset.originalFilename || "",
    path: asset.path || asset.publicUrl || "",
    public_url: asset.publicUrl || asset.path || "",
    storage_path: asset.storagePath || "",
    file_type: asset.fileType || "file",
    mime_type: asset.mimeType || "",
    file_size: asset.fileSize || 0,
    visibility: asset.visibility || "request",
    sort_order: asset.sortOrder || 0
  };
}

function groupByProjectId(rows) {
  return rows.reduce((map, row) => {
    const projectId = row.project_id;
    if (!map.has(projectId)) map.set(projectId, []);
    map.get(projectId).push(dbAssetToAsset(row));
    return map;
  }, new Map());
}

async function supabaseListProjects() {
  const [projectRows, imageRows, fileRows] = await Promise.all([
    supabaseRequest("/rest/v1/projects?select=*&order=sort_order.asc"),
    supabaseRequest("/rest/v1/project_images?select=*&order=sort_order.asc,created_at.asc"),
    supabaseRequest("/rest/v1/project_files?select=*&order=sort_order.asc,created_at.asc")
  ]);
  const imagesByProject = groupByProjectId(imageRows || []);
  const filesByProject = groupByProjectId(fileRows || []);
  return (projectRows || []).map(row => dbProjectToProject(
    row,
    imagesByProject.get(row.id) || [],
    filesByProject.get(row.id) || []
  ));
}

async function seedSupabaseProjectsFromContent() {
  const seedProjects = localSeedProjects();
  if (!Array.isArray(seedProjects) || !seedProjects.length) return [];
  const rows = seedProjects.map(projectToDbRow);
  return supabaseRequest("/rest/v1/projects?on_conflict=id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(rows)
  });
}

async function getProjectsStore() {
  if (supabaseEnabled()) {
    try {
      const projects = await supabaseListProjects();
      if (projects.length) return projects;
      await seedSupabaseProjectsFromContent();
      return supabaseListProjects();
    } catch (error) {
      console.error("Supabase project store failed. Falling back to local seed data:", error);
      return localSeedProjects();
    }
  }
  // Supabase 미설정 시(로컬 개발 등): 읽기 전용 content 시드를 그대로 노출.
  return localSeedProjects();
}

async function getProjectStore(key) {
  const projects = await getProjectsStore();
  return findProject(projects, key);
}

async function saveProjectStore(payload, key = null) {
  const now = new Date().toISOString();
  const projectId = key || payload.id || safeSegment(payload.title);
  if (!projectId) throw new Error("Project id or title is required.");

  if (supabaseEnabled()) {
    const existing = await getProjectStore(projectId);
    const row = projectToDbRow({
      ...(existing || {}),
      ...payload,
      id: existing?.id || payload.id || projectId,
      slug: payload.slug || existing?.slug || payload.id || projectId,
      sortOrder: payload.sortOrder || existing?.sortOrder || 0,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    });
    const savedRows = await supabaseRequest("/rest/v1/projects?on_conflict=id", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(row)
    });
    const saved = savedRows?.[0] ? dbProjectToProject(savedRows[0], existing?.images || [], existing?.files || []) : await getProjectStore(projectId);
    return saved;
  }

  const projects = readJson(PROJECTS_DB, []);
  const existing = findProject(projects, projectId);
  if (existing) {
    Object.assign(existing, payload, {
      id: existing.id,
      slug: payload.slug || existing.slug || existing.id,
      updatedAt: now
    });
    writeJson(PROJECTS_DB, projects);
    return existing;
  }

  const created = normalizeProject({
    ...payload,
    id: safeSegment(payload.id || projectId),
    slug: safeSegment(payload.slug || payload.id || projectId),
    status: payload.status || "draft",
    sortOrder: payload.sortOrder || projects.length + 1,
    createdAt: now,
    updatedAt: now
  }, projects.length);
  projects.push(created);
  writeJson(PROJECTS_DB, projects);
  return created;
}

async function deleteProjectStore(key) {
  const project = await getProjectStore(key);
  if (!project) return false;

  if (supabaseEnabled()) {
    await supabaseRequest(`/rest/v1/projects?id=eq.${encodeURIComponent(project.id)}`, {
      method: "DELETE"
    });
    return true;
  }

  const projects = readJson(PROJECTS_DB, []);
  const nextProjects = projects.filter(item => item.id !== project.id && item.slug !== project.slug);
  writeJson(PROJECTS_DB, nextProjects);

  const media = readJson(MEDIA_DB, []);
  writeJson(MEDIA_DB, media.filter(item => item.projectId !== project.id));
  return true;
}

async function deleteAssetStore(projectKey, target, assetId) {
  const project = await getProjectStore(projectKey);
  if (!project) return false;

  if (supabaseEnabled()) {
    const table = target === "images" ? "project_images" : "project_files";
    await supabaseRequest(`/rest/v1/${table}?id=eq.${encodeURIComponent(assetId)}&project_id=eq.${encodeURIComponent(project.id)}`, {
      method: "DELETE"
    });
    return true;
  }

  const projects = readJson(PROJECTS_DB, []);
  const storedProject = findProject(projects, project.id);
  if (!storedProject) return false;
  const field = target === "images" ? "images" : "files";
  const before = storedProject[field] || [];
  storedProject[field] = before.filter(item => item.id !== assetId);
  storedProject.updatedAt = new Date().toISOString();
  writeJson(PROJECTS_DB, projects);

  const media = readJson(MEDIA_DB, []);
  writeJson(MEDIA_DB, media.filter(item => item.id !== assetId));
  return before.length !== storedProject[field].length;
}

async function updateAssetStore(projectKey, target, assetId, patch) {
  const project = await getProjectStore(projectKey);
  if (!project) return null;
  const allowedVisibility = new Set(["public", "request", "private"]);
  const nextVisibility = allowedVisibility.has(patch.visibility) ? patch.visibility : null;
  if (!nextVisibility) throw new Error("Invalid visibility.");

  if (supabaseEnabled()) {
    const table = target === "images" ? "project_images" : "project_files";
    const rows = await supabaseRequest(`/rest/v1/${table}?id=eq.${encodeURIComponent(assetId)}&project_id=eq.${encodeURIComponent(project.id)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({ visibility: nextVisibility })
    });
    return rows?.[0] ? dbAssetToAsset(rows[0]) : null;
  }

  const projects = readJson(PROJECTS_DB, []);
  const storedProject = findProject(projects, project.id);
  if (!storedProject) return null;
  const field = target === "images" ? "images" : "files";
  const asset = (storedProject[field] || []).find(item => item.id === assetId);
  if (!asset) return null;
  asset.visibility = nextVisibility;
  storedProject.updatedAt = new Date().toISOString();
  writeJson(PROJECTS_DB, projects);

  const media = readJson(MEDIA_DB, []);
  const mediaAsset = media.find(item => item.id === assetId);
  if (mediaAsset) {
    mediaAsset.visibility = nextVisibility;
    writeJson(MEDIA_DB, media);
  }
  return asset;
}

async function uploadToSupabaseStorage(storagePath, file) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_STORAGE_BUCKET}/${storagePath}`, {
    method: "POST",
    headers: supabaseHeaders({
      "Content-Type": file.contentType || "application/octet-stream",
      "Cache-Control": "3600",
      "x-upsert": "false"
    }),
    body: file.content
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Supabase storage upload failed: ${response.status}`);
  }
  return data;
}

function supabasePublicUrl(storagePath) {
  return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/${storagePath}`;
}

async function saveAssetStore(project, target, file, fields) {
  const originalName = path.basename(file.filename);
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_UPLOAD_EXTS.has(ext)) throw new Error(`Unsupported file type: ${ext}`);

  const slug = safeSegment(project.slug || project.id);
  const folder = target === "images" ? "images" : "files";
  const stem = safeStorageSegment(path.basename(originalName, ext));
  const storedName = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${stem}${ext}`;
  const fileType = fileKind(ext);
  const recordBase = {
    id: crypto.randomUUID(),
    projectId: project.id,
    title: fields.title || path.basename(originalName, ext),
    description: fields.description || "",
    caption: fields.caption || fields.description || "",
    alt: fields.alt || fields.title || originalName,
    originalFilename: originalName,
    fileType,
    mimeType: file.contentType,
    fileSize: file.content.length,
    visibility: fields.visibility || (target === "images" ? "public" : "request"),
    sortOrder: Number(fields.sortOrder || 0),
    createdAt: new Date().toISOString()
  };

  if (supabaseEnabled()) {
    const storagePath = `projects/${slug}/${folder}/${storedName}`;
    await uploadToSupabaseStorage(storagePath, file);
    const publicUrl = supabasePublicUrl(storagePath);
    const record = {
      ...recordBase,
      path: publicUrl,
      publicUrl,
      storagePath
    };
    const table = target === "images" ? "project_images" : "project_files";
    const savedRows = await supabaseRequest(`/rest/v1/${table}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(assetToDbRow(record))
    });
    return savedRows?.[0] ? dbAssetToAsset(savedRows[0]) : record;
  }

  const projects = readJson(PROJECTS_DB, []);
  const storedProject = findProject(projects, project.id);
  if (!storedProject) throw new Error("Project not found.");
  const uploadDir = path.join(UPLOAD_ROOT, slug, folder);
  ensureDir(uploadDir);
  const filePath = path.join(uploadDir, storedName);
  fs.writeFileSync(filePath, file.content);

  const publicPath = `/uploads/projects/${slug}/${folder}/${storedName}`;
  const record = {
    ...recordBase,
    path: publicPath,
    publicUrl: publicPath,
    storagePath: publicPath
  };

  if (target === "images") {
    storedProject.images = [...(storedProject.images || []), record];
  } else {
    storedProject.files = [...(storedProject.files || []), record];
  }
  storedProject.updatedAt = new Date().toISOString();
  writeJson(PROJECTS_DB, projects);

  const media = readJson(MEDIA_DB, []);
  media.push({ ...record, target });
  writeJson(MEDIA_DB, media);
  return record;
}

function collectRequestBody(req, maxBytes = MAX_UPLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipart(req, body) {
  const type = req.headers["content-type"] || "";
  const match = type.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new Error("Missing multipart boundary.");

  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const parts = [];
  let cursor = body.indexOf(boundary);
  while (cursor !== -1) {
    cursor += boundary.length;
    if (body[cursor] === 45 && body[cursor + 1] === 45) break;
    if (body[cursor] === 13 && body[cursor + 1] === 10) cursor += 2;

    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd === -1) break;

    const headerText = body.slice(cursor, headerEnd).toString("utf8");
    const nextBoundary = body.indexOf(boundary, headerEnd + 4);
    if (nextBoundary === -1) break;

    let content = body.slice(headerEnd + 4, nextBoundary);
    if (content.length >= 2 && content[content.length - 2] === 13 && content[content.length - 1] === 10) {
      content = content.slice(0, -2);
    }

    const name = headerText.match(/name="([^"]+)"/i)?.[1];
    const filename = headerText.match(/filename="([^"]*)"/i)?.[1];
    const contentType = headerText.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] || "application/octet-stream";
    if (name) parts.push({ name, filename, contentType, content });
    cursor = nextBoundary;
  }
  return parts;
}

function fileKind(ext) {
  if ([".png", ".jpg", ".jpeg", ".webp", ".avif"].includes(ext)) return "image";
  if (ext === ".pdf") return "pdf";
  if ([".ppt", ".pptx"].includes(ext)) return "presentation";
  if ([".hwp", ".hwpx"].includes(ext)) return "hwp";
  if ([".doc", ".docx"].includes(ext)) return "document";
  if ([".xls", ".xlsx"].includes(ext)) return "spreadsheet";
  return "file";
}

async function handleUpload(req, res, projectKey, target) {
  const project = await getProjectStore(projectKey);
  if (!project) return sendError(res, 404, "Project not found.");

  let body;
  try {
    body = await collectRequestBody(req);
  } catch (error) {
    return sendError(res, 413, error.message);
  }

  let parts;
  try {
    parts = parseMultipart(req, body);
  } catch (error) {
    return sendError(res, 400, error.message);
  }

  const file = parts.find(part => part.filename);
  if (!file || !file.content.length) return sendError(res, 400, "File field is required.");

  const fields = Object.fromEntries(
    parts
      .filter(part => !part.filename)
      .map(part => [part.name, part.content.toString("utf8").trim()])
  );

  try {
    const record = await saveAssetStore(project, target, file, fields);
    return sendJson(res, 201, record);
  } catch (error) {
    console.error("Upload failed:", {
      project: projectKey,
      target,
      filename: file.filename,
      message: error.message
    });
    return sendError(res, 400, error.message);
  }
}

async function handleProjectSave(req, res, key = null) {
  let payload;
  try {
    const body = await collectRequestBody(req, 2 * 1024 * 1024);
    payload = JSON.parse(body.toString("utf8") || "{}");
  } catch {
    return sendError(res, 400, "Invalid JSON body.");
  }

  try {
    const saved = await saveProjectStore(payload, key);
    sendJson(res, key ? 200 : 201, publicProject(saved));
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handleLogin(req, res) {
  let payload;
  try {
    const body = await collectRequestBody(req, 64 * 1024);
    payload = JSON.parse(body.toString("utf8") || "{}");
  } catch {
    return sendError(res, 400, "Invalid JSON body.");
  }

  if (!passwordRecord()) return sendError(res, 403, "Admin password is not configured.");
  if (!verifyPassword(payload.password || "")) return sendError(res, 401, "Invalid admin password.");
  setSessionCookie(req, res);
  sendJson(res, 200, { ...securityStatus(req), authenticated: true });
}

async function handlePasswordSave(req, res) {
  // 서버리스(Vercel)에서는 관리자 비밀번호를 로컬 파일에 저장할 수 없습니다.
  // 비밀번호는 Vercel 환경변수 ADMIN_PASSWORD 로만 설정합니다.
  // (구 admin 페이지의 "비밀번호 설정" 흐름은 이 환경에서 지원하지 않음)
  return sendError(
    res,
    400,
    "이 환경에서는 비밀번호를 화면에서 설정할 수 없습니다. Vercel 환경변수 ADMIN_PASSWORD 를 설정한 뒤 로그인하세요."
  );
}

// =========================================================
// 메모(project_memos): 방문자 작성(비공개) + 관리자 열람/관리
// =========================================================
const MEMO_MAX_TITLE = 100;
const MEMO_MAX_BODY = 2000;
const MEMO_MAX_WRITER = 40;
const MEMO_RATE_WINDOW_MS = 60 * 1000; // 1분
const MEMO_RATE_MAX = 3;               // 1분당 최대 3개(같은 IP)

function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

// 방문자: 메모 작성 (POST /api/memos)
async function handleMemoCreate(req, res) {
  if (!supabaseEnabled()) {
    return sendError(res, 503, "메모 저장소가 아직 설정되지 않았습니다.");
  }

  let payload;
  try {
    const body = await collectRequestBody(req, 32 * 1024); // 32KB 상한
    payload = JSON.parse(body.toString("utf8") || "{}");
  } catch {
    return sendError(res, 400, "잘못된 요청입니다.");
  }

  // 스팸 방어 ③ 허니팟: 사람에겐 안 보이는 필드. 채워져 있으면 봇으로 간주.
  if (payload.company || payload.website || payload.url) {
    // 봇에게는 성공한 척(200) 응답해 재시도를 유도하지 않음.
    return sendJson(res, 200, { ok: true });
  }

  // 스팸 방어 ① 입력 제한
  const writer = String(payload.writer || "익명").trim().slice(0, MEMO_MAX_WRITER) || "익명";
  const title = String(payload.title || "").trim();
  const memoBody = String(payload.body || "").trim();

  if (!title || !memoBody) {
    return sendError(res, 400, "제목과 내용을 입력해 주세요.");
  }
  if (title.length > MEMO_MAX_TITLE) {
    return sendError(res, 400, `제목은 ${MEMO_MAX_TITLE}자 이내로 입력해 주세요.`);
  }
  if (memoBody.length > MEMO_MAX_BODY) {
    return sendError(res, 400, `내용은 ${MEMO_MAX_BODY}자 이내로 입력해 주세요.`);
  }
  // 링크 도배 차단: 본문에 URL이 5개 이상이면 거부
  const linkCount = (memoBody.match(/https?:\/\//gi) || []).length;
  if (linkCount >= 5) {
    return sendError(res, 400, "링크가 너무 많습니다.");
  }

  // 스팸 방어 ② 속도 제한: 같은 IP가 최근 1분 내 작성한 메모 수 확인(DB 기반).
  const ip = clientIp(req);
  try {
    const since = new Date(Date.now() - MEMO_RATE_WINDOW_MS).toISOString();
    const recent = await supabaseRequest(
      `/rest/v1/project_memos?select=id&source_ip=eq.${encodeURIComponent(ip)}&created_at=gte.${encodeURIComponent(since)}`
    );
    if (Array.isArray(recent) && recent.length >= MEMO_RATE_MAX) {
      return sendError(res, 429, "잠시 후 다시 시도해 주세요.");
    }
  } catch {
    // 속도 검사 실패는 작성 자체를 막지 않음(가용성 우선).
  }

  try {
    const rows = await supabaseRequest("/rest/v1/project_memos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({ writer, title, body: memoBody, source_ip: ip })
    });
    const saved = rows?.[0];
    // 작성자에게는 내용을 그대로 돌려주지 않음(비공개 의견함).
    return sendJson(res, 201, { ok: true, id: saved?.id || null });
  } catch (error) {
    console.error("Memo create failed:", error);
    return sendError(res, 502, "메모 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

// 관리자: 메모 목록 (GET /api/admin/memos)
async function handleMemoList(req, res) {
  if (!supabaseEnabled()) return sendJson(res, 200, []);
  try {
    const rows = await supabaseRequest(
      "/rest/v1/project_memos?select=*&order=created_at.desc"
    );
    return sendJson(res, 200, Array.isArray(rows) ? rows : []);
  } catch (error) {
    console.error("Memo list failed:", error);
    return sendError(res, 502, "메모를 불러오지 못했습니다.");
  }
}

// 관리자: 읽음 처리 (PATCH /api/admin/memos/:id)
async function handleMemoUpdate(req, res, memoId) {
  try {
    const body = await collectRequestBody(req, 8 * 1024);
    const payload = JSON.parse(body.toString("utf8") || "{}");
    const isRead = Boolean(payload.isRead);
    await supabaseRequest(
      `/rest/v1/project_memos?id=eq.${encodeURIComponent(memoId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_read: isRead })
      }
    );
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error("Memo update failed:", error);
    return sendError(res, 502, "메모 상태 변경에 실패했습니다.");
  }
}

// 관리자: 삭제 (DELETE /api/admin/memos/:id)
async function handleMemoDelete(req, res, memoId) {
  try {
    await supabaseRequest(
      `/rest/v1/project_memos?id=eq.${encodeURIComponent(memoId)}`,
      { method: "DELETE" }
    );
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error("Memo delete failed:", error);
    return sendError(res, 502, "메모 삭제에 실패했습니다.");
  }
}

// =========================================================
// 에세이(essays): 메타데이터 자동 추출 + CRUD
// =========================================================

// 외부 링크에서 Open Graph 메타데이터 추출(제목·요약·이미지·날짜).
// 본문은 추출하지 않음(브런치/네이버가 차단 + 약관 존중).
// 네이버 블로그는 iframe 구조라, 더 잘 열리는 주소 형태로 변환해 후보 목록을 만든다.
function buildUrlCandidates(rawUrl) {
  const url = String(rawUrl || "").trim();
  const candidates = [url];
  try {
    const u = new URL(url);
    const host = u.hostname;
    // 네이버 블로그: blog.naver.com/{id}/{logNo}
    if (host.includes("blog.naver.com")) {
      const parts = u.pathname.split("/").filter(Boolean);
      let blogId = "";
      let logNo = "";
      if (parts.length >= 2) {
        blogId = parts[0];
        logNo = parts[1];
      }
      // 쿼리스트링 형태(PostView)도 대응
      if (u.searchParams.get("blogId")) blogId = u.searchParams.get("blogId");
      if (u.searchParams.get("logNo")) logNo = u.searchParams.get("logNo");

      if (blogId && logNo) {
        // 모바일 주소가 가장 잘 열림 → 우선
        candidates.unshift(`https://m.blog.naver.com/${blogId}/${logNo}`);
        // PostView 내부 주소
        candidates.push(`https://blog.naver.com/PostView.naver?blogId=${blogId}&logNo=${logNo}`);
        candidates.push(`https://m.blog.naver.com/PostView.naver?blogId=${blogId}&logNo=${logNo}`);
      }
    }
  } catch {
    // URL 파싱 실패 시 원본만 사용
  }
  // 중복 제거
  return [...new Set(candidates)];
}

async function fetchMetaFromUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // 모바일 UA가 네이버 모바일 페이지를 더 잘 반환함
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9"
      }
    });
    const html = await res.text();
    if (!html || html.length < 200) return null;
    const pick = (props) => {
      for (const p of props) {
        const re = new RegExp(
          `<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)["']`, "i"
        );
        const m = html.match(re);
        if (m && m[1]) return m[1].trim();
        const re2 = new RegExp(
          `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${p}["']`, "i"
        );
        const m2 = html.match(re2);
        if (m2 && m2[1]) return m2[1].trim();
      }
      return "";
    };
    const decode = (s) => s
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    // 네이버는 og 태그가 없을 때 <title>이나 본문 첫 부분을 쓰기도 함
    let title = decode(pick(["og:title", "twitter:title"]));
    if (!title) {
      const tm = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (tm) title = decode(tm[1].replace(/\s*:\s*네이버 블로그\s*$/, "").trim());
    }
    const summary = decode(pick(["og:description", "twitter:description", "description"]));
    const coverImage = pick(["og:image", "twitter:image"]);
    const publishedAt = pick(["article:published_time", "og:regDate"]);
    if (!title && !summary) return null;
    return { title, summary, coverImage, publishedAt };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchEssayMetadata(url) {
  // 여러 주소 후보를 순서대로 시도, 첫 성공을 반환
  const candidates = buildUrlCandidates(url);
  for (const candidate of candidates) {
    const meta = await fetchMetaFromUrl(candidate);
    if (meta && (meta.title || meta.summary)) return meta;
  }
  return { title: "", summary: "", coverImage: "", publishedAt: "" };
}

// 관리자: 링크에서 메타데이터 미리보기 (POST /api/admin/essays/fetch-meta)
async function handleEssayFetchMeta(req, res) {
  let payload;
  try {
    const body = await collectRequestBody(req, 8 * 1024);
    payload = JSON.parse(body.toString("utf8") || "{}");
  } catch {
    return sendError(res, 400, "잘못된 요청입니다.");
  }
  const url = String(payload.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return sendError(res, 400, "올바른 링크(http/https)를 입력해 주세요.");
  }
  const meta = await fetchEssayMetadata(url);
  return sendJson(res, 200, meta);
}

function dbRowToEssay(row) {
  return {
    id: row.id,
    category: row.category,
    label: row.label || "",
    title: row.title,
    summary: row.summary || "",
    body: row.body || "",
    sourceUrl: row.source_url || "",
    coverImage: row.cover_image || "",
    tags: row.tags || [],
    publishedAt: row.published_at || "",
    status: row.status || "published",
    sortOrder: row.sort_order || 0,
    updatedAt: row.updated_at
  };
}

function essayToDbRow(essay) {
  const id = String(essay.id || "").trim() || `essay-${Date.now()}`;
  return {
    id,
    category: String(essay.category || "news"),
    label: String(essay.label || ""),
    title: String(essay.title || "").trim(),
    summary: String(essay.summary || ""),
    body: String(essay.body || ""),
    source_url: String(essay.sourceUrl || ""),
    cover_image: String(essay.coverImage || ""),
    tags: Array.isArray(essay.tags) ? essay.tags : [],
    published_at: String(essay.publishedAt || ""),
    status: String(essay.status || "published"),
    sort_order: Number(essay.sortOrder || 0),
    updated_at: new Date().toISOString()
  };
}

// 공개: 에세이 목록 (GET /api/essays)
async function handleEssayList(req, res) {
  if (!supabaseEnabled()) return sendJson(res, 200, []);
  try {
    const rows = await supabaseRequest(
      "/rest/v1/essays?select=*&order=category.asc,sort_order.asc,created_at.desc"
    );
    return sendJson(res, 200, Array.isArray(rows) ? rows.map(dbRowToEssay) : []);
  } catch (error) {
    console.error("Essay list failed:", error);
    return sendError(res, 502, "에세이를 불러오지 못했습니다.");
  }
}

// 공개: 에세이 본문 1건 (GET /api/essays/:id)
async function handleEssayDetail(req, res, id) {
  if (!supabaseEnabled()) return sendError(res, 404, "Not found.");
  try {
    const rows = await supabaseRequest(
      `/rest/v1/essays?id=eq.${encodeURIComponent(id)}&select=*`
    );
    const row = rows?.[0];
    if (!row || row.status === "private") return sendError(res, 404, "Not found.");
    return sendJson(res, 200, dbRowToEssay(row));
  } catch (error) {
    console.error("Essay detail failed:", error);
    return sendError(res, 502, "에세이를 불러오지 못했습니다.");
  }
}

// 관리자: 에세이 저장(생성/수정) (POST /api/admin/essays)
async function handleEssaySave(req, res) {
  let payload;
  try {
    const body = await collectRequestBody(req, 1024 * 1024); // 본문 큰 경우 대비 1MB
    payload = JSON.parse(body.toString("utf8") || "{}");
  } catch {
    return sendError(res, 400, "잘못된 요청입니다.");
  }
  if (!String(payload.title || "").trim()) {
    return sendError(res, 400, "제목을 입력해 주세요.");
  }
  try {
    const row = essayToDbRow(payload);
    const saved = await supabaseRequest("/rest/v1/essays?on_conflict=id", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(row)
    });
    return sendJson(res, 200, dbRowToEssay(saved?.[0] || row));
  } catch (error) {
    console.error("Essay save failed:", error);
    return sendError(res, 502, "에세이 저장에 실패했습니다.");
  }
}

// 관리자: 일괄 등록 (POST /api/admin/essays/bulk) — 링크 목록을 받아 메타데이터 채워 저장
async function handleEssayBulk(req, res) {
  let payload;
  try {
    const body = await collectRequestBody(req, 64 * 1024);
    payload = JSON.parse(body.toString("utf8") || "{}");
  } catch {
    return sendError(res, 400, "잘못된 요청입니다.");
  }
  const urls = Array.isArray(payload.urls) ? payload.urls.slice(0, 30) : [];
  const category = String(payload.category || "news");
  if (!urls.length) return sendError(res, 400, "링크를 한 개 이상 입력해 주세요.");

  const results = [];
  for (const rawUrl of urls) {
    const url = String(rawUrl || "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const meta = await fetchEssayMetadata(url);
    const row = essayToDbRow({
      id: `essay-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      category,
      title: meta.title || url,
      summary: meta.summary || "",
      sourceUrl: url,
      coverImage: meta.coverImage || "",
      publishedAt: meta.publishedAt || "",
      status: "published"
    });
    try {
      await supabaseRequest("/rest/v1/essays?on_conflict=id", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(row)
      });
      results.push({ url, title: row.title, ok: true });
    } catch {
      results.push({ url, ok: false });
    }
  }
  return sendJson(res, 200, { count: results.filter(r => r.ok).length, results });
}

// 관리자: 에세이 삭제 (DELETE /api/admin/essays/:id)
async function handleEssayDelete(req, res, id) {
  try {
    await supabaseRequest(`/rest/v1/essays?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error("Essay delete failed:", error);
    return sendError(res, 502, "에세이 삭제에 실패했습니다.");
  }
}

async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "homo-ruens-portfolio",
      storage: supabaseEnabled() ? "supabase" : "local-json",
      time: new Date().toISOString()
    });
  }

  if (req.method === "GET" && pathname === "/api/admin/security/status") {
    return sendJson(res, 200, securityStatus(req));
  }

  if (req.method === "POST" && pathname === "/api/admin/login") {
    return handleLogin(req, res);
  }

  if (req.method === "POST" && pathname === "/api/admin/logout") {
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/admin/security/password") {
    return handlePasswordSave(req, res);
  }

  if (req.method === "GET" && pathname === "/api/projects") {
    const projects = await getProjectsStore();
    const visible = projects
      .filter(project => project.status !== "private")
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map(publicProject);
    return sendJson(res, 200, visible);
  }

  const projectDetail = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (req.method === "GET" && projectDetail) {
    const project = await getProjectStore(projectDetail[1]);
    if (!project || project.status === "private") return sendError(res, 404, "Project not found.");
    return sendJson(res, 200, publicProject(project));
  }

  // 방문자: 메모 작성 (공개 경로, 인증 불필요, 스팸 방어 포함)
  if (req.method === "POST" && pathname === "/api/memos") {
    return handleMemoCreate(req, res);
  }

  // 공개: 에세이 목록 / 본문
  if (req.method === "GET" && pathname === "/api/essays") {
    return handleEssayList(req, res);
  }
  const essayDetail = pathname.match(/^\/api\/essays\/([^/]+)$/);
  if (req.method === "GET" && essayDetail) {
    return handleEssayDetail(req, res, essayDetail[1]);
  }

  // 관리자: 에세이 메타데이터 추출 / 저장 / 일괄등록 / 삭제 (인증 필요)
  if (req.method === "POST" && pathname === "/api/admin/essays/fetch-meta") {
    if (!requireAdmin(req, res)) return;
    return handleEssayFetchMeta(req, res);
  }
  if (req.method === "POST" && pathname === "/api/admin/essays/bulk") {
    if (!requireAdmin(req, res)) return;
    return handleEssayBulk(req, res);
  }
  if (req.method === "POST" && pathname === "/api/admin/essays") {
    if (!requireAdmin(req, res)) return;
    return handleEssaySave(req, res);
  }
  const adminEssayDetail = pathname.match(/^\/api\/admin\/essays\/([^/]+)$/);
  if (req.method === "DELETE" && adminEssayDetail) {
    if (!requireAdmin(req, res)) return;
    return handleEssayDelete(req, res, adminEssayDetail[1]);
  }

  // 관리자: 메모 목록 / 읽음 / 삭제 (인증 필요)
  if (req.method === "GET" && pathname === "/api/admin/memos") {
    if (!requireAdmin(req, res)) return;
    return handleMemoList(req, res);
  }
  const memoDetail = pathname.match(/^\/api\/admin\/memos\/([^/]+)$/);
  if (req.method === "PATCH" && memoDetail) {
    if (!requireAdmin(req, res)) return;
    return handleMemoUpdate(req, res, memoDetail[1]);
  }
  if (req.method === "DELETE" && memoDetail) {
    if (!requireAdmin(req, res)) return;
    return handleMemoDelete(req, res, memoDetail[1]);
  }

  if (req.method === "GET" && pathname === "/api/admin/projects") {
    if (!requireAdmin(req, res)) return;
    const projects = (await getProjectsStore())
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map(adminProject);
    return sendJson(res, 200, projects);
  }

  const adminProjectDetail = pathname.match(/^\/api\/admin\/projects\/([^/]+)$/);
  if (req.method === "GET" && adminProjectDetail) {
    if (!requireAdmin(req, res)) return;
    const project = await getProjectStore(adminProjectDetail[1]);
    if (!project) return sendError(res, 404, "Project not found.");
    return sendJson(res, 200, adminProject(project));
  }

  if (req.method === "POST" && pathname === "/api/admin/projects") {
    if (!requireAdmin(req, res)) return;
    return handleProjectSave(req, res);
  }

  const projectUpdate = pathname.match(/^\/api\/admin\/projects\/([^/]+)$/);
  if ((req.method === "PUT" || req.method === "POST") && projectUpdate) {
    if (!requireAdmin(req, res)) return;
    return handleProjectSave(req, res, projectUpdate[1]);
  }

  if (req.method === "DELETE" && projectUpdate) {
    if (!requireAdmin(req, res)) return;
    const deleted = await deleteProjectStore(projectUpdate[1]);
    if (!deleted) return sendError(res, 404, "Project not found.");
    return sendJson(res, 200, { ok: true });
  }

  const imageUpload = pathname.match(/^\/api\/admin\/projects\/([^/]+)\/images$/);
  if (req.method === "POST" && imageUpload) {
    if (!requireAdmin(req, res)) return;
    return handleUpload(req, res, imageUpload[1], "images");
  }

  const fileUpload = pathname.match(/^\/api\/admin\/projects\/([^/]+)\/files$/);
  if (req.method === "POST" && fileUpload) {
    if (!requireAdmin(req, res)) return;
    return handleUpload(req, res, fileUpload[1], "files");
  }

  const assetDelete = pathname.match(/^\/api\/admin\/projects\/([^/]+)\/(images|files)\/([^/]+)$/);
  if (req.method === "PATCH" && assetDelete) {
    if (!requireAdmin(req, res)) return;
    let payload;
    try {
      const body = await collectRequestBody(req, 64 * 1024);
      payload = JSON.parse(body.toString("utf8") || "{}");
    } catch {
      return sendError(res, 400, "Invalid JSON body.");
    }
    try {
      const updated = await updateAssetStore(assetDelete[1], assetDelete[2], assetDelete[3], payload);
      if (!updated) return sendError(res, 404, "Asset not found.");
      return sendJson(res, 200, updated);
    } catch (error) {
      return sendError(res, 400, error.message);
    }
  }

  if (req.method === "DELETE" && assetDelete) {
    if (!requireAdmin(req, res)) return;
    const deleted = await deleteAssetStore(assetDelete[1], assetDelete[2], assetDelete[3]);
    if (!deleted) return sendError(res, 404, "Asset not found.");
    return sendJson(res, 200, { ok: true });
  }

  // 정적 파일 요청이 여기 도달하면 안 됩니다(vercel.json이 /api/* 만 이 함수로 보냄).
  // 혹시 도달하면 404로 응답.
  if (req.method === "GET" || req.method === "HEAD") {
    return sendError(res, 404, "Not found. Static assets are served by Vercel, not this function.");
  }
  sendError(res, 405, "Method not allowed.");
}

// ── Vercel 서버리스 진입점 ─────────────────────────────────────────────
// Vercel은 (req, res) 시그니처의 핸들러를 default export 하면 호출합니다.
// 기존 router(req, res)가 거의 동일한 형태라 그대로 감싸 사용합니다.
module.exports = (req, res) => {
  router(req, res).catch(error => {
    console.error(error);
    sendError(res, 500, "Internal server error.");
  });
};
