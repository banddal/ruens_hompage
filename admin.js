const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

let projects = [];
let selectedProject = null;
let securityState = null;

const authPanel = $("#authPanel");
const authForm = $("#authForm");
const authPassword = $("#authPassword");
const authTitle = $("#authTitle");
const authDescription = $("#authDescription");
const authSubmit = $("#authSubmit");
const authStatus = $("#authStatus");
const adminContent = $("#adminContent");
const logoutButton = $("#logoutButton");
const projectList = $("#projectList");
const projectSearch = $("#projectSearch");
const projectForm = $("#projectForm");
const imageUploadForm = $("#imageUploadForm");
const fileUploadForm = $("#fileUploadForm");
const imageList = $("#imageList");
const fileList = $("#fileList");
const saveStatus = $("#saveStatus");
const securityStatusList = $("#securityStatusList");
const passwordForm = $("#passwordForm");
const newPassword = $("#newPassword");
const confirmPassword = $("#confirmPassword");
const passwordStatus = $("#passwordStatus");

function splitTags(value) {
  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function joinTags(value) {
  return Array.isArray(value) ? value.join(", ") : "";
}

function setStatus(target, message) {
  target.textContent = message;
  window.clearTimeout(target._timer);
  target._timer = window.setTimeout(() => {
    target.textContent = "";
  }, 3600);
}

function projectLabel(project) {
  return [project.metric, project.period].filter(Boolean).join(" · ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function apiJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      showAuthPanel(data.error || "관리자 로그인이 필요합니다.");
    }
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function showAuthPanel(message = "") {
  const setupRequired = securityState && !securityState.authConfigured;
  authTitle.textContent = setupRequired ? "관리자 비밀번호 설정" : "관리자 로그인";
  authDescription.textContent = setupRequired
    ? "아직 관리자 비밀번호가 없습니다. 첫 비밀번호를 설정하면 관리자 API가 보호됩니다."
    : "관리자 비밀번호를 입력하면 프로젝트 저장과 파일 업로드가 활성화됩니다.";
  authSubmit.textContent = setupRequired ? "비밀번호 설정" : "로그인";
  authPassword.value = "";
  authStatus.textContent = message;
  authPanel.classList.remove("hidden");
  adminContent.classList.add("hidden");
  logoutButton.classList.add("hidden");
}

function showAdminPanel() {
  authPanel.classList.add("hidden");
  adminContent.classList.remove("hidden");
  logoutButton.classList.remove("hidden");
}

function renderSecurityStatus(status) {
  securityState = status;
  const rows = [
    ["관리자 인증", status.authConfigured ? "설정됨" : "미설정"],
    ["현재 세션", status.authenticated ? "로그인됨" : "로그아웃"],
    ["비밀번호 저장 위치", status.passwordSource],
    ["관리자 API 보호", status.adminApiProtected ? "활성" : "비활성"],
    ["세션 유지 시간", `${status.sessionHours}시간`],
    ["업로드 최대 용량", `${status.uploads?.maxMB || "-"}MB`],
    ["허용 확장자", (status.uploads?.allowedExtensions || []).join(", ")],
    ["저장소", status.storage?.mode || "-"],
    ["저장소 메모", status.storage?.note || "-"]
  ];

  securityStatusList.innerHTML = rows.map(([label, value]) => `
    <div class="security-row">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(value)}</span>
    </div>
  `).join("");
}

async function loadSecurityStatus() {
  const status = await apiJson("/api/admin/security/status");
  renderSecurityStatus(status);
  if (status.authenticated) {
    showAdminPanel();
    await loadProjects();
  } else {
    showAuthPanel();
  }
}

async function submitAuth(event) {
  event.preventDefault();
  const password = authPassword.value;
  if (!password) return;

  try {
    const url = securityState && !securityState.authConfigured
      ? "/api/admin/security/password"
      : "/api/admin/login";
    const status = await apiJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    renderSecurityStatus(status);
    showAdminPanel();
    await loadProjects();
  } catch (error) {
    setStatus(authStatus, error.message);
  }
}

async function logout() {
  await apiJson("/api/admin/logout", { method: "POST" }).catch(() => null);
  selectedProject = null;
  projects = [];
  await loadSecurityStatus();
}

function renderProjectList() {
  const query = projectSearch.value.trim().toLowerCase();
  const filtered = projects.filter(project => {
    const haystack = [
      project.id,
      project.slug,
      project.title,
      project.metric,
      project.category,
      project.period,
      ...(project.tags || [])
    ].join(" ").toLowerCase();
    return !query || haystack.includes(query);
  });

  projectList.innerHTML = filtered.map(project => `
    <button type="button" class="project-item${selectedProject?.id === project.id ? " active" : ""}" data-project-id="${escapeHtml(project.id)}">
      <strong>${escapeHtml(project.title || project.id)}</strong>
      <small>${escapeHtml(projectLabel(project) || project.category || "")}</small>
    </button>
  `).join("");
}

function fillForm(project) {
  selectedProject = project;
  projectForm.elements.id.value = project.id || "";
  projectForm.elements.slug.value = project.slug || project.id || "";
  projectForm.elements.title.value = project.title || "";
  projectForm.elements.metric.value = project.metric || "";
  projectForm.elements.category.value = project.category || "Plan";
  projectForm.elements.period.value = project.period || "";
  projectForm.elements.status.value = project.status || "published";
  projectForm.elements.short.value = project.short || "";
  projectForm.elements.description.value = project.description || "";
  projectForm.elements.role.value = project.role || "";
  projectForm.elements.outcome.value = project.outcome || "";
  projectForm.elements.tags.value = joinTags(project.tags);
  projectForm.elements.skillTags.value = joinTags(project.skillTags);
  renderAssets(project);
  renderProjectList();
}

function readForm() {
  const form = projectForm.elements;
  return {
    id: form.id.value.trim(),
    slug: form.slug.value.trim() || form.id.value.trim(),
    title: form.title.value.trim(),
    metric: form.metric.value.trim(),
    category: form.category.value,
    period: form.period.value.trim(),
    status: form.status.value,
    short: form.short.value.trim(),
    description: form.description.value.trim(),
    role: form.role.value.trim(),
    outcome: form.outcome.value.trim(),
    tags: splitTags(form.tags.value),
    skillTags: splitTags(form.skillTags.value),
    gallery: selectedProject?.gallery || [],
    images: selectedProject?.images || [],
    files: selectedProject?.files || [],
    sortOrder: selectedProject?.sortOrder || projects.length + 1
  };
}

function renderAssets(project) {
  const images = project?.images || [];
  const files = project?.files || [];

  imageList.innerHTML = images.length ? images.map(item => `
    <div class="asset-item">
      <strong>${escapeHtml(item.title || item.originalFilename || "Image")}</strong>
      <span>${escapeHtml(item.path || "")}</span>
    </div>
  `).join("") : `<div class="asset-empty">등록된 이미지가 없습니다.</div>`;

  fileList.innerHTML = files.length ? files.map(item => `
    <div class="asset-item">
      <strong>${escapeHtml(item.title || item.originalFilename || "File")} · ${escapeHtml(item.fileType || "")}</strong>
      <span>${escapeHtml(item.visibility || "request")} / ${escapeHtml(item.path || "")}</span>
    </div>
  `).join("") : `<div class="asset-empty">등록된 첨부파일이 없습니다.</div>`;
}

async function loadProjects(selectId = selectedProject?.id) {
  projects = await apiJson("/api/admin/projects");
  const next = projects.find(project => project.id === selectId) || projects[0] || null;
  if (next) {
    const detail = await apiJson(`/api/admin/projects/${encodeURIComponent(next.slug || next.id)}`);
    fillForm(detail);
  } else {
    newProject();
  }
  renderProjectList();
}

function newProject() {
  const empty = {
    id: "",
    slug: "",
    title: "",
    metric: "",
    category: "Plan",
    period: "",
    status: "draft",
    short: "",
    description: "",
    role: "",
    outcome: "",
    tags: [],
    skillTags: [],
    gallery: [],
    images: [],
    files: [],
    sortOrder: projects.length + 1
  };
  fillForm(empty);
}

async function saveProject(event) {
  event.preventDefault();
  const payload = readForm();
  if (!payload.id || !payload.title) {
    setStatus(saveStatus, "ID와 제목이 필요합니다.");
    return;
  }

  const existing = selectedProject?.id;
  const url = existing ? `/api/admin/projects/${encodeURIComponent(existing)}` : "/api/admin/projects";
  const method = existing ? "PUT" : "POST";
  const saved = await apiJson(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  setStatus(saveStatus, "저장되었습니다.");
  await loadProjects(saved.id);
}

async function uploadAsset(event, type) {
  event.preventDefault();
  if (!selectedProject?.id) {
    setStatus(saveStatus, "먼저 프로젝트를 선택하거나 저장해주세요.");
    return;
  }

  const form = event.currentTarget;
  const data = new FormData(form);
  const endpoint = type === "images" ? "images" : "files";
  await apiJson(`/api/admin/projects/${encodeURIComponent(selectedProject.id)}/${endpoint}`, {
    method: "POST",
    body: data
  });
  form.reset();
  setStatus(saveStatus, type === "images" ? "이미지가 추가되었습니다." : "첨부파일이 추가되었습니다.");
  await loadProjects(selectedProject.id);
}

async function savePassword(event) {
  event.preventDefault();
  if (newPassword.value !== confirmPassword.value) {
    setStatus(passwordStatus, "비밀번호 확인이 일치하지 않습니다.");
    return;
  }

  try {
    const status = await apiJson("/api/admin/security/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPassword.value })
    });
    passwordForm.reset();
    renderSecurityStatus(status);
    setStatus(passwordStatus, "비밀번호가 저장되었습니다.");
  } catch (error) {
    setStatus(passwordStatus, error.message);
  }
}

function switchTab(name) {
  $$(".admin-tab").forEach(button => {
    button.classList.toggle("active", button.dataset.adminTab === name);
  });
  $$(".admin-tab-panel").forEach(panel => {
    panel.classList.toggle("hidden", panel.id !== `${name}Panel`);
  });
}

projectList.addEventListener("click", async event => {
  const button = event.target.closest("[data-project-id]");
  if (!button) return;
  const project = projects.find(item => item.id === button.dataset.projectId);
  if (!project) return;
  const detail = await apiJson(`/api/admin/projects/${encodeURIComponent(project.slug || project.id)}`);
  fillForm(detail);
});

projectSearch.addEventListener("input", renderProjectList);
$("#reloadProjects").addEventListener("click", () => loadProjects());
$("#newProject").addEventListener("click", newProject);
projectForm.addEventListener("submit", saveProject);
imageUploadForm.addEventListener("submit", event => uploadAsset(event, "images"));
fileUploadForm.addEventListener("submit", event => uploadAsset(event, "files"));
authForm.addEventListener("submit", submitAuth);
logoutButton.addEventListener("click", logout);
passwordForm.addEventListener("submit", savePassword);
$$(".admin-tab").forEach(button => {
  button.addEventListener("click", () => switchTab(button.dataset.adminTab));
});

loadSecurityStatus().catch(error => {
  showAuthPanel(error.message);
});
