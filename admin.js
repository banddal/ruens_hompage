const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

let projects = [];
let selectedProject = null;

const projectList = $("#projectList");
const projectSearch = $("#projectSearch");
const projectForm = $("#projectForm");
const imageUploadForm = $("#imageUploadForm");
const fileUploadForm = $("#fileUploadForm");
const imageList = $("#imageList");
const fileList = $("#fileList");
const saveStatus = $("#saveStatus");

function splitTags(value) {
  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function joinTags(value) {
  return Array.isArray(value) ? value.join(", ") : "";
}

function setStatus(message) {
  saveStatus.textContent = message;
  window.clearTimeout(setStatus.timer);
  setStatus.timer = window.setTimeout(() => {
    saveStatus.textContent = "";
  }, 3200);
}

function projectLabel(project) {
  return [project.metric, project.period].filter(Boolean).join(" · ");
}

async function apiJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
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
    <button type="button" class="project-item${selectedProject?.id === project.id ? " active" : ""}" data-project-id="${project.id}">
      <strong>${escapeHtml(project.title || project.id)}</strong>
      <small>${escapeHtml(projectLabel(project) || project.category || "")}</small>
    </button>
  `).join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
  projects = await apiJson("/api/projects");
  const next = projects.find(project => project.id === selectId) || projects[0] || null;
  if (next) {
    const detail = await apiJson(`/api/projects/${encodeURIComponent(next.slug || next.id)}`);
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
    setStatus("ID와 제목이 필요합니다.");
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
  setStatus("저장되었습니다.");
  await loadProjects(saved.id);
}

async function uploadAsset(event, type) {
  event.preventDefault();
  if (!selectedProject?.id) {
    setStatus("먼저 프로젝트를 선택하거나 저장해주세요.");
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
  setStatus(type === "images" ? "이미지가 추가되었습니다." : "첨부파일이 추가되었습니다.");
  await loadProjects(selectedProject.id);
}

projectList.addEventListener("click", async event => {
  const button = event.target.closest("[data-project-id]");
  if (!button) return;
  const project = projects.find(item => item.id === button.dataset.projectId);
  if (!project) return;
  const detail = await apiJson(`/api/projects/${encodeURIComponent(project.slug || project.id)}`);
  fillForm(detail);
});

projectSearch.addEventListener("input", renderProjectList);
$("#reloadProjects").addEventListener("click", () => loadProjects());
$("#newProject").addEventListener("click", newProject);
projectForm.addEventListener("submit", saveProject);
imageUploadForm.addEventListener("submit", event => uploadAsset(event, "images"));
fileUploadForm.addEventListener("submit", event => uploadAsset(event, "files"));

loadProjects().catch(error => {
  projectList.innerHTML = `<div class="asset-empty">API를 불러오지 못했습니다. server.js가 실행 중인지 확인하세요.<br>${escapeHtml(error.message)}</div>`;
});
