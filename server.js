const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const PROJECTS_DB = path.join(ROOT, "backend-data", "projects.json");
const MEDIA_DB = path.join(ROOT, "backend-data", "media-assets.json");
const SECURITY_DB = path.join(ROOT, "backend-data", "security.json");
const CONTENT_PROJECTS_DB = path.join(ROOT, "content-data", "projects.json");
const UPLOAD_ROOT = path.join(ROOT, "uploads", "projects");
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 50 * 1024 * 1024);
const SESSION_COOKIE = "homo_ruens_admin";
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "portfolio-assets";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".hwp": "application/x-hwp",
  ".hwpx": "application/vnd.hancom.hwpx",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

const ALLOWED_UPLOAD_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".avif",
  ".pdf", ".ppt", ".pptx", ".hwp", ".hwpx", ".doc", ".docx", ".xls", ".xlsx"
]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
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
  const security = readJson(SECURITY_DB, {});
  if (security.passwordHash?.hash && security.passwordHash?.salt) {
    return { source: "admin-page", record: security.passwordHash };
  }
  if (process.env.ADMIN_PASSWORD) return { source: "render-env", plain: process.env.ADMIN_PASSWORD };
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
      mode: supabaseEnabled() ? "supabase" : (process.env.RENDER ? "render-local" : "local"),
      bucket: supabaseEnabled() ? SUPABASE_STORAGE_BUCKET : "",
      note: supabaseEnabled()
        ? "Supabase Database와 Storage를 우선 저장소로 사용 중입니다."
        : process.env.RENDER
        ? "Render 재배포 시 로컬 업로드 파일이 사라질 수 있으므로 Persistent Disk 또는 외부 Storage 연결이 필요합니다."
        : "현재 로컬 파일 시스템에 저장 중입니다."
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
    sortOrder: project.sortOrder || index + 1,
    createdAt: project.createdAt || project.updatedAt || new Date().toISOString(),
    updatedAt: project.updatedAt || new Date().toISOString()
  };
}

function initializeBackendData() {
  ensureDir(path.dirname(PROJECTS_DB));
  ensureDir(UPLOAD_ROOT);

  if (!fs.existsSync(PROJECTS_DB)) {
    const seedProjects = readJson(CONTENT_PROJECTS_DB, []);
    const normalized = Array.isArray(seedProjects)
      ? seedProjects.map(normalizeProject)
      : [];
    writeJson(PROJECTS_DB, normalized);
  }

  if (!fs.existsSync(MEDIA_DB)) {
    writeJson(MEDIA_DB, []);
  }
}

function localSeedProjects() {
  const seedProjects = fs.existsSync(PROJECTS_DB)
    ? readJson(PROJECTS_DB, [])
    : readJson(CONTENT_PROJECTS_DB, []);
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
  return readJson(PROJECTS_DB, []);
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
  const hasPassword = Boolean(passwordRecord());
  if (hasPassword && !requireAdmin(req, res)) return;

  let payload;
  try {
    const body = await collectRequestBody(req, 64 * 1024);
    payload = JSON.parse(body.toString("utf8") || "{}");
  } catch {
    return sendError(res, 400, "Invalid JSON body.");
  }

  const password = String(payload.password || "");
  if (password.length < 10) return sendError(res, 400, "Password must be at least 10 characters.");

  writeJson(SECURITY_DB, {
    passwordHash: hashPassword(password),
    updatedAt: new Date().toISOString()
  });
  setSessionCookie(req, res);
  sendJson(res, 200, { ...securityStatus(req), authenticated: true });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) return sendError(res, 403, "Forbidden.");

  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) return sendError(res, 404, "Not found.");
    const ext = path.extname(filePath).toLowerCase();
    const noStore = pathname.startsWith("/admin") || ext === ".html";
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": noStore ? "no-store" : "public, max-age=300"
    });
    fs.createReadStream(filePath).pipe(res);
  });
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

  if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
  sendError(res, 405, "Method not allowed.");
}

initializeBackendData();

http.createServer((req, res) => {
  router(req, res).catch(error => {
    console.error(error);
    sendError(res, 500, "Internal server error.");
  });
}).listen(PORT, () => {
  console.log(`Homo Ruens portfolio backend running at http://localhost:${PORT}`);
});
