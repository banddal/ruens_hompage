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
const projectPanelTitle = $(".project-list-panel .panel-head h2");
const projectList = $("#projectList");
const projectSearch = $("#projectSearch");
const projectForm = $("#projectForm");
const imageUploadForm = $("#imageUploadForm");
const fileUploadForm = $("#fileUploadForm");
const imageList = $("#imageList");
const fileList = $("#fileList");
const saveStatus = $("#saveStatus");
const duplicateProjectButton = $("#duplicateProject");
const deleteProjectButton = $("#deleteProject");
const securityStatusList = $("#securityStatusList");
const passwordForm = $("#passwordForm");
const newPassword = $("#newPassword");
const confirmPassword = $("#confirmPassword");
const passwordStatus = $("#passwordStatus");
const DASHBOARD_RECENT_TAG = "__dashboard_recent";

function splitTags(value) {
  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(item => item && item !== DASHBOARD_RECENT_TAG);
}

function joinTags(value) {
  return Array.isArray(value) ? value.filter(item => item !== DASHBOARD_RECENT_TAG).join(", ") : "";
}

function readCheckedValues(name) {
  return Array.from(projectForm.querySelectorAll(`input[name="${name}"]:checked`))
    .map(input => input.value);
}

function writeCheckedValues(name, values) {
  const selected = new Set(Array.isArray(values) ? values : []);
  projectForm.querySelectorAll(`input[name="${name}"]`).forEach(input => {
    input.checked = selected.has(input.value);
  });
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

function isDashboardFeatured(project) {
  return Boolean(project?.dashboardFeatured || (project?.tags || []).includes(DASHBOARD_RECENT_TAG));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function visibilityLabel(value) {
  if (value === "public") return "공개 다운로드";
  if (value === "private") return "비공개 보관";
  return "요청 시 공개";
}

function fileSizeLabel(value) {
  const size = Number(value || 0);
  if (!size) return "";
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  if (size >= 1024) return `${Math.round(size / 1024)}KB`;
  return `${size}B`;
}

function assetUrl(item) {
  return item.publicUrl || item.path || "";
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

  projectPanelTitle.textContent = query
    ? `Projects (${filtered.length}/${projects.length})`
    : `Projects (${projects.length})`;

  projectList.innerHTML = filtered.length ? filtered.map(project => `
    <button type="button" class="project-item${selectedProject?.id === project.id ? " active" : ""}" data-project-id="${escapeHtml(project.id)}">
      <strong>${escapeHtml(project.title || project.id)}</strong>
      <small>${isDashboardFeatured(project) ? "Dashboard · " : ""}${escapeHtml(projectLabel(project) || project.category || "")}</small>
    </button>
  `).join("") : `<div class="asset-empty">표시할 프로젝트가 없습니다.</div>`;
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
  projectForm.elements.dashboardFeatured.checked = isDashboardFeatured(project);
  writeCheckedValues("skillTags", project.skillTags);
  writeCheckedValues("teamPositions", project.teamPositions);
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
    dashboardFeatured: Boolean(form.dashboardFeatured.checked),
    skillTags: readCheckedValues("skillTags"),
    teamPositions: readCheckedValues("teamPositions"),
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
    <div class="asset-item" data-asset-id="${escapeHtml(item.id || "")}">
      <strong>${escapeHtml(item.title || item.originalFilename || "Image")}</strong>
      <span>${escapeHtml(item.caption || item.alt || "")}</span>
      <div class="asset-meta">
        <span class="asset-badge public">이미지</span>
        <span class="asset-badge">${escapeHtml(fileSizeLabel(item.fileSize))}</span>
      </div>
      <div class="asset-actions">
        ${assetUrl(item) ? `<a href="${escapeHtml(assetUrl(item))}" target="_blank" rel="noopener">열기</a>` : ""}
        <button type="button" class="danger" data-delete-asset="images" data-asset-id="${escapeHtml(item.id || "")}">삭제</button>
      </div>
    </div>
  `).join("") : `<div class="asset-empty">등록된 이미지가 없습니다.</div>`;

  fileList.innerHTML = files.length ? files.map(item => `
    <div class="asset-item" data-asset-id="${escapeHtml(item.id || "")}">
      <strong>${escapeHtml(item.title || item.originalFilename || "File")}</strong>
      <span>${escapeHtml(item.description || item.originalFilename || "")}</span>
      <div class="asset-meta">
        <span class="asset-badge ${item.visibility === "public" ? "public" : ""}">${escapeHtml(visibilityLabel(item.visibility))}</span>
        <span class="asset-badge">${escapeHtml(item.fileType || "file")}</span>
        <span class="asset-badge">${escapeHtml(fileSizeLabel(item.fileSize))}</span>
      </div>
      <div class="asset-actions">
        <select class="asset-visibility-select" data-asset-visibility="files" data-asset-id="${escapeHtml(item.id || "")}">
          <option value="public"${item.visibility === "public" ? " selected" : ""}>공개 다운로드</option>
          <option value="request"${item.visibility === "request" || !item.visibility ? " selected" : ""}>요청 시 공개</option>
          <option value="private"${item.visibility === "private" ? " selected" : ""}>비공개</option>
        </select>
        ${assetUrl(item) ? `<a href="${escapeHtml(assetUrl(item))}" target="_blank" rel="noopener">확인</a>` : ""}
        <button type="button" class="danger" data-delete-asset="files" data-asset-id="${escapeHtml(item.id || "")}">삭제</button>
      </div>
    </div>
  `).join("") : `<div class="asset-empty">등록된 첨부파일이 없습니다.</div>`;
}

async function loadProjects(selectId = selectedProject?.id) {
  projectPanelTitle.textContent = "Projects";
  projectList.innerHTML = `<div class="asset-empty">프로젝트 목록을 불러오는 중입니다.</div>`;
  try {
    projects = await apiJson("/api/admin/projects");
    if (!Array.isArray(projects)) projects = [];
    if (!projects.length) {
      const publicProjects = await apiJson("/api/projects").catch(() => []);
      if (Array.isArray(publicProjects) && publicProjects.length) {
        projects = publicProjects;
      }
    }
    const next = projects.find(project => project.id === selectId) || projects[0] || null;
    renderProjectList();
    if (next) {
      const detail = await apiJson(`/api/admin/projects/${encodeURIComponent(next.slug || next.id)}`);
      fillForm(detail);
    } else {
      newProject();
    }
    renderProjectList();
  } catch (error) {
    projectPanelTitle.textContent = "Projects";
    projectList.innerHTML = `<div class="asset-empty">프로젝트 목록을 불러오지 못했습니다.<br>${escapeHtml(error.message)}</div>`;
    throw error;
  }
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
    dashboardFeatured: false,
    skillTags: [],
    teamPositions: [],
    gallery: [],
    images: [],
    files: [],
    sortOrder: projects.length + 1
  };
  fillForm(empty);
}

function duplicateProject() {
  if (!selectedProject?.id) {
    setStatus(saveStatus, "복제할 프로젝트를 먼저 선택해주세요.");
    return;
  }
  const copy = {
    ...selectedProject,
    id: "",
    slug: "",
    title: `${selectedProject.title || "Project"} copy`,
    status: "draft",
    dashboardFeatured: false,
    gallery: [...(selectedProject.gallery || [])],
    images: [],
    files: [],
    sortOrder: projects.length + 1
  };
  fillForm(copy);
  setStatus(saveStatus, "복제 초안이 만들어졌습니다. ID를 입력한 뒤 저장해주세요.");
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
  const fileInput = form.elements.file;
  const files = Array.from(fileInput.files || []);
  if (!files.length) {
    setStatus(saveStatus, "업로드할 파일을 선택해주세요.");
    return;
  }

  const endpoint = type === "images" ? "images" : "files";
  const titleBase = form.elements.title?.value.trim() || "";
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    for (const [index, file] of files.entries()) {
      const data = new FormData();
      data.append("file", file, file.name);
      if (titleBase) data.append("title", files.length > 1 ? `${titleBase} ${index + 1}` : titleBase);
      if (type === "images") {
        data.append("caption", form.elements.caption?.value.trim() || "");
        data.append("alt", form.elements.alt?.value.trim() || "");
        data.append("visibility", "public");
      } else {
        data.append("description", form.elements.description?.value.trim() || "");
        data.append("visibility", form.elements.visibility?.value || "request");
      }
      data.append("sortOrder", String((selectedProject[type]?.length || 0) + index + 1));
      setStatus(saveStatus, `${index + 1}/${files.length} 업로드 중입니다.`);
      await apiJson(`/api/admin/projects/${encodeURIComponent(selectedProject.id)}/${endpoint}`, {
        method: "POST",
        body: data
      });
    }
    form.reset();
    setStatus(saveStatus, type === "images" ? `${files.length}개 이미지가 추가되었습니다.` : `${files.length}개 첨부파일이 추가되었습니다.`);
    await loadProjects(selectedProject.id);
  } catch (error) {
    setStatus(saveStatus, `업로드 실패: ${error.message}`);
    console.error("Upload failed", error);
  } finally {
    submitButton.disabled = false;
  }
}

async function deleteProject() {
  if (!selectedProject?.id) {
    setStatus(saveStatus, "삭제할 프로젝트를 먼저 선택해주세요.");
    return;
  }
  const ok = window.confirm(`"${selectedProject.title || selectedProject.id}" 프로젝트를 삭제할까요?`);
  if (!ok) return;
  await apiJson(`/api/admin/projects/${encodeURIComponent(selectedProject.id)}`, { method: "DELETE" });
  setStatus(saveStatus, "프로젝트가 삭제되었습니다.");
  await loadProjects();
}

async function deleteAsset(type, assetId) {
  if (!selectedProject?.id || !assetId) return;
  const ok = window.confirm("이 파일 기록을 삭제할까요?");
  if (!ok) return;
  await apiJson(`/api/admin/projects/${encodeURIComponent(selectedProject.id)}/${type}/${encodeURIComponent(assetId)}`, { method: "DELETE" });
  setStatus(saveStatus, "파일 기록이 삭제되었습니다.");
  await loadProjects(selectedProject.id);
}

async function updateAssetVisibility(type, assetId, visibility) {
  if (!selectedProject?.id || !assetId) return;
  await apiJson(`/api/admin/projects/${encodeURIComponent(selectedProject.id)}/${type}/${encodeURIComponent(assetId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visibility })
  });
  setStatus(saveStatus, "공개 상태가 저장되었습니다.");
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
  if (name === "memos") loadMemos();
}

