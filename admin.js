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
const projectSort = $("#projectSort");
const projectForm = $("#projectForm");
const imageUploadForm = $("#imageUploadForm");
const fileUploadForm = $("#fileUploadForm");
const imageList = $("#imageList");
const fileList = $("#fileList");
const saveStatus = $("#saveStatus");
const duplicateProjectButton = $("#duplicateProject");
const deleteProjectButton = $("#deleteProject");
const updateProjectButton = $("#updateProject");
const openImageManagerButton = $("#openImageManager");
const imageManagerModal = $("#imageManagerModal");
const imageManagerStatus = $("#imageManagerStatus");
const imageManagerSummary = $("#imageManagerSummary");
const essayImageInput = $("#essayImageInput");
const essayPreviewModal = $("#essayPreviewModal");
const securityStatusList = $("#securityStatusList");
const passwordForm = $("#passwordForm");
const newPassword = $("#newPassword");
const confirmPassword = $("#confirmPassword");
const passwordStatus = $("#passwordStatus");
const siteSettingsForm = $("#siteSettingsForm");
const siteSettingsStatus = $("#siteSettingsStatus");
const analyticsSummary = $("#analyticsSummary");
const analyticsContentList = $("#analyticsContentList");
const analyticsDailyList = $("#analyticsDailyList");
const analyticsUpdatedAt = $("#analyticsUpdatedAt");
const dashboardSummary = $("#dashboardSummary");
const dashboardLatestMemo = $("#dashboardLatestMemo");
const dashboardLatestComment = $("#dashboardLatestComment");
const dashboardTopPosts = $("#dashboardTopPosts");
const dashboardUpdatedAt = $("#dashboardUpdatedAt");
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
  if (!target) return;
  target.textContent = message;
  window.clearTimeout(target._timer);
  target._timer = window.setTimeout(() => {
    target.textContent = "";
  }, 3600);
}

function projectLabel(project) {
  return [project.metric, project.period].filter(Boolean).join(" · ");
}

function compactText(value, fallback = "-") {
  const text = Array.isArray(value) ? value.join(", ") : String(value || "");
  return text.trim() || fallback;
}

function adminDateValue(item) {
  return item?.updated_at || item?.updatedAt || item?.created_at || item?.createdAt || item?.publishedAt || item?.periodStart || item?.period || "";
}

function sortDateValue(value) {
  const raw = String(value || "");
  const ym = raw.match(/(\d{4})[-년.\s]*(\d{1,2})?/);
  if (ym) return Number(`${ym[1]}${String(ym[2] || "12").padStart(2, "0")}`);
  const time = Date.parse(raw);
  return Number.isNaN(time) ? 0 : time;
}

function sortTextValue(value) {
  return compactText(value, "").toLowerCase();
}

function projectDateLabel(project) {
  return project.period || project.periodStart || project.periodEnd || "-";
}

function projectPortfolioNo(project) {
  const fallback = Number(project?.sortOrder || 0) || (projects.findIndex(item => item.id === project?.id) + 1);
  return project?.portfolioNo || project?.portfolio_no || `p${String(Math.max(fallback, 1)).padStart(4, "0")}`;
}

function adminWrittenLabel(item) {
  const value = adminDateValue(item);
  return value ? String(value).slice(0, 16).replace("T", " ") : "-";
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
    await loadDashboard();
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
    switchTab("dashboard");
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
  const sortMode = projectSort?.value || "sortOrder";
  let filtered = projects.filter(project => {
    const haystack = [
      project.id,
      project.slug,
      project.title,
      project.metric,
      project.category,
      project.period,
      project.short,
      project.description,
      ...(project.tags || [])
    ].join(" ").toLowerCase();
    return !query || haystack.includes(query);
  });

  filtered = filtered.slice().sort((a, b) => {
    if (sortMode === "periodDesc") return sortDateValue(projectDateLabel(b)) - sortDateValue(projectDateLabel(a));
    if (sortMode === "periodAsc") return sortDateValue(projectDateLabel(a)) - sortDateValue(projectDateLabel(b));
    if (sortMode === "titleAsc") return sortTextValue(a.title || a.id).localeCompare(sortTextValue(b.title || b.id), "ko");
    if (sortMode === "tagsAsc") return sortTextValue(a.tags).localeCompare(sortTextValue(b.tags), "ko");
    if (sortMode === "updatedDesc") return sortDateValue(adminDateValue(b)) - sortDateValue(adminDateValue(a));
    return Number(a.sortOrder || 9999) - Number(b.sortOrder || 9999);
  });

  projectPanelTitle.textContent = query
    ? `Projects (${filtered.length}/${projects.length})`
    : `Projects (${projects.length})`;

  const header = `
    <div class="board-row board-head" aria-hidden="true">
      <span>No.</span>
      <span>게시일자</span>
      <span>제목</span>
      <span>태그</span>
      <span>작성 시간</span>
      <span>상태</span>
    </div>`;

  projectList.innerHTML = filtered.length ? header + filtered.map(project => `
    <button type="button" class="board-row project-item${selectedProject?.id === project.id ? " active" : ""}" data-project-id="${escapeHtml(project.id)}">
      <span class="board-cell board-no">${escapeHtml(projectPortfolioNo(project))}</span>
      <span class="board-cell board-date">${escapeHtml(projectDateLabel(project))}</span>
      <span class="board-cell board-title">
        <strong>${escapeHtml(project.title || project.id)}</strong>
        <small>${escapeHtml(project.metric || project.category || "")}</small>
      </span>
      <span class="board-cell board-tags">${escapeHtml(compactText(project.tags))}</span>
      <span class="board-cell board-written">${escapeHtml(adminWrittenLabel(project))}</span>
      <span class="board-cell board-status">${isDashboardFeatured(project) ? "Dashboard" : escapeHtml(project.status || "published")}</span>
    </button>
  `).join("") : `<div class="asset-empty">표시할 프로젝트가 없습니다.</div>`;
}

