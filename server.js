const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const PROJECTS_DB = path.join(ROOT, "backend-data", "projects.json");
const MEDIA_DB = path.join(ROOT, "backend-data", "media-assets.json");
const SECURITY_DB = path.join(ROOT, "backend-data", "security.json");
const UPLOAD_ROOT = path.join(ROOT, "uploads", "projects");
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 50 * 1024 * 1024);
const SESSION_COOKIE = "homo_ruens_admin";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

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

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
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
      mode: process.env.RENDER ? "render" : "local",
      note: process.env.RENDER
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
  const projects = readJson(PROJECTS_DB, []);
  const project = findProject(projects, projectKey);
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

  const originalName = path.basename(file.filename);
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_UPLOAD_EXTS.has(ext)) return sendError(res, 400, `Unsupported file type: ${ext}`);

  const slug = safeSegment(project.slug || project.id);
  const folder = target === "images" ? "images" : "files";
  const uploadDir = path.join(UPLOAD_ROOT, slug, folder);
  ensureDir(uploadDir);

  const stem = safeSegment(path.basename(originalName, ext)) || "asset";
  const storedName = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${stem}${ext}`;
  const filePath = path.join(uploadDir, storedName);
  fs.writeFileSync(filePath, file.content);

  const publicPath = `/uploads/projects/${slug}/${folder}/${storedName}`;
  const record = {
    id: crypto.randomUUID(),
    projectId: project.id,
    title: fields.title || path.basename(originalName, ext),
    description: fields.description || "",
    caption: fields.caption || fields.description || "",
    alt: fields.alt || fields.title || originalName,
    originalFilename: originalName,
    path: publicPath,
    fileType: fileKind(ext),
    mimeType: file.contentType,
    fileSize: file.content.length,
    visibility: fields.visibility || "request",
    sortOrder: Number(fields.sortOrder || 0),
    createdAt: new Date().toISOString()
  };

  if (target === "images") {
    project.images = [...(project.images || []), record];
  } else {
    project.files = [...(project.files || []), record];
  }
  project.updatedAt = new Date().toISOString();
  writeJson(PROJECTS_DB, projects);

  const media = readJson(MEDIA_DB, []);
  media.push({ ...record, target });
  writeJson(MEDIA_DB, media);

  sendJson(res, 201, record);
}

async function handleProjectSave(req, res, key = null) {
  let payload;
  try {
    const body = await collectRequestBody(req, 2 * 1024 * 1024);
    payload = JSON.parse(body.toString("utf8") || "{}");
  } catch {
    return sendError(res, 400, "Invalid JSON body.");
  }

  const projects = readJson(PROJECTS_DB, []);
  const now = new Date().toISOString();
  const projectId = key || payload.id || safeSegment(payload.title);
  if (!projectId) return sendError(res, 400, "Project id or title is required.");

  const existing = findProject(projects, projectId);
  if (existing) {
    Object.assign(existing, payload, {
      id: existing.id,
      slug: payload.slug || existing.slug || existing.id,
      updatedAt: now
    });
    writeJson(PROJECTS_DB, projects);
    return sendJson(res, 200, publicProject(existing));
  }

  const created = {
    id: safeSegment(payload.id || projectId),
    slug: safeSegment(payload.slug || payload.id || projectId),
    category: payload.category || "Plan",
    metric: payload.metric || "",
    title: payload.title || projectId,
    period: payload.period || "",
    short: payload.short || "",
    description: payload.description || "",
    role: payload.role || "",
    outcome: payload.outcome || "",
    tags: payload.tags || [],
    skillTags: payload.skillTags || [],
    gallery: payload.gallery || [],
    images: payload.images || [],
    files: payload.files || [],
    status: payload.status || "draft",
    sortOrder: payload.sortOrder || projects.length + 1,
    createdAt: now,
    updatedAt: now
  };
  projects.push(created);
  writeJson(PROJECTS_DB, projects);
  sendJson(res, 201, publicProject(created));
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
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream"
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, service: "homo-ruens-portfolio", time: new Date().toISOString() });
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
    const projects = readJson(PROJECTS_DB, []);
    const visible = projects
      .filter(project => project.status !== "private")
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map(publicProject);
    return sendJson(res, 200, visible);
  }

  const projectDetail = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (req.method === "GET" && projectDetail) {
    const projects = readJson(PROJECTS_DB, []);
    const project = findProject(projects, projectDetail[1]);
    if (!project || project.status === "private") return sendError(res, 404, "Project not found.");
    return sendJson(res, 200, publicProject(project));
  }

  if (req.method === "GET" && pathname === "/api/admin/projects") {
    if (!requireAdmin(req, res)) return;
    const projects = readJson(PROJECTS_DB, [])
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map(adminProject);
    return sendJson(res, 200, projects);
  }

  const adminProjectDetail = pathname.match(/^\/api\/admin\/projects\/([^/]+)$/);
  if (req.method === "GET" && adminProjectDetail) {
    if (!requireAdmin(req, res)) return;
    const projects = readJson(PROJECTS_DB, []);
    const project = findProject(projects, adminProjectDetail[1]);
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

  if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
  sendError(res, 405, "Method not allowed.");
}

ensureDir(path.dirname(PROJECTS_DB));
ensureDir(UPLOAD_ROOT);

http.createServer((req, res) => {
  router(req, res).catch(error => {
    console.error(error);
    sendError(res, 500, "Internal server error.");
  });
}).listen(PORT, () => {
  console.log(`Homo Ruens portfolio backend running at http://localhost:${PORT}`);
});