// ===== 메모 관리 (관리자 전용) =====
function escapeMemo(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function formatMemoDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function loadMemos() {
  const list = $("#memoList");
  const countEl = $("#memoCount");
  if (!list) return;
  list.innerHTML = `<p class="memo-admin-empty">불러오는 중…</p>`;
  const memos = await apiJson("/api/admin/memos").catch(() => null);
  if (!Array.isArray(memos)) {
    list.innerHTML = `<p class="memo-admin-empty">메모를 불러오지 못했습니다.</p>`;
    return;
  }
  const unread = memos.filter(m => !m.is_read).length;
  if (countEl) countEl.textContent = memos.length ? `(${unread} / ${memos.length})` : "";
  if (!memos.length) {
    list.innerHTML = `<p class="memo-admin-empty">아직 받은 메모가 없습니다.</p>`;
    return;
  }
  list.innerHTML = memos.map(m => `
    <article class="memo-admin-item ${m.is_read ? "is-read" : "is-unread"}" data-memo-id="${escapeMemo(m.id)}">
      <div class="memo-admin-head">
        <strong>${escapeMemo(m.title)}</strong>
        <span class="memo-admin-meta">${escapeMemo(m.writer || "익명")} · ${escapeMemo(formatMemoDate(m.created_at))}</span>
      </div>
      <p class="memo-admin-body">${escapeMemo(m.body)}</p>
      <div class="memo-admin-actions">
        <button type="button" class="ghost" data-memo-read="${escapeMemo(m.id)}" data-read="${m.is_read ? "1" : "0"}">
          ${m.is_read ? "안읽음으로" : "읽음으로"}
        </button>
        <button type="button" class="danger" data-memo-delete="${escapeMemo(m.id)}">삭제</button>
      </div>
    </article>
  `).join("");
}

async function setMemoRead(id, isRead) {
  await apiJson(`/api/admin/memos/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isRead })
  }).catch(() => null);
  loadMemos();
}

async function deleteMemo(id) {
  if (!window.confirm("이 메모를 삭제할까요? 되돌릴 수 없습니다.")) return;
  await apiJson(`/api/admin/memos/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
  loadMemos();
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
duplicateProjectButton.addEventListener("click", duplicateProject);
deleteProjectButton.addEventListener("click", deleteProject);
projectForm.addEventListener("submit", saveProject);
imageUploadForm.addEventListener("submit", event => uploadAsset(event, "images"));
fileUploadForm.addEventListener("submit", event => uploadAsset(event, "files"));
imageList.addEventListener("click", event => {
  const button = event.target.closest("[data-delete-asset]");
  if (!button) return;
  deleteAsset(button.dataset.deleteAsset, button.dataset.assetId);
});
fileList.addEventListener("click", event => {
  const button = event.target.closest("[data-delete-asset]");
  if (!button) return;
  deleteAsset(button.dataset.deleteAsset, button.dataset.assetId);
});
fileList.addEventListener("change", event => {
  const select = event.target.closest("[data-asset-visibility]");
  if (!select) return;
  updateAssetVisibility(select.dataset.assetVisibility, select.dataset.assetId, select.value);
});
authForm.addEventListener("submit", submitAuth);
logoutButton.addEventListener("click", logout);
passwordForm.addEventListener("submit", savePassword);
$$(".admin-tab").forEach(button => {
  button.addEventListener("click", () => switchTab(button.dataset.adminTab));
});
$("#reloadMemos")?.addEventListener("click", () => loadMemos());
$("#memoList")?.addEventListener("click", event => {
  const readBtn = event.target.closest("[data-memo-read]");
  if (readBtn) {
    setMemoRead(readBtn.dataset.memoRead, readBtn.dataset.read !== "1");
    return;
  }
  const delBtn = event.target.closest("[data-memo-delete]");
  if (delBtn) deleteMemo(delBtn.dataset.memoDelete);
});

loadSecurityStatus().catch(error => {
  showAuthPanel(error.message);
});