// "2022-03","2022-05" → "2022년 3월 ~ 5월". 같은 연도면 연도 한 번만. 시작만 있으면 "2022년 3월".
function buildPeriodDisplay(start, end, legacy = "") {
  const fmt = (ym) => {
    const m = String(ym || "").match(/(\d{4})-(\d{1,2})/);
    return m ? { y: m[1], mo: String(parseInt(m[2], 10)) } : null;
  };
  const s = fmt(start), e = fmt(end);
  if (!s && !e) return legacy; // 새 값 없으면 기존 표기 유지
  if (s && e) {
    if (s.y === e.y) {
      return s.mo === e.mo ? `${s.y}년 ${s.mo}월` : `${s.y}년 ${s.mo}월 ~ ${e.mo}월`;
    }
    return `${s.y}년 ${s.mo}월 ~ ${e.y}년 ${e.mo}월`;
  }
  const one = s || e;
  return `${one.y}년 ${one.mo}월`;
}

function fillForm(project) {
  selectedProject = project;
  projectForm.elements.id.value = project.id || "";
  projectForm.elements.slug.value = project.slug || project.id || "";
  if (projectForm.elements.portfolioNo) projectForm.elements.portfolioNo.value = projectPortfolioNo(project);
  projectForm.elements.title.value = project.title || "";
  projectForm.elements.metric.value = project.metric || "";
  projectForm.elements.category.value = project.category || "Plan";
  projectForm.elements.period.value = project.period || "";
  if (projectForm.elements.periodStart) projectForm.elements.periodStart.value = project.periodStart || "";
  if (projectForm.elements.periodEnd) projectForm.elements.periodEnd.value = project.periodEnd || "";
  if (projectForm.elements.workDuration) projectForm.elements.workDuration.value = project.workDuration || "";
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
    portfolioNo: form.portfolioNo ? form.portfolioNo.value.trim() : "",
    title: form.title.value.trim(),
    metric: form.metric.value.trim(),
    category: form.category.value,
    period: buildPeriodDisplay(
      form.periodStart ? form.periodStart.value : "",
      form.periodEnd ? form.periodEnd.value : "",
      form.period ? form.period.value.trim() : ""
    ),
    periodStart: form.periodStart ? form.periodStart.value : "",
    periodEnd: form.periodEnd ? form.periodEnd.value : "",
    workDuration: form.workDuration ? form.workDuration.value.trim() : "",
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

  if (imageManagerSummary) {
    imageManagerSummary.textContent = images.length
      ? `등록된 이미지 ${images.length}개. 이미지 관리 모달에서 썸네일 확인과 순서 변경을 할 수 있습니다.`
      : "등록된 이미지가 없습니다. 이미지 관리 모달에서 업로드하세요.";
  }

  imageList.innerHTML = images.length ? images.map(item => `
    <div class="asset-item asset-image-item" draggable="true" data-asset-id="${escapeHtml(item.id || "")}">
      <label class="asset-check">
        <input type="checkbox" class="img-select" data-asset-id="${escapeHtml(item.id || "")}">
      </label>
      <span class="asset-drag-handle" title="드래그하여 순서 변경" aria-hidden="true">⠿</span>
      <div class="asset-item-body">
        ${assetUrl(item) ? `<img class="asset-thumb" src="${escapeHtml(assetUrl(item))}" alt="${escapeHtml(item.alt || item.title || "Portfolio image")}" loading="lazy">` : ""}
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
    </div>
  `).join("") : `<div class="asset-empty">등록된 이미지가 없습니다.</div>`;

  // 이미지 다중선택/순서변경 툴바 + 드래그 활성화
  setupImageBulkTools(project);

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

// 이미지 다중선택(체크박스·전체선택·선택삭제) + 드래그앤드롭 순서변경
function setupImageBulkTools(project) {
  const bar = $("#imageBulkBar");
  const selectAll = $("#imgSelectAll");
  const countEl = $("#imgSelectCount");
  const deleteBtn = $("#imgDeleteSelected");
  if (!imageList) return;

  const checks = () => Array.from(imageList.querySelectorAll(".img-select"));
  const selectedIds = () => checks().filter(c => c.checked).map(c => c.dataset.assetId);

  function refresh() {
    const all = checks();
    const sel = all.filter(c => c.checked);
    if (bar) bar.hidden = all.length === 0;
    if (countEl) countEl.textContent = sel.length ? `${sel.length}개 선택됨` : "";
    if (selectAll) selectAll.checked = all.length > 0 && sel.length === all.length;
  }

  // 개별 체크
  imageList.querySelectorAll(".img-select").forEach(c => {
    c.addEventListener("change", refresh);
  });
  // 전체선택
  if (selectAll) {
    selectAll.onchange = () => {
      checks().forEach(c => { c.checked = selectAll.checked; });
      refresh();
    };
  }
  // 선택 삭제
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      const ids = selectedIds();
      if (!ids.length) return;
      if (!window.confirm(`선택한 이미지 ${ids.length}개를 삭제할까요? 되돌릴 수 없습니다.`)) return;
      deleteBtn.disabled = true;
      try {
        await apiJson(`/api/admin/projects/${encodeURIComponent(selectedProject.id)}/images/bulk-delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids })
        });
        setStatus(saveStatus, `${ids.length}개 이미지를 삭제했습니다.`);
        await loadProjects(selectedProject.id);
      } catch (error) {
        setStatus(saveStatus, "선택 삭제에 실패했습니다.");
      } finally {
        deleteBtn.disabled = false;
      }
    };
  }

  // ── 드래그앤드롭 순서변경 ──
  let dragEl = null;
  imageList.querySelectorAll(".asset-image-item").forEach(item => {
    item.addEventListener("dragstart", e => {
      dragEl = item;
      item.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      dragEl = null;
    });
    item.addEventListener("dragover", e => {
      e.preventDefault();
      const target = e.currentTarget;
      if (!dragEl || dragEl === target) return;
      const rect = target.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      imageList.insertBefore(dragEl, after ? target.nextSibling : target);
    });
  });
  imageList.ondrop = async e => {
    e.preventDefault();
    // 새 순서 수집 후 저장
    const order = Array.from(imageList.querySelectorAll(".asset-image-item"))
      .map(el => el.dataset.assetId).filter(Boolean);
    if (!order.length || !selectedProject) return;
    try {
      await apiJson(`/api/admin/projects/${encodeURIComponent(selectedProject.id)}/images/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order })
      });
      setStatus(saveStatus, "이미지 순서를 변경했습니다.");
    } catch (error) {
      setStatus(saveStatus, "순서 저장에 실패했습니다.");
      await loadProjects(selectedProject.id); // 실패 시 원복
    }
  };

  refresh();
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
    portfolioNo: `p${String(projects.length + 1).padStart(4, "0")}`,
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
    portfolioNo: `p${String(projects.length + 1).padStart(4, "0")}`,
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

async function saveProject(event, mode = "create") {
  if (event) event.preventDefault();
  const payload = readForm();
  if (!payload.id || !payload.title) {
    setStatus(saveStatus, "ID와 제목이 필요합니다.");
    return;
  }

  if (mode === "create") {
    const duplicated = projects.some(project => project.id === payload.id);
    if (duplicated) {
      setStatus(saveStatus, "이미 있는 프로젝트입니다. 기존 항목은 수정하기 버튼을 눌러주세요.");
      return;
    }
  }

  if (mode === "update" && !selectedProject?.id) {
    setStatus(saveStatus, "수정할 기존 프로젝트를 먼저 선택해주세요.");
    return;
  }

  const existing = mode === "update" ? selectedProject.id : "";
  const url = existing ? `/api/admin/projects/${encodeURIComponent(existing)}` : "/api/admin/projects";
  const method = existing ? "PUT" : "POST";
  const saved = await apiJson(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  setStatus(saveStatus, existing ? "수정되었습니다." : "새 프로젝트가 저장되었습니다.");
  await loadProjects(saved.id);
}

async function uploadAsset(event, type) {
  event.preventDefault();
  const statusTarget = type === "images" ? (imageManagerStatus || saveStatus) : saveStatus;
  if (!selectedProject?.id) {
    setStatus(statusTarget, "먼저 프로젝트를 선택하거나 저장해주세요.");
    return;
  }

  const form = event.currentTarget;
  const fileInput = form.elements.file;
  const files = Array.from(fileInput.files || []);
  if (!files.length) {
    setStatus(statusTarget, "업로드할 파일을 선택해주세요.");
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
      setStatus(statusTarget, `${index + 1}/${files.length} 업로드 중입니다.`);
      await apiJson(`/api/admin/projects/${encodeURIComponent(selectedProject.id)}/${endpoint}`, {
        method: "POST",
        body: data
      });
    }
    form.reset();
    setStatus(statusTarget, type === "images" ? `${files.length}개 이미지가 추가되었습니다.` : `${files.length}개 첨부파일이 추가되었습니다.`);
    await loadProjects(selectedProject.id);
  } catch (error) {
    setStatus(statusTarget, `업로드 실패: ${error.message}`);
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

function openImageManager() {
  if (!selectedProject?.id) {
    setStatus(saveStatus, "이미지를 관리하려면 먼저 프로젝트를 선택하거나 저장해주세요.");
    return;
  }
  imageManagerModal?.classList.remove("hidden");
  document.body.classList.add("modal-open");
  renderAssets(selectedProject);
}

function closeImageManager({ confirmed = false } = {}) {
  imageManagerModal?.classList.add("hidden");
  document.body.classList.remove("modal-open");
  if (confirmed) setStatus(saveStatus, "이미지 관리가 확정되었습니다. 필요한 경우 프로젝트를 수정하기로 저장하세요.");
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

function fillSiteSettings(settings) {
  if (!siteSettingsForm) return;
  const notice = settings?.notice || {};
  siteSettingsForm.elements.noticeEnabled.checked = notice.enabled !== false;
  siteSettingsForm.elements.noticeText.value = notice.text || "";
}

async function loadSiteSettings() {
  if (!siteSettingsForm) return;
  try {
    const settings = await apiJson("/api/admin/site-settings");
    fillSiteSettings(settings);
  } catch (error) {
    setStatus(siteSettingsStatus, error.message);
  }
}

async function saveSiteSettings(event) {
  event.preventDefault();
  if (!siteSettingsForm) return;
  const payload = {
    notice: {
      enabled: Boolean(siteSettingsForm.elements.noticeEnabled.checked),
      text: siteSettingsForm.elements.noticeText.value.trim()
    }
  };
  try {
    const settings = await apiJson("/api/admin/site-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    fillSiteSettings(settings);
    setStatus(siteSettingsStatus, "공지 설정이 저장되었습니다.");
  } catch (error) {
    setStatus(siteSettingsStatus, error.message);
  }
}

function switchTab(name) {
  $$(".admin-tab").forEach(button => {
    button.classList.toggle("active", button.dataset.adminTab === name);
  });
  $$(".admin-tab-panel").forEach(panel => {
    panel.classList.toggle("hidden", panel.id !== `${name}Panel`);
  });
  if (name === "dashboard") loadDashboard();
  if (name === "projects") loadProjects();
  if (name === "memos") loadMemos();
  if (name === "comments") {
    loadComments();
    loadBlockedIps();
  }
  if (name === "essays") loadEssays();
  if (name === "site") loadSiteSettings();
  if (name === "analytics") loadAnalytics();
}

function dashboardNumber(value) {
  return Number(value || 0).toLocaleString("ko-KR");
}

function dashboardDateLabel(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function sortRecentItems(items = []) {
  return items.slice().sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));
}

function renderDashboardSummary({ projectCount = 0, essayCount = 0, memoCount = 0, commentCount = 0, analytics = {} } = {}) {
  if (!dashboardSummary) return;
  const cards = [
    ["Projects", projectCount],
    ["Essays", essayCount],
    ["Memos", memoCount],
    ["Comments", commentCount],
    ["방문자", analytics?.summary?.totalVisits],
    ["조회 포스트", analytics?.summary?.contentViews]
  ];
  dashboardSummary.innerHTML = cards.map(([label, value]) => `
    <article class="dashboard-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${dashboardNumber(value)}</strong>
    </article>
  `).join("");
}

function renderDashboardLatest(target, item, type) {
  if (!target) return;
  if (!item) {
    target.innerHTML = `<p class="memo-admin-empty">아직 ${type === "memo" ? "메모" : "댓글"}이 없습니다.</p>`;
    return;
  }
  const title = type === "memo"
    ? item.title || "제목 없음"
    : `${item.writer || "익명"}${item.parent_id ? " · 답글" : ""}`;
  const meta = type === "memo"
    ? `${item.writer || "익명"} · ${dashboardDateLabel(item.created_at)}`
    : `${item.essay_id || "-"} · ${dashboardDateLabel(item.created_at)}`;
  target.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(meta)}</span>
    <p>${escapeHtml(item.body || "")}</p>
  `;
}

function renderDashboardTopPosts(items = []) {
  if (!dashboardTopPosts) return;
  const topItems = items.slice(0, 6);
  if (!topItems.length) {
    dashboardTopPosts.innerHTML = `<p class="memo-admin-empty">아직 포스트 조회 기록이 없습니다.</p>`;
    return;
  }
  dashboardTopPosts.innerHTML = topItems.map(item => `
    <article class="dashboard-post-row">
      <div>
        <strong>${escapeHtml(item.title || item.contentId || "-")}</strong>
        <span>${escapeHtml(analyticsTypeLabel(item.contentType))} · ${escapeHtml(item.contentId || "-")}</span>
      </div>
      <b>${dashboardNumber(item.views)}</b>
    </article>
  `).join("");
}

async function loadDashboard() {
  if (!dashboardSummary) return;
  dashboardSummary.innerHTML = `<p class="memo-admin-empty">대시보드를 불러오는 중…</p>`;
  if (dashboardLatestMemo) dashboardLatestMemo.innerHTML = "";
  if (dashboardLatestComment) dashboardLatestComment.innerHTML = "";
  if (dashboardTopPosts) dashboardTopPosts.innerHTML = "";

  const [projectResult, essayResult, memoResult, commentResult, analyticsResult] = await Promise.allSettled([
    apiJson("/api/admin/projects"),
    apiJson("/api/essays"),
    apiJson("/api/admin/memos"),
    apiJson("/api/admin/comments"),
    apiJson("/api/admin/analytics")
  ]);

  const projectItems = projectResult.status === "fulfilled" && Array.isArray(projectResult.value) ? projectResult.value : [];
  const essayItems = essayResult.status === "fulfilled" && Array.isArray(essayResult.value) ? essayResult.value : [];
  const memoItems = memoResult.status === "fulfilled" && Array.isArray(memoResult.value) ? memoResult.value : [];
  const commentItems = commentResult.status === "fulfilled" && Array.isArray(commentResult.value) ? commentResult.value : [];
  const analytics = analyticsResult.status === "fulfilled" ? analyticsResult.value : {};

  if (projectItems.length) projects = projectItems;

  renderDashboardSummary({
    projectCount: projectItems.length,
    essayCount: essayItems.length,
    memoCount: memoItems.length,
    commentCount: commentItems.length,
    analytics
  });
  renderDashboardLatest(dashboardLatestMemo, sortRecentItems(memoItems)[0], "memo");
  renderDashboardLatest(dashboardLatestComment, sortRecentItems(commentItems)[0], "comment");
  renderDashboardTopPosts(Array.isArray(analytics?.content) ? analytics.content : []);
  if (dashboardUpdatedAt) dashboardUpdatedAt.textContent = `(${new Date().toLocaleString("ko-KR")})`;
}

function analyticsNumber(value) {
  return Number(value || 0).toLocaleString("ko-KR");
}

function analyticsTypeLabel(value) {
  if (value === "project") return "Portfolio";
  if (value === "essay") return "Essay";
  return value || "Content";
}

function renderAnalyticsSummary(summary = {}) {
  if (!analyticsSummary) return;
  const cards = [
    ["총 방문", summary.totalVisits],
    ["오늘 방문", summary.todayVisits],
    ["최근 7일", summary.last7Visits],
    ["고유 방문자", summary.uniqueVisitors],
    ["콘텐츠 조회", summary.contentViews]
  ];
  analyticsSummary.innerHTML = cards.map(([label, value]) => `
    <article class="analytics-card">
      <span>${escapeHtml(label)}</span>
      <strong>${analyticsNumber(value)}</strong>
    </article>
  `).join("");
}

function renderAnalyticsContent(items = []) {
  if (!analyticsContentList) return;
  if (!items.length) {
    analyticsContentList.innerHTML = `<p class="memo-admin-empty">아직 콘텐츠 조회 기록이 없습니다.</p>`;
    return;
  }
  analyticsContentList.innerHTML = items.map(item => `
    <article class="analytics-row">
      <div>
        <strong>${escapeHtml(item.title || item.contentId || "-")}</strong>
        <span>${escapeHtml(analyticsTypeLabel(item.contentType))} · ${escapeHtml(item.contentId || "-")}</span>
      </div>
      <b>${analyticsNumber(item.views)}</b>
    </article>
  `).join("");
}

function renderAnalyticsDaily(items = []) {
  if (!analyticsDailyList) return;
  if (!items.length) {
    analyticsDailyList.innerHTML = `<p class="memo-admin-empty">아직 방문 기록이 없습니다.</p>`;
    return;
  }
  analyticsDailyList.innerHTML = items.slice().reverse().map(item => `
    <article class="analytics-row">
      <div>
        <strong>${escapeHtml(item.date || "-")}</strong>
        <span>고유 ${analyticsNumber(item.uniqueVisitors)}명</span>
      </div>
      <b>${analyticsNumber(item.visits)}</b>
    </article>
  `).join("");
}

async function loadAnalytics() {
  if (!analyticsSummary || !analyticsContentList || !analyticsDailyList) return;
  analyticsSummary.innerHTML = `<p class="memo-admin-empty">분석 데이터를 불러오는 중…</p>`;
  analyticsContentList.innerHTML = "";
  analyticsDailyList.innerHTML = "";
  try {
    const data = await apiJson("/api/admin/analytics");
    renderAnalyticsSummary(data.summary || {});
    renderAnalyticsContent(data.content || []);
    renderAnalyticsDaily(data.daily || []);
    if (analyticsUpdatedAt) analyticsUpdatedAt.textContent = `(${new Date().toLocaleString("ko-KR")})`;
  } catch (error) {
    analyticsSummary.innerHTML = `<p class="memo-admin-empty">분석 데이터를 불러오지 못했습니다.</p>`;
  }
}

// ===== 에세이 관리 (관리자 전용) =====
const ESSAY_CATEGORY_LABELS = {
  news: "News",
  publicBusiness: "公과 Business",
  worldOutside: "세계 : The outside world",
  others: "好不好 , Like & Others",
  thinkingEmotion: "私와 思"
};
let essayCache = [];

async function loadEssays() {
  const list = $("#essayList");
  if (!list) return;
  list.innerHTML = `<p class="memo-admin-empty">불러오는 중…</p>`;
  const essays = await apiJson("/api/essays").catch(() => null);
  if (!Array.isArray(essays)) {
    list.innerHTML = `<p class="memo-admin-empty">에세이를 불러오지 못했습니다.</p>`;
    return;
  }
  essayCache = essays;
  renderEssayAdminList();
}

function renderEssayAdminList() {
  const list = $("#essayList");
  if (!list) return;
  const currentId = $("#essayForm")?.elements.id.value || "";
  const cat = $("#essayFilterCategory")?.value || "";
  const q = ($("#essaySearch")?.value || "").trim().toLowerCase();
  const sortMode = $("#essaySort")?.value || "publishedDesc";
  let items = essayCache.slice();
  if (cat) items = items.filter(e => e.category === cat);
  if (q) items = items.filter(e =>
    [
      e.title,
      e.summary,
      e.category,
      e.publishedAt,
      ...(e.tags || [])
    ].join(" ").toLowerCase().includes(q)
  );
  items = items.slice().sort((a, b) => {
    if (sortMode === "publishedAsc") return sortDateValue(a.publishedAt) - sortDateValue(b.publishedAt);
    if (sortMode === "titleAsc") return sortTextValue(a.title || a.id).localeCompare(sortTextValue(b.title || b.id), "ko");
    if (sortMode === "tagsAsc") return sortTextValue(a.tags).localeCompare(sortTextValue(b.tags), "ko");
    if (sortMode === "updatedDesc") return sortDateValue(adminDateValue(b)) - sortDateValue(adminDateValue(a));
    return sortDateValue(b.publishedAt) - sortDateValue(a.publishedAt);
  });
  if (!items.length) {
    list.innerHTML = `<p class="memo-admin-empty">에세이가 없습니다.</p>`;
    return;
  }
  const header = `
    <div class="board-row board-head" aria-hidden="true">
      <span>게시일자</span>
      <span>제목</span>
      <span>태그</span>
      <span>작성 시간</span>
      <span>상태</span>
    </div>`;

  list.innerHTML = header + items.map(e => {
    const hasBody = e.body && e.body.trim().length > 0;
    return `
      <button type="button" class="board-row project-item${currentId === e.id ? " active" : ""}" data-essay-id="${escapeMemo(e.id)}">
        <span class="board-cell board-date">${escapeMemo(e.publishedAt || "-")}</span>
        <span class="board-cell board-title">
          <strong>${escapeMemo(e.title || e.id)}</strong>
          <small>${escapeMemo(ESSAY_CATEGORY_LABELS[e.category] || e.category || "-")} · ${hasBody ? "본문 있음" : "링크만"}</small>
        </span>
        <span class="board-cell board-tags">${escapeMemo(compactText(e.tags))}</span>
        <span class="board-cell board-written">${escapeMemo(adminWrittenLabel(e))}</span>
        <span class="board-cell board-status">${escapeMemo(e.status || "published")}</span>
      </button>`;
  }).join("");
}

function fillEssayForm(essay) {
  const form = $("#essayForm");
  if (!form) return;
  form.elements.id.value = essay?.id || "";
  form.elements.sourceUrl.value = essay?.sourceUrl || "";
  form.elements.title.value = essay?.title || "";
  form.elements.category.value = essay?.category || "news";
  form.elements.label.value = essay?.label || "";
  form.elements.status.value = essay?.status || "published";
  if (form.elements.publishedAt) form.elements.publishedAt.value = essay?.publishedAt || "";
  if (form.elements.coverImage) form.elements.coverImage.value = essay?.coverImage || "";
  form.elements.summary.value = essay?.summary || "";
  // 본문: HTML이면 그대로, 평문이면 줄바꿈을 <p>로 변환해 에디터에 표시
  const editor = $("#essayEditor");
  const body = essay?.body || "";
  if (editor) {
    const looksHtml = /<(p|h2|h3|strong|em|b|i|u|blockquote|ul|ol|li|hr|img|br)\b/i.test(body);
    editor.innerHTML = looksHtml
      ? body
      : body.split(/\n{2,}/).map(p => p.trim() ? `<p>${p.replace(/\n/g, "<br>")}</p>` : "").join("");
  }
  form.elements.body.value = body;
  form.elements.tags.value = Array.isArray(essay?.tags) ? essay.tags.join(", ") : "";
  updateBodyCharCount();
  if (essayCache.length) renderEssayAdminList();
}

function collectEssayForm() {
  const form = $("#essayForm");
  // 에디터 HTML을 hidden body에 동기화
  const editor = $("#essayEditor");
  if (editor) form.elements.body.value = syncEditorBody();
  const tags = (form.elements.tags.value || "")
    .split(",").map(t => t.trim()).filter(Boolean);
  return {
    id: form.elements.id.value || "",
    sourceUrl: form.elements.sourceUrl.value.trim(),
    title: form.elements.title.value.trim(),
    category: form.elements.category.value,
    label: form.elements.label.value.trim() || ESSAY_CATEGORY_LABELS[form.elements.category.value] || "",
    status: form.elements.status.value,
    publishedAt: form.elements.publishedAt ? form.elements.publishedAt.value.trim() : "",
    coverImage: form.elements.coverImage ? form.elements.coverImage.value.trim() : "",
    summary: form.elements.summary.value.trim(),
    body: form.elements.body.value,
    tags
  };
}

// 에디터 내용을 정리해서 반환(빈 에디터면 빈 문자열)
function syncEditorBody() {
  const editor = $("#essayEditor");
  if (!editor) return "";
  const html = editor.innerHTML.trim();
  // 빈 상태(브라우저가 넣는 <br>, 빈 p 등) 정리
  if (!editor.textContent.trim() && !/<(img|hr)/i.test(html)) return "";
  return html;
}

function insertHtmlAtCursor(html) {
  const editor = $("#essayEditor");
  if (!editor) return;
  editor.focus();
  document.execCommand("insertHTML", false, html);
  updateBodyCharCount();
}

function insertEssayImage(src, alt = "") {
  if (!src) return;
  insertHtmlAtCursor(`<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"><figcaption></figcaption></figure><p><br></p>`);
}

function readImageFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

async function insertEssayImageFiles(files) {
  const imageFiles = Array.from(files || []).filter(file => /^image\//i.test(file.type));
  for (const file of imageFiles) {
    const dataUrl = await readImageFileAsDataUrl(file);
    insertEssayImage(dataUrl, file.name || "essay image");
  }
}

function updateBodyCharCount() {
  const el = $("#bodyCharCount");
  const editor = $("#essayEditor");
  const len = editor ? editor.textContent.length : 0;
  if (el) el.textContent = len ? `${len.toLocaleString()}자` : "";
}

async function fetchEssayMeta(source = "") {
  const url = $("#essayForm").elements.sourceUrl.value.trim();
  const status = $("#metaStatus");
  if (!/^https?:\/\//i.test(url)) {
    if (status) status.textContent = "올바른 링크를 입력해 주세요.";
    return;
  }
  const srcLabel = source === "brunch" ? "브런치" : source === "naver" ? "네이버" : "";
  if (status) status.textContent = `${srcLabel} 링크에서 가져오는 중…`;
  const meta = await apiJson("/api/admin/essays/fetch-meta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, source })
  }).catch(() => null);
  if (!meta || (!meta.title && !meta.summary)) {
    if (status) status.textContent = "자동 추출이 안 됐습니다. 제목·요약을 직접 입력해 주세요.";
    return;
  }
  const form = $("#essayForm");
  if (meta.title && !form.elements.title.value) form.elements.title.value = meta.title;
  if (meta.summary && !form.elements.summary.value) form.elements.summary.value = meta.summary;
  if (meta.publishedAt && form.elements.publishedAt && !form.elements.publishedAt.value) {
    // ISO 날짜를 보기 좋게 변환 (2020-05-04T00:05:37+09:00 → 2020-05-04)
    form.elements.publishedAt.value = String(meta.publishedAt).slice(0, 10);
  }
  if (meta.coverImage && form.elements.coverImage && !form.elements.coverImage.value) {
    form.elements.coverImage.value = meta.coverImage;
  }
  if (status) status.textContent = "가져왔습니다. 본문은 직접 붙여넣어 주세요.";
}

function cleanEssayBody() {
  const editor = $("#essayEditor");
  if (!editor) return;
  const text = editor.textContent
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  editor.innerHTML = text.split(/\n{2,}/)
    .map(p => p.trim() ? `<p>${p.replace(/\n/g, "<br>")}</p>` : "")
    .join("");
  updateBodyCharCount();
}

function stripEditorWeight(root) {
  root.querySelectorAll("*").forEach(node => {
    node.style.fontFamily = "";
    node.style.fontWeight = "";
    node.style.color = "";
    node.removeAttribute("class");
  });
}

// 서식 에디터 툴바 명령 처리
function runEditorCommand(cmd) {
  const editor = $("#essayEditor");
  if (!editor) return;
  editor.focus();
  switch (cmd) {
    case "p": document.execCommand("formatBlock", false, "P"); break;
    case "bold": document.execCommand("bold"); break;
    case "italic": document.execCommand("italic"); break;
    case "underline": document.execCommand("underline"); break;
    case "h2": document.execCommand("formatBlock", false, "H2"); break;
    case "h3": document.execCommand("formatBlock", false, "H3"); break;
    case "quote": document.execCommand("formatBlock", false, "BLOCKQUOTE"); break;
    case "ul": document.execCommand("insertUnorderedList"); break;
    case "ol": document.execCommand("insertOrderedList"); break;
    case "link": {
      const url = window.prompt("연결할 URL을 입력하세요:");
      if (url && /^https?:\/\//i.test(url)) document.execCommand("createLink", false, url);
      break;
    }
    case "hr": document.execCommand("insertHorizontalRule"); break;
    case "clear":
      document.execCommand("removeFormat");
      document.execCommand("formatBlock", false, "P");
      break;
    case "image": {
      essayImageInput?.click();
      break;
    }
  }
  updateBodyCharCount();
}

function renderEssayPreview() {
  const data = collectEssayForm();
  $("#essayPreviewCategory").textContent = ESSAY_CATEGORY_LABELS[data.category] || data.category || "Essay";
  $("#essayPreviewTitle").textContent = data.title || "제목 없음";
  $("#essayPreviewMeta").textContent = `Uploaded · ${data.publishedAt || "날짜 미정"}${data.tags.length ? ` · #${data.tags.join(" #")}` : ""}`;
  const body = data.body || `<p class="memo-admin-empty">본문이 없습니다.</p>`;
  $("#essayPreviewBody").innerHTML = body;
  essayPreviewModal?.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeEssayPreview() {
  essayPreviewModal?.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

async function saveEssay(event, mode = "create") {
  if (event) event.preventDefault();
  const data = collectEssayForm();
  if (!data.title) {
    $("#essaySaveStatus").textContent = "제목을 입력해 주세요.";
    return;
  }
  if (mode === "create" && data.id && essayCache.some(essay => essay.id === data.id)) {
    $("#essaySaveStatus").textContent = "이미 있는 에세이입니다. 기존 글은 수정하기 버튼을 눌러주세요.";
    return;
  }
  if (mode === "update" && !data.id) {
    $("#essaySaveStatus").textContent = "수정할 기존 에세이를 먼저 선택해주세요.";
    return;
  }
  $("#essaySaveStatus").textContent = "저장 중…";
  const saved = await apiJson("/api/admin/essays", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  }).catch(() => null);
  if (saved) {
    $("#essaySaveStatus").textContent = mode === "update" ? "수정되었습니다." : "새 에세이가 저장되었습니다.";
    loadEssays();
  } else {
    $("#essaySaveStatus").textContent = "저장에 실패했습니다.";
  }
}

async function deleteEssayCurrent() {
  const id = $("#essayForm").elements.id.value;
  if (!id) { $("#essaySaveStatus").textContent = "저장된 에세이만 삭제할 수 있습니다."; return; }
  if (!window.confirm("이 에세이를 삭제할까요?")) return;
  await apiJson(`/api/admin/essays/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
  fillEssayForm(null);
  loadEssays();
}

async function bulkRegisterEssays() {
  const urls = ($("#bulkUrls")?.value || "")
    .split("\n").map(u => u.trim()).filter(u => /^https?:\/\//i.test(u));
  const category = $("#bulkCategory")?.value || "news";
  const status = $("#bulkStatus");
  if (!urls.length) { if (status) status.textContent = "링크를 한 개 이상 입력해 주세요."; return; }
  if (status) status.textContent = `${urls.length}개 처리 중… (시간이 걸릴 수 있습니다)`;
  const result = await apiJson("/api/admin/essays/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls, category })
  }).catch(() => null);
  if (result) {
    if (status) status.textContent = `${result.count}개 등록 완료.`;
    $("#bulkUrls").value = "";
    loadEssays();
  } else {
    if (status) status.textContent = "일괄 등록에 실패했습니다.";
  }
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

// ===== 에세이 댓글 관리 (관리자 전용) =====
async function loadComments() {
  const list = $("#commentList");
  const countEl = $("#commentCount");
  if (!list) return;
  list.innerHTML = `<p class="memo-admin-empty">댓글을 불러오는 중…</p>`;
  const comments = await apiJson("/api/admin/comments").catch(() => null);
  if (!Array.isArray(comments)) {
    list.innerHTML = `<p class="memo-admin-empty">댓글을 불러오지 못했습니다.</p>`;
    return;
  }
  if (countEl) countEl.textContent = comments.length ? `(${comments.length})` : "";
  if (!comments.length) {
    list.innerHTML = `<p class="memo-admin-empty">등록된 댓글이 없습니다.</p>`;
    return;
  }
  list.innerHTML = comments.map(comment => {
    const isReply = Boolean(comment.parent_id);
    const blocked = Boolean(comment.is_blocked);
    return `
      <article class="memo-admin-item comment-admin-item ${blocked ? "is-read" : "is-unread"}" data-comment-id="${escapeMemo(comment.id)}">
        <div class="memo-admin-head">
          <strong>${escapeMemo(comment.writer || "익명")}${isReply ? " · 답글" : ""}</strong>
          <span class="memo-admin-meta">${escapeMemo(comment.essay_id || "-")} · ${escapeMemo(formatMemoDate(comment.created_at))}</span>
        </div>
        <p class="memo-admin-body">${escapeMemo(comment.body || "")}</p>
        <div class="comment-admin-meta">
          <span>IP ${escapeMemo(comment.source_ip || "-")}</span>
          ${blocked ? "<span>차단됨</span>" : ""}
        </div>
        <div class="memo-admin-actions">
          <button type="button" class="danger" data-comment-delete="${escapeMemo(comment.id)}">삭제</button>
          ${comment.source_ip ? `<button type="button" class="ghost" data-comment-block="${escapeMemo(comment.id)}">IP 차단</button>` : ""}
        </div>
      </article>
    `;
  }).join("");
}

async function deleteComment(id) {
  if (!window.confirm("이 댓글을 삭제할까요? 답글이 있으면 함께 삭제될 수 있습니다.")) return;
  await apiJson(`/api/admin/comments/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
  await loadComments();
}

async function blockCommentIp(commentId) {
  if (!window.confirm("이 댓글 작성자의 IP를 차단하고 기존 댓글을 숨길까요?")) return;
  await apiJson("/api/admin/block-ip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commentId })
  }).catch(() => null);
  await loadComments();
  await loadBlockedIps();
}

async function loadBlockedIps() {
  const list = $("#blockedIpList");
  if (!list) return;
  list.innerHTML = `<p class="memo-admin-empty">차단 IP를 불러오는 중…</p>`;
  const ips = await apiJson("/api/admin/blocked-ips").catch(() => null);
  if (!Array.isArray(ips)) {
    list.innerHTML = `<p class="memo-admin-empty">차단 IP를 불러오지 못했습니다.</p>`;
    return;
  }
  if (!ips.length) {
    list.innerHTML = `<p class="memo-admin-empty">차단된 IP가 없습니다.</p>`;
    return;
  }
  list.innerHTML = ips.map(item => `
    <article class="memo-admin-item blocked-ip-item">
      <div class="memo-admin-head">
        <strong>${escapeMemo(item.ip || "-")}</strong>
        <span class="memo-admin-meta">${escapeMemo(formatMemoDate(item.created_at))}</span>
      </div>
      ${item.reason ? `<p class="memo-admin-body">${escapeMemo(item.reason)}</p>` : ""}
      <div class="memo-admin-actions">
        <button type="button" class="ghost" data-ip-unblock="${escapeMemo(item.ip || "")}">차단 해제</button>
      </div>
    </article>
  `).join("");
}

async function unblockIp(ip) {
  if (!ip || !window.confirm(`${ip} 차단을 해제할까요?`)) return;
  await apiJson(`/api/admin/block-ip/${encodeURIComponent(ip)}`, { method: "DELETE" }).catch(() => null);
  await loadBlockedIps();
  await loadComments();
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
projectSort?.addEventListener("change", renderProjectList);
$("#reloadProjects").addEventListener("click", () => loadProjects());
$("#newProject").addEventListener("click", newProject);
duplicateProjectButton.addEventListener("click", duplicateProject);
deleteProjectButton.addEventListener("click", deleteProject);
updateProjectButton?.addEventListener("click", event => saveProject(event, "update"));
projectForm.addEventListener("submit", event => saveProject(event, "create"));
openImageManagerButton?.addEventListener("click", openImageManager);
$("#confirmImageManager")?.addEventListener("click", () => closeImageManager({ confirmed: true }));
$$("[data-close-image-manager]").forEach(button => {
  button.addEventListener("click", () => closeImageManager());
});
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
siteSettingsForm?.addEventListener("submit", saveSiteSettings);
$$(".admin-tab").forEach(button => {
  button.addEventListener("click", () => switchTab(button.dataset.adminTab));
});
$("#reloadDashboard")?.addEventListener("click", () => loadDashboard());
$$(".dashboard-jump").forEach(button => {
  button.addEventListener("click", () => switchTab(button.dataset.jumpTab));
});
$("#reloadMemos")?.addEventListener("click", () => loadMemos());
$("#reloadComments")?.addEventListener("click", () => loadComments());
$("#reloadBlockedIps")?.addEventListener("click", () => loadBlockedIps());
$("#reloadAnalytics")?.addEventListener("click", () => loadAnalytics());

// 에세이 이벤트 연결
$("#reloadEssays")?.addEventListener("click", () => loadEssays());
$("#essayFilterCategory")?.addEventListener("change", renderEssayAdminList);
$("#essaySearch")?.addEventListener("input", renderEssayAdminList);
$("#essaySort")?.addEventListener("change", renderEssayAdminList);
$("#newEssay")?.addEventListener("click", () => { fillEssayForm(null); $("#essaySaveStatus").textContent = ""; });
$("#fetchMetaNaver")?.addEventListener("click", () => fetchEssayMeta("naver"));
$("#fetchMetaBrunch")?.addEventListener("click", () => fetchEssayMeta("brunch"));
$("#cleanBodyBtn")?.addEventListener("click", cleanEssayBody);
$("#essayBody")?.addEventListener("input", updateBodyCharCount);
$("#essayEditor")?.addEventListener("input", updateBodyCharCount);

// 붙여넣기: 네이버/브런치의 복잡한 서식 HTML을 깨끗하게 정리해서 삽입
$("#essayEditor")?.addEventListener("paste", event => {
  event.preventDefault();
  const clipboard = event.clipboardData || window.clipboardData;
  const clipboardFiles = Array.from(clipboard.files || []);
  const itemFiles = Array.from(clipboard.items || [])
    .map(item => item.kind === "file" ? item.getAsFile() : null)
    .filter(Boolean);
  const imageFiles = [...clipboardFiles, ...itemFiles]
    .filter(file => file && /^image\//i.test(file.type));
  const htmlData = clipboard.getData("text/html");
  const textData = clipboard.getData("text/plain");

  if (imageFiles.length && !htmlData) {
    insertEssayImageFiles(imageFiles);
    return;
  }

  let cleanHtml;
  if (htmlData) {
    cleanHtml = cleanPastedHtml(htmlData);
  } else {
    // HTML이 없으면 평문을 문단으로
    cleanHtml = (textData || "")
      .split(/\n{2,}/)
      .map(p => p.trim() ? `<p>${escapeAdminHtml(p).replace(/\n/g, "<br>")}</p>` : "")
      .join("");
  }
  document.execCommand("insertHTML", false, cleanHtml);
  if (imageFiles.length) insertEssayImageFiles(imageFiles);
  updateBodyCharCount();
});

function escapeAdminHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 붙여넣은 HTML에서 의미있는 구조(문단·제목·굵게·기울임·인용·리스트·이미지)만 남기고
// class/style/span 등 플랫폼 전용 서식 코드를 전부 제거한다.
function cleanPastedHtml(html) {
  const allowed = new Set(["P","BR","H2","H3","STRONG","B","EM","I","U","BLOCKQUOTE","UL","OL","LI","HR","IMG","A","FIGURE","FIGCAPTION"]);
  const tmp = document.createElement("div");
  tmp.innerHTML = html;

  const walk = (node) => {
    Array.from(node.childNodes).forEach(child => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
        const tag = child.tagName;
        if (!allowed.has(tag)) {
          // 허용 안 된 태그(span, div 등)는 내용물만 남기고 태그 제거
          while (child.firstChild) child.parentNode.insertBefore(child.firstChild, child);
          child.remove();
          return;
        }
        // 허용 태그라도 class·style 등 속성은 전부 제거(필요한 것만 남김)
        const keep = tag === "A" ? ["href"] : tag === "IMG" ? ["src", "alt"] : [];
        Array.from(child.attributes).forEach(a => {
          if (!keep.includes(a.name.toLowerCase())) child.removeAttribute(a.name);
        });
        if (tag === "A") {
          const href = child.getAttribute("href") || "";
          if (!/^https?:\/\//i.test(href)) child.removeAttribute("href");
          child.setAttribute("target", "_blank");
          child.setAttribute("rel", "noopener");
        }
        if (tag === "IMG") {
          const src = child.getAttribute("src") || "";
          if (!/^(https?:|data:image\/)/i.test(src)) child.remove();
        }
      } else if (child.nodeType === Node.COMMENT_NODE) {
        child.remove();
      }
    });
  };
  walk(tmp);

  // 빈 태그 정리 + 네이버 특유의 줄단위 <p>를 합치기엔 과하니, 빈 p만 제거
  let out = tmp.innerHTML
    .replace(/<p>\s*<\/p>/gi, "")
    .replace(/(<br\s*\/?>\s*){3,}/gi, "<br><br>")
    .trim();
  return out || `<p>${escapeAdminHtml(tmp.textContent || "")}</p>`;
}
essayImageInput?.addEventListener("change", event => {
  insertEssayImageFiles(event.target.files || []);
  event.target.value = "";
});
$("#essayPreviewBtn")?.addEventListener("click", renderEssayPreview);
$$("[data-close-essay-preview]").forEach(button => {
  button.addEventListener("click", closeEssayPreview);
});
$("#essayToolbar")?.addEventListener("click", event => {
  const btn = event.target.closest("[data-cmd]");
  if (btn) { event.preventDefault(); runEditorCommand(btn.dataset.cmd); }
});
$("#essayForm")?.addEventListener("submit", event => saveEssay(event, "create"));
$("#updateEssay")?.addEventListener("click", event => saveEssay(event, "update"));
$("#deleteEssay")?.addEventListener("click", deleteEssayCurrent);
$("#bulkSubmitBtn")?.addEventListener("click", bulkRegisterEssays);
$("#essayList")?.addEventListener("click", event => {
  const btn = event.target.closest("[data-essay-id]");
  if (!btn) return;
  const essay = essayCache.find(e => e.id === btn.dataset.essayId);
  if (essay) { fillEssayForm(essay); window.scrollTo({ top: 0, behavior: "smooth" }); }
});
$("#memoList")?.addEventListener("click", event => {
  const readBtn = event.target.closest("[data-memo-read]");
  if (readBtn) {
    setMemoRead(readBtn.dataset.memoRead, readBtn.dataset.read !== "1");
    return;
  }
  const delBtn = event.target.closest("[data-memo-delete]");
  if (delBtn) deleteMemo(delBtn.dataset.memoDelete);
});

$("#commentList")?.addEventListener("click", event => {
  const deleteButton = event.target.closest("[data-comment-delete]");
  if (deleteButton) {
    deleteComment(deleteButton.dataset.commentDelete);
    return;
  }
  const blockButton = event.target.closest("[data-comment-block]");
  if (blockButton) blockCommentIp(blockButton.dataset.commentBlock);
});

$("#blockedIpList")?.addEventListener("click", event => {
  const unblockButton = event.target.closest("[data-ip-unblock]");
  if (unblockButton) unblockIp(unblockButton.dataset.ipUnblock);
});

loadSecurityStatus().catch(error => {
  showAuthPanel(error.message);
});
