/* script block 1 from index.html */
(function(){
  var hero = document.querySelector('.portfolio-hero');
  if(!hero) return;
  function update(){
    var past = window.scrollY > (window.innerHeight * 0.6);
    document.body.classList.toggle('hero-passed', past);
  }
  window.addEventListener('scroll', update, {passive:true});
  window.addEventListener('resize', update);
  update();
})();

/* script block 2 from index.html */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
let activeProject = false;
let projectGalleryImages = [];
let projectGalleryIndex = 0;
let projectImageZoomed = false;
let projectImageZoomLevel = 1;

const TEAM_POSITION_LABELS = {
  director: "Directer",
  pm: "PM",
  member: "Member",
  independent: "Independent"
};
const SKILL_CHIP_LABELS = {
  plan: "P",
  strategy: "S",
  operation: "O",
  "communication-negotiation": "C&N"
};
// Vercel 통합 배포: 프론트와 API가 같은 도메인이므로 기본값은 상대경로("").
// 로컬에서 별도 백엔드를 붙일 때만 window.HOMO_RUENS_API_BASE 로 override.
const API_BASE = (() => {
  const configured = window.HOMO_RUENS_API_BASE || "";
  return configured.replace(/\/+$/, "");
})();
const backendProjectCache = new Map();
const DASHBOARD_RECENT_TAG = "__dashboard_recent";

let activeEssayId = null;
let activeReplyPath = null;
let essayComments = {};
const activeEssayTags = {
  publicBusiness: null,
  worldOutside: null,
  thinkingEmotion: null,
  others: null
};

function escapeHtml(v) {
  return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

// 네이버·플랫폼 기본 썸네일이면 카드 배경으로 쓰지 않음
function isGenericCoverImage(url) {
  const u = String(url || "").toLowerCase();
  if (!u) return true;
  return ["blogpfthumb","blog_profile","static.naver","ssl.pstatic.net/static",
    "img_share_default","default_image","noimage","no_image","/static/img/help"]
    .some(p => u.includes(p));
}

// 에세이 본문 HTML 새니타이저: 허용된 태그·속성만 통과시켜 XSS를 차단한다.
// 서식 에디터가 저장한 HTML을 안전하게 표시하기 위함.
function sanitizeEssayHtml(html) {
  const allowedTags = new Set([
    "P","BR","HR","STRONG","B","EM","I","U","S","DEL",
    "H2","H3","H4","BLOCKQUOTE","UL","OL","LI","A","IMG","FIGURE","FIGCAPTION","SPAN"
  ]);
  const template = document.createElement("template");
  template.innerHTML = String(html || "");

  const walk = (node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName;
        if (!allowedTags.has(tag)) {
          // 허용 안 된 태그는 제거하되, 내부 텍스트는 살림
          const text = document.createTextNode(child.textContent || "");
          child.replaceWith(text);
          continue;
        }
        // 속성 정리: 허용된 것만 남김
        const keepAttrs = tag === "A" ? ["href"]
          : tag === "IMG" ? ["src", "alt"]
          : [];
        Array.from(child.attributes).forEach(attr => {
          if (!keepAttrs.includes(attr.name.toLowerCase())) {
            child.removeAttribute(attr.name);
          }
        });
        // href/src에서 javascript: 등 위험 스킴 차단
        ["href", "src"].forEach(a => {
          const val = child.getAttribute(a);
          if (val && /^\s*(javascript|data|vbscript):/i.test(val)) child.removeAttribute(a);
        });
        if (tag === "A") {
          child.setAttribute("target", "_blank");
          child.setAttribute("rel", "noopener");
        }
        if (tag === "IMG") child.setAttribute("loading", "lazy");
        walk(child);
      } else if (child.nodeType !== Node.TEXT_NODE) {
        // 주석 등 기타 노드 제거
        child.remove();
      }
    }
  };
  walk(template.content);
  return template.innerHTML;
}

function looksLikeGeneratedAssetText(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return /\.(png|jpe?g|webp|avif|gif|pdf|pptx?|hwp|hwpx|docx?|xlsx?)$/i.test(text)
    || /^(다운로드|download|image|file|img|photo|사진|이미지)$/i.test(text)
    || /^(화면\s*캡[처쳐]|screenshot|screen\s*shot)/i.test(text)
    || /캡[처쳐]\s*\d{4}[-_.]\d{1,2}[-_.]\d{1,2}/i.test(text)
    || /^\d{4}[-_.]\d{1,2}[-_.]\d{1,2}[\s_-]?\d{4,6}$/i.test(text);
}

function cleanAssetText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return looksLikeGeneratedAssetText(text) ? "" : text;
}

function fileNameFromUrl(url, fallback = "portfolio-file") {
  try {
    const parsed = new URL(url, window.location.href);
    const name = decodeURIComponent(parsed.pathname.split("/").pop() || "").trim();
    return name && !/[\\/:*?"<>|]/.test(name) ? name : fallback;
  } catch (error) {
    return fallback;
  }
}

function normalizeAssetUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || raw.startsWith("data:") || raw.startsWith("blob:")) return raw;
  if (raw.startsWith("/")) return `${API_BASE}${raw}`;
  return raw;
}

function getAssetUrl(asset) {
  return normalizeAssetUrl(
    asset?.publicUrl ||
    asset?.public_url ||
    asset?.url ||
    asset?.src ||
    asset?.path ||
    asset?.storageUrl ||
    asset?.storage_url ||
    ""
  );
}

async function downloadInBrowser(url, filename = "portfolio-file") {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("download failed");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

async function loadSiteSettings() {
  const noticeLine = $("#siteNoticeLine");
  const noticeText = $("#siteNoticeText");
  if (!noticeLine || !noticeText) return;
  try {
    const response = await fetch(apiUrl("/api/site-settings"), { cache: "no-store" });
    if (!response.ok) throw new Error("site settings unavailable");
    const settings = await response.json();
    const notice = settings?.notice || {};
    const text = String(notice.text || "").trim();
    noticeLine.hidden = notice.enabled === false || !text;
    if (text) noticeText.textContent = text;
  } catch (error) {
    noticeLine.hidden = false;
  }
}

function cacheProject(project) {
  if (!project?.id) return project;
  backendProjectCache.set(project.id, project);
  if (project.slug) backendProjectCache.set(project.slug, project);
  return project;
}

function getStaticProject(projectId) {
  if (typeof PROJECTS === "undefined" || !Array.isArray(PROJECTS)) return null;
  return PROJECTS.find(item => item.id === projectId || item.slug === projectId) || null;
}

function getCachedProject(projectId) {
  return backendProjectCache.get(projectId) || getStaticProject(projectId);
}

function visibleProjectTags(tags) {
  return Array.isArray(tags) ? tags.filter(tag => tag && tag !== DASHBOARD_RECENT_TAG) : [];
}

function isDashboardFeaturedProject(project) {
  return Boolean(project?.dashboardFeatured || (project?.tags || []).includes(DASHBOARD_RECENT_TAG));
}

function dashboardNatureLabels(project) {
  const labels = [];
  if (project?.category) labels.push(project.category);
  (project?.skillTags || []).forEach(tag => {
    const label = SKILLSET_LABELS?.[tag] || SKILL_CHIP_LABELS[tag] || tag;
    if (label && !labels.includes(label)) labels.push(label);
  });
  visibleProjectTags(project?.tags).forEach(tag => {
    if (!labels.includes(tag)) labels.push(tag);
  });
  return labels.slice(0, 5);
}

// dashboard "최근 완료한 프로젝트": admin에서 dashboardFeatured로 체크한
// 프로젝트를 기간(period) 최신순으로 최대 3개까지 카드로 렌더한다.
const DASHBOARD_RECENT_MAX = 3;

function dashboardRecentSortKey(project) {
  // period가 "2026", "2024–2026", "2025.03" 등 다양하므로 마지막 연도를 추출해 정렬.
  const text = String(project?.period || "");
  const years = text.match(/\d{4}/g);
  if (years && years.length) return Number(years[years.length - 1]);
  // period가 없으면 updatedAt 보조 사용
  const ts = Date.parse(project?.updatedAt || project?.updated_at || 0);
  return Number.isNaN(ts) ? 0 : ts / 1e10; // 연도 스케일과 섞이지 않게 축소
}

function renderDashboardRecent(projects = []) {
  const container = $("#dashboardRecentList");
  if (!container) return;

  const list = Array.isArray(projects) && projects.length
    ? projects.map(project => cacheProject(project))
    : (typeof PROJECTS !== "undefined" ? PROJECTS : []);

  const featured = list
    .filter(isDashboardFeaturedProject)
    .filter(p => p && p.status !== "private")
    .sort((a, b) => dashboardRecentSortKey(b) - dashboardRecentSortKey(a))
    .slice(0, DASHBOARD_RECENT_MAX);

  if (!featured.length) {
    container.innerHTML =
      `<p class="recent-empty">아직 표시할 프로젝트가 없습니다. 관리자에서 "Dashboard 최근 완료"로 체크하면 여기에 나타납니다.</p>`;
    return;
  }

  container.innerHTML = featured.map(project => {
    const labels = dashboardNatureLabels(project);
    const labelHtml = labels.length
      ? labels.map(label => `<span class="recent-tag">${escapeHtml(label)}</span>`).join("")
      : `<span class="recent-tag muted">태그 미정</span>`;
    const target = escapeHtml(project.slug || project.id);
    return `
      <div class="recent-item">
        <h4>${escapeHtml(project.title || project.id || "프로젝트")}${
          project.metric ? ` <em>${escapeHtml(project.metric)}</em>` : ""
        }</h4>
        <p>${escapeHtml(truncateText(project.short || project.description || "프로젝트 개요가 아직 입력되지 않았습니다.", 120))}</p>
        <dl class="recent-meta">
          <div><dt>기간</dt><dd>${escapeHtml(project.period || "-")}</dd></div>
          <div><dt>성격</dt><dd>${labelHtml}</dd></div>
          <div><dt>결과</dt><dd>${escapeHtml(truncateText(project.outcome || "-", 80))}</dd></div>
        </dl>
        <button class="board-open js-open-project" type="button" data-project="${target}">포트폴리오 보기</button>
      </div>`;
  }).join("");

  // 새로 생성된 "포트폴리오 보기" 버튼에 모달 열기 연결
  container.querySelectorAll(".js-open-project").forEach(btn => {
    btn.addEventListener("click", () => openProjectModal(btn.dataset.project));
  });
}

function truncateText(value, max = 92) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function projectUploadedImages(project) {
  return Array.isArray(project?.images) ? project.images
    .filter(image => getAssetUrl(image))
    .map((image, imageIndex) => {
      const caption = cleanAssetText(image.caption);
      const description = cleanAssetText(image.description);
      const alt = cleanAssetText(image.alt);
      const src = getAssetUrl(image);
      return {
        kind: "image",
        type: "사진 설명",
        title: "",
        desc: caption || description || "",
        src,
        alt: alt || caption || project.title || `Project image ${imageIndex + 1}`
      };
    }) : [];
}

function syncProjectCards(project) {
  if (!project?.id) return;
  const cards = $$(".project-card.js-open-project")
    .filter(card => card.dataset.project === project.id || card.dataset.project === project.slug);
  if (!cards.length) return;

  const images = projectUploadedImages(project);
  const thumbnail = images[0]?.src || "";
  cards.forEach(card => {
    const front = $(".front", card);
    const hover = $(".hover", card);
    if (front) {
      const metric = $("strong", front);
      const title = $("b", front);
      const short = $("em", front);
      if (metric) metric.textContent = project.metric || project.category || "";
      if (title) title.textContent = project.title || "";
      if (short) short.textContent = truncateText(project.short || project.description || "", 56);
    }
    if (hover) {
      const title = $("b", hover);
      const desc = $("em", hover);
      if (title) title.textContent = project.title || "";
      if (desc) desc.textContent = truncateText(project.description || project.short || "", 112);
    }
    let thumb = $(".project-card-thumb", card);
    if (thumbnail) {
      if (!thumb) {
        thumb = document.createElement("span");
        thumb.className = "project-card-thumb";
        thumb.setAttribute("aria-hidden", "true");
        card.prepend(thumb);
      }
      thumb.style.backgroundImage = `url("${thumbnail.replaceAll('"', "%22")}")`;
      card.classList.add("has-project-thumb");
    } else {
      thumb?.remove();
      card.classList.remove("has-project-thumb");
    }
  });
}

function syncAllProjectCards() {
  $$(".project-card.js-open-project").forEach(card => {
    const project = getCachedProject(card.dataset.project);
    if (project) syncProjectCards(project);
  });
}

function normalizeEssayComment(comment) {
  return {
    id: comment?.id || "",
    writer: comment?.writer || "익명",
    body: comment?.body || "",
    createdAt: comment?.createdAt || comment?.created_at || "",
    replies: Array.isArray(comment?.replies) ? comment.replies.map(normalizeEssayComment) : []
  };
}

function setEssayCommentMessage(message, tone = "") {
  const list = $("#essayCommentList");
  if (!list) return;
  list.innerHTML = `<div class="essay-comment essay-comment-system ${tone ? `is-${tone}` : ""}"><span>${escapeHtml(message)}</span></div>`;
}

function formatEssayCommentDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function loadEssayCommentsFromApi(essayId) {
  if (!essayId) return;
  setEssayCommentMessage("댓글을 불러오는 중입니다.");
  try {
    const response = await fetch(apiUrl(`/api/essays/${encodeURIComponent(essayId)}/comments`), { cache: "no-store" });
    if (!response.ok) throw new Error("댓글을 불러오지 못했습니다.");
    const comments = await response.json();
    essayComments[essayId] = Array.isArray(comments) ? comments.map(normalizeEssayComment) : [];
    renderEssayComments();
  } catch (error) {
    console.warn("Essay comments failed:", error);
    essayComments[essayId] = [];
    setEssayCommentMessage("댓글을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", "error");
  }
}

async function postEssayComment({ writer, body, password, parentId = "", company = "" }) {
  if (!activeEssayId) return false;
  const response = await fetch(apiUrl(`/api/essays/${encodeURIComponent(activeEssayId)}/comments`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ writer, body, password, parentId, company })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "댓글을 등록하지 못했습니다.");
  await loadEssayCommentsFromApi(activeEssayId);
  return true;
}

async function deleteEssayComment(commentId, password) {
  const response = await fetch(apiUrl(`/api/essays/comments/${encodeURIComponent(commentId)}/delete`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "댓글을 삭제하지 못했습니다.");
  await loadEssayCommentsFromApi(activeEssayId);
}

function truncateText(text, limit=52) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit).trim()}...` : clean;
}

function extractEssayDate(blocks, fallback="날짜 미정") {
  const match = blocks.find(p => /\d{4}[.\-/년]\s*\d{1,2}/.test(p));
  return match ? match.replace(/\s+/g, " ").trim() : fallback;
}

function extractEssayLead(blocks, fallback="", title="") {
  const skip = /^(day\s*\d|[\d.\-/년월일:\s]+$|\[\[IMAGE:)/i;
  const candidate = blocks.find(p => p && p !== title && !skip.test(p) && p.length > 12) || fallback;
  return truncateText(candidate, 100);
}

function formatEssaySummary(summary) {
  const text = String(summary || "").replace(/\s+/g, " ").trim();
  if (!text) return "본문의 핵심 쟁점과 맥락을 정리한 포스트";
  if (/포스트$/.test(text)) return text;
  if (text.includes("삼성 노조 협상 이후")) {
    return "삼성 노조 협상 이후 현기차 노조, 기업의 인건비 절감, 산별노조 운동으로 이어질 가능성을 분석한 포스트";
  }
  return text
    .replace(/글입니다\.?$/, "포스트")
    .replace(/기록입니다\.?$/, "기록한 포스트")
    .replace(/다룹니다\.?$/, "다룬 포스트")
    .replace(/정리합니다\.?$/, "정리한 포스트")
    .replace(/씁니다\.?$/, "기술한 포스트")
    .replace(/생각합니다\.?$/, "검토한 포스트")
    .replace(/적습니다\.?$/, "기록한 포스트")
    .replace(/입니다\.?$/, "인 포스트")
    .replace(/합니다\.?$/, "한 포스트");
}

// HTML 본문에서 순수 텍스트만 추출(리드문·미리보기용). 태그 노출 방지.
function htmlToPlainBlocks(html) {
  const div = document.createElement("div");
  div.innerHTML = String(html || "");
  // 블록 요소 경계를 줄바꿈으로 (문단 분리 유지)
  div.querySelectorAll("p, h2, h3, h4, blockquote, li, br, hr, div").forEach(el => {
    el.insertAdjacentText("afterend", "\n\n");
  });
  const text = div.textContent || "";
  return text.split(/\n{2,}/).map(p => p.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function essayToObject(item) {
  const fullText = ESSAY_FULL_TEXTS[item[0]];
  const isHtmlBody = /<(p|h2|h3|strong|b|em|i|u|blockquote|ul|ol|li|hr|img|br)\b/i.test(fullText || "");
  const bodyBlocks = fullText
    ? (isHtmlBody
        ? htmlToPlainBlocks(fullText)
        : fullText.split(/\n{2,}/).map(p => p.trim()).filter(Boolean))
    : [
      item[3],
      "이 영역은 실제 글 전문이 들어갈 자리입니다. 지금은 Essay 메뉴의 구조를 먼저 잡기 위해 제목, 요약, 본문, 댓글 기능을 연결해 둔 상태입니다.",
      "나중에 브런치나 블로그 원문을 연결하거나, 이 HTML 안에 전문을 직접 넣으면 카드와 모달이 같은 방식으로 작동합니다."
    ];
  return {
    id: item[0],
    category: item[1],
    title: item[2],
    summary: formatEssaySummary(item[3]),
    tags: Array.isArray(item[4]) ? item[4] : [],
    date: item[5] || extractEssayDate(bodyBlocks),
    lead: extractEssayLead(bodyBlocks, item[3], item[2]),
    body: bodyBlocks,
    // 모달용 원본(HTML이면 HTML 그대로, 아니면 빈 문자열)
    bodyRaw: isHtmlBody ? fullText : ""
  };
}

function createEssayCard(item, isNews=false) {
  const essay = essayToObject(item);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `project-card essay-card${isNews ? " news-card" : ""}`;
  btn.dataset.essayId = essay.id;
  btn.dataset.category = essay.category;
  btn.dataset.title = essay.title;
  btn.dataset.summary = essay.summary;
  btn.dataset.tags = essay.tags.join(",");
  // Supabase에서 받은 실제 작성일이 있으면 우선 사용
  const realDate = (typeof ESSAY_PUBLISHED_DATES !== "undefined" && ESSAY_PUBLISHED_DATES[essay.id])
    ? String(ESSAY_PUBLISHED_DATES[essay.id]).slice(0, 10)
    : essay.date;
  btn.dataset.date = realDate;
  btn.dataset.lead = essay.lead;
  // 모달엔 원본 HTML(있으면), 없으면 평문 블록을 줄바꿈으로
  btn.dataset.body = essay.bodyRaw || essay.body.join("\n\n");

  // 대표 이미지(og:image)가 있으면 카드 배경으로 사용 → 제목이 그 위에 얹힘
  const cover = (typeof ESSAY_COVER_IMAGES !== "undefined") ? ESSAY_COVER_IMAGES[essay.id] : "";
  if (cover && !isGenericCoverImage(cover)) {
    btn.classList.add("has-cover");
    btn.style.setProperty("--essay-cover", `url("${cover.replace(/"/g, "%22")}")`);
  }

  const tagHtml = essay.tags.length
    ? `<span class="essay-card-tags">${essay.tags.map(tag => `<small>${escapeHtml(tag)}</small>`).join("")}</span>`
    : "";
  btn.innerHTML = `
    <span class="front">
      <strong>${escapeHtml(essay.title)}</strong>
      ${tagHtml || `<span class="essay-card-tags" aria-hidden="true"></span>`}
      <em>${escapeHtml(realDate)}</em>
    </span>
    <span class="hover">
      <em>${escapeHtml(essay.lead)}</em>
      <i>글 읽기</i>
    </span>`;
  btn.addEventListener("click", () => openEssayModal(btn));
  return btn;
}

const ESSAY_FRAME_CONFIGS = {
  publicBusiness: {
    tagStrip: "#essayPublicBusinessTagStrip",
    grid: "#essayPublicBusinessGrid"
  },
  worldOutside: {
    tagStrip: "#essayWorldOutsideTagStrip",
    grid: "#essayWorldOutsideGrid"
  },
  others: {
    tagStrip: "#essayOthersTagStrip",
    grid: "#essayOthersGrid"
  },
  thinkingEmotion: {
    tagStrip: "#essayThinkingTagStrip",
    grid: "#essayThinkingEmotionGrid"
  }
};

function renderEssayTags(group) {
  const config = ESSAY_FRAME_CONFIGS[group];
  const strip = $(config?.tagStrip);
  if (!strip) return;
  const activeTag = activeEssayTags[group];
  const tags = [...new Set(ESSAYS[group].flatMap(item => Array.isArray(item[4]) ? item[4] : []))];
  strip.innerHTML = [
    `<button type="button" class="essay-tag-btn${activeTag ? "" : " active"}" data-essay-tag-group="${group}" data-essay-tag="">All</button>`,
    ...tags.map(tag => `<button type="button" class="essay-tag-btn${activeTag === tag ? " active" : ""}" data-essay-tag-group="${group}" data-essay-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`)
  ].join("");
}

function renderEssayCards() {
  const newsTrack = $("#essayNewsTrack");
  if (!newsTrack) return;

  newsTrack.innerHTML = "";
  ESSAYS.news.forEach(item => newsTrack.appendChild(createEssayCard(item, true)));

  Object.entries(ESSAY_FRAME_CONFIGS).forEach(([group, config]) => {
    const grid = $(config.grid);
    if (!grid) return;
    grid.innerHTML = "";
    const activeTag = activeEssayTags[group];
    const items = activeTag
      ? ESSAYS[group].filter(item => (item[4] || []).includes(activeTag))
      : ESSAYS[group];
    items.forEach(item => grid.appendChild(createEssayCard(item)));
    renderEssayTags(group);
  });
}

const PANEL_FIRST_BLOCKS = {
  projects: "portfolioIntro",
  essay: "essaySectionNews",
  story: "storyV6Storyline",
  taste: "taste"
};

function getStickyTopOffset() {
  let offset = 18;
  const topbar = document.querySelector(".topbar");
  if (topbar) {
    const rect = topbar.getBoundingClientRect();
    const position = window.getComputedStyle(topbar).position;
    if (position === "sticky" || position === "fixed") {
      offset += Math.ceil(Math.max(rect.bottom, rect.height));
    }
  }

  const blockNav = document.querySelector(".panel.active .arch-blocknav");
  if (blockNav) {
    const navRect = blockNav.getBoundingClientRect();
    const navPosition = window.getComputedStyle(blockNav).position;
    if ((navPosition === "sticky" || navPosition === "fixed") && navRect.height > 0) {
      offset += Math.ceil(navRect.height + 12);
    }
  }

  return offset;
}

function scrollToTargetWithTopbar(target, behavior = "smooth", extraGap = 0) {
  if (!target) return;
  const root = document.documentElement;
  const previousRootBehavior = root.style.scrollBehavior;
  const previousBodyBehavior = document.body.style.scrollBehavior;
  if (behavior === "auto") {
    root.style.scrollBehavior = "auto";
    document.body.style.scrollBehavior = "auto";
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const top = Math.max(0, window.scrollY + target.getBoundingClientRect().top - getStickyTopOffset() - extraGap);
      window.scrollTo({ top, left: 0, behavior });
      root.style.scrollBehavior = previousRootBehavior;
      document.body.style.scrollBehavior = previousBodyBehavior;
      refreshSectionJump();
    });
  });
}

function getPanelFirstBlock(tabId) {
  const panel = document.getElementById(tabId);
  if (!panel) return null;
  for (const c of panel.children) {
    if (!c.classList.contains("section-jump")) return c;
  }
  return null;
}

function getStickyTopOffset() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return 0;
  const cs = getComputedStyle(topbar);
  const stickyTop = parseFloat(cs.top) || 0;
  const h = topbar.getBoundingClientRect().height;
  // sticky header occupies stickyTop + its height from the viewport top
  let offset = stickyTop + h;
  // Archiving has an extra sticky block-nav under the header
  const blockNav = document.querySelector(".panel.active .arch-blocknav");
  if (blockNav) {
    const bcs = getComputedStyle(blockNav);
    if (bcs.position === "sticky") offset += blockNav.getBoundingClientRect().height;
  }
  return offset;
}

function scrollToPanelFirstBlock(tabId) {
  const root = document.documentElement;
  const previousRootBehavior = root.style.scrollBehavior;
  const previousBodyBehavior = document.body.style.scrollBehavior;
  root.style.scrollBehavior = "auto";
  document.body.style.scrollBehavior = "auto";

  const GAP = 24; // uniform gap between header bottom and first block

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const first = getPanelFirstBlock(tabId);
      if (first) {
        const blockTop = first.getBoundingClientRect().top + window.scrollY;
        const target = Math.max(0, Math.round(blockTop - getStickyTopOffset() - GAP));
        window.scrollTo({ top: target, left: 0, behavior: "auto" });
      } else {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
      root.style.scrollBehavior = previousRootBehavior;
      document.body.style.scrollBehavior = previousBodyBehavior;
      refreshSectionJump();
      positionSectionJump();
    });
  });
}

function activatePanel(tabId, options = {}) {
  if (!tabId) return;
  $$(".tab[data-tab]").forEach(t => t.classList.toggle("active", t.dataset.tab === tabId));
  $$(".panel").forEach(p => p.classList.toggle("active", p.id === tabId));
  if (options.scrollToStart) {
    scrollToPanelFirstBlock(tabId);
  } else {
    refreshSectionJump();
  }
}

function initSectionJump() {
  $$(".section-jump").forEach(nav => {
    nav.addEventListener("click", e => {
      const item = e.target.closest(".section-jump-item");
      if (!item) return;
      const target = document.getElementById(item.dataset.sectionTarget);
      scrollToTargetWithTopbar(target, "smooth");
    });
  });

  document.addEventListener("scroll", () => refreshSectionJump(), { passive: true });
  window.addEventListener("resize", () => {
    refreshSectionJump();
    positionSectionJump();
  });

  // Wheel scrolling should stay native. Section-jump buttons still move to
  // blocks, but the mouse wheel no longer snaps or reverses at block edges.
}

function getActiveSectionTargets() {
  const nav = document.querySelector(".panel.active .section-jump");
  if (!nav) return [];
  return Array.from(nav.querySelectorAll(".section-jump-item"))
    .map(item => document.getElementById(item.dataset.sectionTarget))
    .filter(Boolean);
}

function initSectionWheelSnap() {
  // Disabled: native wheel scrolling feels steadier than section-edge snapping.
}

function positionSectionJump() {
  const shell = $(".main-shell");
  if (!shell) return;
  const shellRight = shell.getBoundingClientRect().right;
  const gap = 22;
  const navWidth = 38;
  const left = Math.min(shellRight + gap, window.innerWidth - navWidth - 8);

  $$(".section-jump").forEach(nav => {
    nav.style.left = `${left}px`;
  });
}

function refreshSectionJump() {
  const nav = document.querySelector(".panel.active .section-jump");
  if (!nav) return;

  const items = Array.from(nav.querySelectorAll(".section-jump-item"));
  const viewportLine = window.innerHeight * 0.35;

  let currentIndex = 0;
  items.forEach((item, i) => {
    const target = document.getElementById(item.dataset.sectionTarget);
    if (!target) return;
    const top = target.getBoundingClientRect().top;
    if (top <= viewportLine) currentIndex = i;
  });

  items.forEach((item, i) => {
    item.classList.toggle("active", i === currentIndex);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadSiteSettings();
  initSectionJump();
  positionSectionJump();
  refreshSectionJump();
});

function buildSearchIndex() {
  const essayItems = Object.entries(ESSAYS).flatMap(([group, items]) =>
    items.map(item => {
      const essay = essayToObject(item);
      return {
        type: "essay",
        tab: "essay",
        id: essay.id,
        title: essay.title,
        label: `Essay · ${essay.category}`,
        text: [essay.title, essay.category, essay.summary, essay.tags.join(" "), essay.date, essay.body.join(" ")].join(" ")
      };
    })
  );

  const projectItems = PROJECTS.map(project => ({
    type: "project",
    tab: "projects",
    id: project.id,
    title: project.title,
    label: `Portfolio · ${project.category}`,
    text: [project.title, project.category, project.metric, project.short, project.description, project.role, project.outcome, ...(project.tags || [])].join(" ")
  }));

  const panelItems = ["story", "taste"].map(id => {
    const panel = $(`#${id}`);
    return panel ? {
      type: "panel",
      tab: id,
      id,
      title: id === "story" ? "Story" : "Archiving",
      label: "Page",
      text: panel.innerText || ""
    } : null;
  }).filter(Boolean);

  return [...essayItems, ...projectItems, ...panelItems];
}

function findEssayItemById(id) {
  return Object.values(ESSAYS).flat().find(item => item[0] === id);
}

function renderSearchResults(query) {
  const results = $("#siteSearchResults");
  if (!results) return;
  const q = query.trim().toLowerCase();
  if (!q) {
    results.classList.remove("open");
    results.innerHTML = "";
    return;
  }

  const matches = buildSearchIndex()
    .filter(item => item.text.toLowerCase().includes(q))
    .slice(0, 8);

  results.innerHTML = matches.length
    ? matches.map(item => `<button type="button" class="site-search-result" data-search-type="${item.type}" data-search-tab="${item.tab}" data-search-id="${escapeHtml(item.id)}"><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.label)}</span></button>`).join("")
    : `<button type="button" class="site-search-result" disabled><b>검색 결과 없음</b><span>다른 단어로 다시 검색해 주세요.</span></button>`;
  results.classList.add("open");
}

function openSearchResult(button) {
  const type = button.dataset.searchType;
  const tab = button.dataset.searchTab;
  const id = button.dataset.searchId;
  activatePanel(tab);
  $("#siteSearchResults")?.classList.remove("open");

  if (type === "project") {
    openProjectModal(id);
    return;
  }

  if (type === "essay") {
    const card = $(`[data-essay-id="${id}"]`);
    if (card) {
      openEssayModal(card);
      return;
    }
    const item = findEssayItemById(id);
    if (item) openEssayModal(createEssayCard(item));
    return;
  }

  scrollToTargetWithTopbar($(`#${tab}`), "smooth");
}

function enableDragSwipe(track) {
  if (!track) return;

  let isDown = false;
  let startX = 0;
  let startY = 0;
  let scrollLeft = 0;
  let scrollTop = 0;
  let moved = false;
  let pressedCard = null;
  let suppressNextClick = false;

  track.addEventListener("pointerdown", e => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest(".essay-tag-btn")) return;
    isDown = true;
    moved = false;
    pressedCard = e.target.closest(".essay-card");
    startX = e.clientX;
    startY = e.clientY;
    scrollLeft = track.scrollLeft;
    scrollTop = track.scrollTop;
    track.classList.add("dragging");
    track.setPointerCapture?.(e.pointerId);
  });

  track.addEventListener("pointermove", e => {
    if (!isDown) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    track.scrollLeft = scrollLeft - dx;
    track.scrollTop = scrollTop - dy;
  });

  function endDrag(e) {
    if (!isDown) return;
    isDown = false;
    track.classList.remove("dragging");
    track.releasePointerCapture?.(e.pointerId);
    if (!moved && pressedCard) {
      suppressNextClick = true;
      openEssayModal(pressedCard);
    }
    pressedCard = null;
  }

  track.addEventListener("pointerup", endDrag);
  track.addEventListener("pointercancel", endDrag);
  track.addEventListener("pointerleave", endDrag);

  track.addEventListener("click", e => {
    if (suppressNextClick || moved) {
      e.preventDefault();
      e.stopPropagation();
    }
    suppressNextClick = false;
    moved = false;
  }, true);
}

function renderEssayComments() {
  const list = $("#essayCommentList");
  if (!list || !activeEssayId) return;
  const comments = (essayComments[activeEssayId] || []).map(normalizeEssayComment);
  essayComments[activeEssayId] = comments;
  list.innerHTML = comments.length
    ? comments.map(comment => renderEssayCommentNode(comment, 0)).join("")
    : `<div class="essay-comment"><span>아직 댓글이 없습니다. 첫 댓글을 남겨주세요.</span></div>`;
}

function renderEssayCommentNode(comment, depth) {
  const replies = Array.isArray(comment.replies) ? comment.replies : [];
  const repliesHtml = replies.length
    ? `<div class="essay-replies">${replies.map(reply => renderEssayCommentNode(reply, depth + 1)).join("")}</div>`
    : "";
  const nodeClass = depth ? "essay-comment essay-reply" : "essay-comment";
  const id = comment.id || "";
  const date = formatEssayCommentDate(comment.createdAt);
  return `<div class="${nodeClass}">
    <b>${escapeHtml(comment.writer || "익명")}${date ? `<em>${escapeHtml(date)}</em>` : ""}</b>
    <span>${escapeHtml(comment.body || "")}</span>
    ${repliesHtml}
    <div class="essay-comment-actions">
      <button type="button" class="essay-reply-toggle" data-reply-toggle="${escapeHtml(id)}">${activeReplyPath === id ? "답글 닫기" : "답글 달기"}</button>
      <button type="button" class="essay-comment-delete" data-comment-delete="${escapeHtml(id)}">삭제</button>
    </div>
    <form class="essay-reply-form" data-reply-form="${escapeHtml(id)}" ${activeReplyPath === id ? "" : "hidden"}>
      <input type="text" data-reply-writer placeholder="이름" required>
      <input type="password" data-reply-password placeholder="삭제용 비밀번호" required>
      <input type="text" data-reply-company class="memo-hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <textarea data-reply-body placeholder="답글을 남겨주세요." required></textarea>
      <button type="submit">답글 등록</button>
    </form>
  </div>`;
}

function openEssayModal(card) {
  activeEssayId = card.dataset.essayId;
  $("#essayModalCategory").textContent = card.dataset.category || "Essay";
  $("#essayModalTitle").textContent = card.dataset.title || "";
  $("#essayModalMeta").textContent = `Uploaded · ${card.dataset.date || "날짜 미정"}`;
  const modalTags = $("#essayModalTags");
  const tags = (card.dataset.tags || "").split(",").filter(Boolean);
  if (modalTags) {
    modalTags.innerHTML = tags.length
      ? tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join("")
      : `<span>태그 미지정</span>`;
  }
  const images = ESSAY_IMAGES[activeEssayId] || [];
  const rawBody = card.dataset.body || "";
  const hasInlineImages = /\[\[IMAGE:/.test(rawBody);
  const imageHtml = images.length && !hasInlineImages
    ? `<div class="essay-image-gallery">${images.map(([src, caption]) => `
        <figure>
          <img src="${escapeHtml(src)}" alt="${escapeHtml(caption)}" loading="lazy">
          <figcaption>${escapeHtml(caption)}</figcaption>
        </figure>`).join("")}</div>`
    : "";
  // 본문 렌더: HTML 서식이 있으면 새니타이즈 후 렌더, 평문이면 기존 방식(문단 분리).
  const looksLikeHtml = /<(p|h2|h3|strong|em|b|i|u|blockquote|ul|ol|li|hr|img|br)\b/i.test(rawBody);
  let bodyHtml;
  if (looksLikeHtml) {
    bodyHtml = sanitizeEssayHtml(rawBody);
  } else {
    bodyHtml = rawBody
      .split(/\n{2,}/)
      .map(p => {
        const imageMatch = p.match(/^\[\[IMAGE:([^|]+)\|(.+)\]\]$/);
        if (imageMatch) {
          const src = imageMatch[1];
          const caption = imageMatch[2];
          return `<figure class="essay-inline-image"><img src="${escapeHtml(src)}" alt="${escapeHtml(caption)}" loading="lazy"><figcaption>${escapeHtml(caption)}</figcaption></figure>`;
        }
        return `<p>${escapeHtml(p)}</p>`;
      })
      .join("");
  }
  $("#essayModalBody").innerHTML = imageHtml + bodyHtml;
  // 본문이 비어 있고 원본 링크가 있으면 "원문 보기" 안내
  if (!rawBody.trim()) {
    const srcUrl = ESSAY_SOURCE_URLS[activeEssayId];
    $("#essayModalBody").innerHTML = srcUrl
      ? `<p class="essay-source-link">이 글의 본문은 아직 옮겨지지 않았습니다.<br><a href="${escapeHtml(srcUrl)}" target="_blank" rel="noopener">원문 보기 →</a></p>`
      : `<p class="essay-source-link">본문이 아직 등록되지 않았습니다.</p>`;
  }
  essayComments[activeEssayId] = [];
  setEssayCommentMessage("댓글을 불러오는 중입니다.");
  $("#essayModal").classList.add("open");
  $("#essayModal").setAttribute("aria-hidden", "false");
  document.body.classList.add("lock");
  loadEssayCommentsFromApi(activeEssayId);
}

function closeEssayModal() {
  $("#essayModal").classList.remove("open");
  $("#essayModal").setAttribute("aria-hidden", "true");
  document.body.classList.remove("lock");
  activeEssayId = null;
  activeReplyPath = null;
}

// Supabase에 저장된 에세이를 기존 ESSAYS/ESSAY_FULL_TEXTS에 병합한다.
// (Supabase에 글이 있으면 우선 사용, 없으면 data.js 하드코딩 유지 → 안전)
const ESSAY_SOURCE_URLS = {};
const ESSAY_COVER_IMAGES = {};
const ESSAY_PUBLISHED_DATES = {};
async function hydrateEssaysFromSupabase() {
  try {
    const essays = await fetch(apiUrl("/api/essays")).then(r => r.ok ? r.json() : null);
    if (!Array.isArray(essays) || !essays.length) return;
    const validGroups = Object.keys(ESSAYS);
    const grouped = {};
    essays.forEach(e => {
      const group = validGroups.includes(e.category) ? e.category : "news";
      if (!grouped[group]) grouped[group] = [];
      grouped[group].push([
        e.id,
        e.label || e.category,
        e.title || "",
        e.summary || "",
        Array.isArray(e.tags) ? e.tags : []
      ]);
      if (e.body && e.body.trim()) ESSAY_FULL_TEXTS[e.id] = e.body;
      if (e.sourceUrl) ESSAY_SOURCE_URLS[e.id] = e.sourceUrl;
      if (e.coverImage) ESSAY_COVER_IMAGES[e.id] = e.coverImage;
      if (e.publishedAt) ESSAY_PUBLISHED_DATES[e.id] = e.publishedAt;
    });
    Object.entries(grouped).forEach(([group, items]) => { ESSAYS[group] = items; });
    renderEssayCards();
    // archiving 탭의 에세이 목록도 최신 데이터로 갱신(모달 연결 유지)
    if (typeof window.refreshArchEssays === "function") window.refreshArchEssays();
  } catch (error) {
    console.warn("essay hydrate skipped:", error);
  }
}

renderEssayCards();
hydrateEssaysFromSupabase();
enableDragSwipe($("#essayNewsTrack"));
Object.values(ESSAY_FRAME_CONFIGS).forEach(config => {
  enableDragSwipe($(config.grid));
  enableDragSwipe($(config.tagStrip));
});

$$("#essay .essay-tag-strip").forEach(strip => {
  strip.addEventListener("click", e => {
    const button = e.target.closest("[data-essay-tag-group]");
    if (!button) return;
    const group = button.dataset.essayTagGroup;
    activeEssayTags[group] = button.dataset.essayTag || null;
    renderEssayCards();
    $(ESSAY_FRAME_CONFIGS[group]?.grid)?.scrollTo({ left: 0, top: 0 });
  });
});

$$("#essay [data-essay-scroll]").forEach(button => {
  button.addEventListener("click", () => {
    const group = button.dataset.essayScroll;
    const direction = Number(button.dataset.direction || 1);
    const grid = $(ESSAY_FRAME_CONFIGS[group]?.grid);
    if (!grid) return;
    grid.scrollBy({
      left: direction * Math.max(260, grid.clientWidth - 40),
      top: 0,
      behavior: "smooth"
    });
  });
});

$("#siteSearchInput")?.addEventListener("input", e => {
  renderSearchResults(e.target.value || "");
});

$("#siteSearchForm")?.addEventListener("submit", e => {
  e.preventDefault();
  const first = $("#siteSearchResults .site-search-result:not([disabled])");
  if (first) openSearchResult(first);
});

$("#siteSearchResults")?.addEventListener("click", e => {
  const button = e.target.closest(".site-search-result");
  if (!button || button.disabled) return;
  openSearchResult(button);
});

$$("#siteSearchForm [data-search-suggest]").forEach(button => {
  button.addEventListener("click", () => {
    const input = $("#siteSearchInput");
    const query = button.dataset.searchSuggest || "";
    if (input) input.value = query;
    renderSearchResults(query);
  });
});

(() => {
  const toggle = $("#siteSearchToggle");
  const form = $("#siteSearchForm");
  if (!toggle || !form) return;

  function closeSearch() {
    form.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  }

  function openSearch() {
    form.classList.add("open");
    toggle.setAttribute("aria-expanded", "true");
    $("#siteSearchInput")?.focus();
  }

  toggle.addEventListener("click", () => {
    if (form.classList.contains("open")) closeSearch();
    else openSearch();
  });

  document.addEventListener("click", e => {
    if (window.innerWidth > 1000) return;
    if (!e.target.closest(".site-search") && !e.target.closest(".site-search-toggle")) {
      closeSearch();
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 1000) closeSearch();
  });
})();

document.addEventListener("click", e => {
  if (!e.target.closest(".site-search")) {
    $("#siteSearchResults")?.classList.remove("open");
  }
});

$$(".tab[data-tab]").forEach(tab => {
  tab.addEventListener("click", () => {
    activatePanel(tab.dataset.tab, { scrollToStart: true });
  });
});

async function fetchProjectDetail(projectId) {
  try {
    const response = await fetch(apiUrl(`/api/projects/${encodeURIComponent(projectId)}`), { cache: "no-store" });
    if (!response.ok) return null;
    return cacheProject(await response.json());
  } catch (error) {
    console.warn("Project detail API failed:", error);
    return null;
  }
}

async function hydrateProjectCache() {
  try {
    const response = await fetch(apiUrl("/api/projects"), { cache: "no-store" });
    if (!response.ok) return;
    const projects = await response.json();
    if (Array.isArray(projects)) {
      projects.forEach(project => {
        const cached = cacheProject(project);
        syncProjectCards(cached);
      });
      syncAllProjectCards();
      renderDashboardRecent(projects);
    }
  } catch (error) {
    console.warn("Project index API failed:", error);
  }
}

function renderProjectUploads(project) {
  const root = $("#projectUploads");
  const strip = $("#projectAttachmentStrip");
  const images = Array.isArray(project?.images) ? project.images : [];
  const files = Array.isArray(project?.files) ? project.files.filter(file => file.visibility !== "private") : [];
  const visibleImages = images.filter(image => getAssetUrl(image));

  const fileHtml = `
    <section class="project-upload-section">
      <h4>첨부파일</h4>
      <div class="project-upload-files">
        ${files.length ? files.map(file => {
          const href = getAssetUrl(file);
          const publicFile = file.visibility === "public";
          const visibility = publicFile ? "공개 다운로드" : "요청 시 공개";
          const filename = cleanAssetText(file.title) || fileNameFromUrl(href, "portfolio-file");
          return `
            <article class="project-file-card">
              ${publicFile && href
                ? `<a class="project-download-link" href="${escapeHtml(href)}" download="${escapeHtml(filename)}" data-download-url="${escapeHtml(href)}" data-download-name="${escapeHtml(filename)}">다운로드</a>`
                : `<em>${visibility}</em>`}
            </article>
          `;
        }).join("") : `<div class="project-file-empty">등록된 첨부파일이 없습니다.</div>`}
      </div>
    </section>
  `;

  if (root) root.innerHTML = fileHtml;
  root?.querySelectorAll(".project-download-link").forEach(link => {
    link.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      const url = link.dataset.downloadUrl || link.href;
      const filename = link.dataset.downloadName || fileNameFromUrl(url);
      try {
        await downloadInBrowser(url, filename);
      } catch (error) {
        console.warn("In-page download failed, using same-window fallback:", error);
        window.location.href = url;
      }
    });
  });

  if (strip) {
    if (!visibleImages.length && !files.length) {
      strip.innerHTML = "";
      strip.hidden = true;
      return;
    }
    strip.innerHTML = "";
    strip.hidden = true;
  }
}

function renderProjectModal(project) {
  const p = project;
  if (!p) return;
  $("#projectCategory").textContent = p.category;
  $("#projectTitle").textContent = p.title;
  $("#projectDescription").textContent = p.short || p.description || "";
  $("#projectPeriod").textContent = p.period;
  $("#projectShort").textContent = p.description || p.short || "";
  $("#projectRole").textContent = p.role;
  $("#projectOutcome").textContent = p.outcome;
  
  const skillTags = Array.isArray(p.skillTags) && p.skillTags.length
    ? p.skillTags
    : [];
  $("#projectMetric").innerHTML = Object.entries(SKILL_CHIP_LABELS).map(([value, label]) => {
    const active = skillTags.includes(value);
    const fullLabel = SKILLSET_LABELS[value] || value;
    return `<span class="tag skill-tag${active ? " active" : ""}" title="${escapeHtml(fullLabel)}" aria-label="${escapeHtml(fullLabel)}">${escapeHtml(label)}</span>`;
  }).join("");
  const teamPositions = Array.isArray(p.teamPositions) && p.teamPositions.length
    ? p.teamPositions
    : [];
  $("#projectTags").innerHTML = Object.entries(TEAM_POSITION_LABELS).map(([value, label]) => {
    const active = teamPositions.includes(value);
    return `<span class="team-position-chip${active ? " active" : ""}">${escapeHtml(label)}</span>`;
  }).join("");

  $("#thumbs").innerHTML = "";
  const uploadedImages = projectUploadedImages(p);
  const textGallery = Array.isArray(p.gallery) && p.gallery.length
    ? p.gallery.map(item => ({
      kind: "text",
      type: item[0],
      title: item[1],
      desc: item[2]
    }))
    : [{
      kind: "text",
      type: "Portfolio",
      title: p.title || "Project",
      desc: p.short || p.description || "등록된 기본 갤러리 항목이 없습니다."
    }];
  renderProjectImageSlot(uploadedImages);
  const thumbItems = uploadedImages.length ? uploadedImages : textGallery;
  thumbItems.forEach((g, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "thumb" + (i === 0 ? " active" : "");
    if (g.kind === "image") {
      btn.innerHTML = `<span class="thumb-image-wrap"><img src="${escapeHtml(g.src)}" alt="${escapeHtml(g.alt || g.title)}" loading="lazy"></span>`;
      btn.addEventListener("click", () => {
        renderProjectImageAt(i);
        if (i >= 3) setProjectImageZoom(true);
      });
    } else {
      btn.innerHTML = `<b>${escapeHtml(g.type)}</b><span>${escapeHtml(g.title)}</span>`;
      btn.addEventListener("click", () => renderAssetText(g, i));
    }
    $("#thumbs").appendChild(btn);
  });
  renderAssetText(thumbItems[0] || textGallery[0], 0);
  renderProjectUploads(p);
}

async function openProjectModal(projectId) {
  const fallback = getCachedProject(projectId);
  if (!fallback) return;
  renderProjectModal({
    ...fallback,
    description: fallback.description || "백엔드 프로젝트 데이터를 불러오는 중입니다."
  });

  $("#projectModal").classList.add("open");
  $("#projectModal").setAttribute("aria-hidden", "false");
  document.body.classList.add("lock");
  activeProject = true;

  const detail = await fetchProjectDetail(projectId);
  if (detail && activeProject) {
    renderProjectModal(detail);
    syncProjectCards(detail);
  } else if (activeProject) {
    const strip = $("#projectAttachmentStrip");
    if (strip && API_BASE) {
      strip.insertAdjacentHTML("afterbegin", `<span class="project-attachment-empty">백엔드 상세 데이터를 불러오지 못했습니다. API 주소를 확인해 주세요.</span>`);
    }
  }
}

renderDashboardRecent(typeof PROJECTS !== "undefined" ? PROJECTS : []);
hydrateProjectCache();

function renderProjectImageSlot(images) {
  projectGalleryImages = Array.isArray(images) ? images : [];
  projectGalleryIndex = 0;
  renderProjectImageAt(0);
}

function renderProjectImageAt(index) {
  const figure = $("#projectImageFigure");
  const link = $("#projectImageLink");
  const img = $("#projectImage");
  const caption = $("#projectImageCaption");
  const prev = $("#projectImagePrev");
  const next = $("#projectImageNext");
  if (!figure || !link || !img || !caption) return;
  const total = projectGalleryImages.length;
  const safeIndex = total ? (index + total) % total : 0;
  projectGalleryIndex = safeIndex;
  const image = projectGalleryImages[safeIndex];
  if (!image?.src) {
    setProjectImageZoom(false);
    figure.classList.remove("has-image");
    link.removeAttribute("href");
    link.removeAttribute("target");
    img.removeAttribute("src");
    img.alt = "";
    caption.textContent = "등록된 대표 이미지가 없습니다.";
    if (prev) prev.disabled = true;
    if (next) next.disabled = true;
    return;
  }
  figure.classList.add("has-image");
  link.removeAttribute("href");
  link.removeAttribute("target");
  link.setAttribute("aria-disabled", "true");
  link.setAttribute("tabindex", "-1");
  img.src = image.src;
  img.alt = image.alt || image.title || "Project image";
  img.style.setProperty("--project-image-zoom", projectImageZoomLevel);
  caption.textContent = `${safeIndex + 1} / ${total}`;
  if (prev) prev.disabled = total < 2;
  if (next) next.disabled = total < 2;
  renderAssetText(image, safeIndex);
  $$("#thumbs .thumb").forEach((t, i) => t.classList.toggle("active", i === safeIndex));
}

function setProjectImageZoom(zoomed) {
  projectImageZoomed = Boolean(zoomed && projectGalleryImages.length);
  if (projectImageZoomed) projectImageZoomLevel = Math.max(projectImageZoomLevel, 1.08);
  else projectImageZoomLevel = 1;
  $("#projectModal")?.classList.toggle("image-zoomed", projectImageZoomed);
  $("#projectImage")?.style.setProperty("--project-image-zoom", projectImageZoomLevel);
}

function toggleProjectImageZoom() {
  if (!projectGalleryImages.length) return;
  setProjectImageZoom(!projectImageZoomed);
}

function setProjectImageZoomLevel(nextLevel) {
  projectImageZoomLevel = Math.min(2.2, Math.max(1, nextLevel));
  $("#projectImage")?.style.setProperty("--project-image-zoom", projectImageZoomLevel);
}

function renderAssetText(g, idx) {
  const panel = $("#assetTextPanel");
  const isImage = g?.kind === "image";
  const title = isImage ? "" : (g.title || "");
  const desc = isImage ? cleanAssetText(g.desc) : (g.desc || "");
  const type = isImage ? "사진 설명" : (g.type || "");
  if (panel) {
    panel.classList.toggle("is-empty", isImage && !title && !desc);
    panel.classList.toggle("no-desc", !desc);
  }
  $("#assetType").textContent = type;
  $("#assetTitle").textContent = title || desc || "";
  $("#assetDesc").textContent = title ? desc : "";
  $$(".thumb").forEach((t, i) => t.classList.toggle("active", i === idx));
}

function closeProjectModal() {
  setProjectImageZoom(false);
  $("#projectModal").classList.remove("open");
  $("#projectModal").setAttribute("aria-hidden", "true");
  document.body.classList.remove("lock");
  activeProject = false;
}

$("#projectImagePrev")?.addEventListener("click", () => renderProjectImageAt(projectGalleryIndex - 1));
$("#projectImageNext")?.addEventListener("click", () => renderProjectImageAt(projectGalleryIndex + 1));
["#projectImageLink", "#projectImage", "#projectImageFigure"].forEach(selector => {
  const element = $(selector);
  if (!element) return;
  element.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    toggleProjectImageZoom();
  });
  element.addEventListener("contextmenu", event => event.preventDefault());
  element.addEventListener("dragstart", event => event.preventDefault());
});
(() => {
  const frame = $("#projectImageFrame");
  if (!frame) return;
  let startX = 0;
  let isDragging = false;
  frame.addEventListener("pointerdown", event => {
    if (event.button !== undefined && event.button !== 0) return;
    startX = event.clientX;
    isDragging = true;
  });
  frame.addEventListener("pointerup", event => {
    if (!isDragging) return;
    isDragging = false;
    const delta = event.clientX - startX;
    if (Math.abs(delta) < 48 || projectGalleryImages.length < 2) return;
    renderProjectImageAt(projectGalleryIndex + (delta < 0 ? 1 : -1));
  });
  frame.addEventListener("pointercancel", () => {
    isDragging = false;
  });
  frame.addEventListener("wheel", event => {
    if (!projectImageZoomed || !projectGalleryImages.length) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.deltaY < 0 ? 0.12 : -0.12;
    setProjectImageZoomLevel(projectImageZoomLevel + step);
  }, { passive: false });
})();
$$(".js-open-project").forEach(btn => btn.addEventListener("click", () => openProjectModal(btn.dataset.project)));

/* timeline skillset filter */
(function() {
  const bar = document.querySelector(".timeline-skill-filter");
  const buttons = document.querySelectorAll(".skill-filter-btn");
  const timelineProjects = document.querySelectorAll(".timeline-screen .grid-event.js-open-project");

  let hoverSkill = null;
  let lockedSkill = null;

  function activeSkill() {
    return hoverSkill || lockedSkill || null;
  }

  function setVisualState() {
    const skill = activeSkill();

    buttons.forEach(btn => {
      const isHover = btn.dataset.skill === hoverSkill;
      const isLocked = btn.dataset.skill === lockedSkill;
      const isActive = btn.dataset.skill === skill;
      btn.classList.toggle("active", isActive);
      btn.classList.toggle("locked", isLocked);
      btn.setAttribute("aria-pressed", String(isLocked));
    });

    document.body.classList.toggle("skill-filtering", Boolean(skill));
    document.body.classList.toggle("skill-filter-locked", Boolean(lockedSkill));

    timelineProjects.forEach(project => {
      const skills = (project.dataset.skills || "").split(/\s+/).filter(Boolean);
      const matched = Boolean(skill && skills.includes(skill));
      project.classList.toggle("skill-match", matched);
    });
  }

  buttons.forEach(btn => {
    btn.addEventListener("mouseenter", () => {
      hoverSkill = btn.dataset.skill;
      setVisualState();
    });

    btn.addEventListener("focus", () => {
      hoverSkill = btn.dataset.skill;
      setVisualState();
    });

    btn.addEventListener("click", e => {
      e.preventDefault();
      const skill = btn.dataset.skill;
      lockedSkill = lockedSkill === skill ? null : skill;
      hoverSkill = null;
      setVisualState();
    });
  });

  if (bar) {
    bar.addEventListener("mouseleave", () => {
      hoverSkill = null;
      setVisualState();
    });

    bar.addEventListener("focusout", e => {
      if (!bar.contains(e.relatedTarget)) {
        hoverSkill = null;
        setVisualState();
      }
    });
  }

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && lockedSkill) {
      lockedSkill = null;
      hoverSkill = null;
      setVisualState();
    }
  });
})();

/* Portfolio timeline rows: project points are visible from the initial screen. */
(function() {
  const timeline = document.querySelector(".timeline-screen.timeline-staged");
  if (!timeline) return;

  timeline.querySelectorAll(".grid-event.js-open-project")
    .forEach(event => event.classList.add("is-revealed"));

  timeline.querySelectorAll(".timeline-row.equal-row").forEach(row => {
    const phase = row.querySelector(".phase");
    if (!phase) return;
    row.classList.add("is-revealed-row");
    phase.removeAttribute("role");
    phase.removeAttribute("tabindex");
    phase.removeAttribute("aria-label");
  });
})();

$$("[data-close-project]").forEach(el => el.addEventListener("click", closeProjectModal));
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && activeProject) {
    if (projectImageZoomed) {
      setProjectImageZoom(false);
      return;
    }
    closeProjectModal();
  }
});

$$("[data-close-essay]").forEach(el => el.addEventListener("click", closeEssayModal));
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && activeEssayId) closeEssayModal();
});

$("#essayCommentForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!activeEssayId) return;

  const writerInput = $("#essayCommentWriter");
  const passwordInput = $("#essayCommentPassword");
  const companyInput = $("#essayCommentCompany");
  const bodyInput = $("#essayCommentBody");
  const submitButton = e.currentTarget.querySelector('button[type="submit"]');
  const writer = writerInput?.value.trim() || "익명";
  const password = passwordInput?.value.trim() || "";
  const company = companyInput?.value.trim() || "";
  const body = bodyInput?.value.trim() || "";
  if (!body || !password) return;

  submitButton.disabled = true;
  try {
    await postEssayComment({ writer, body, password, company });
    if (writerInput) writerInput.value = "";
    if (passwordInput) passwordInput.value = "";
    if (companyInput) companyInput.value = "";
    if (bodyInput) bodyInput.value = "";
  } catch (error) {
    window.alert(error.message || "댓글을 등록하지 못했습니다.");
  } finally {
    submitButton.disabled = false;
  }
});

$("#essayCommentList")?.addEventListener("click", e => {
  const deleteButton = e.target.closest("[data-comment-delete]");
  if (deleteButton && activeEssayId) {
    const commentId = deleteButton.dataset.commentDelete;
    const password = window.prompt("댓글 작성 시 입력한 삭제용 비밀번호를 입력해 주세요.");
    if (!password) return;
    deleteEssayComment(commentId, password).catch(error => {
      window.alert(error.message || "댓글을 삭제하지 못했습니다.");
    });
    return;
  }

  const button = e.target.closest("[data-reply-toggle]");
  if (!button || !activeEssayId) return;
  const parentId = button.dataset.replyToggle;
  activeReplyPath = activeReplyPath === parentId ? null : parentId;
  renderEssayComments();
});

$("#essayCommentList")?.addEventListener("submit", async e => {
  const form = e.target.closest(".essay-reply-form");
  if (!form || !activeEssayId) return;
  e.preventDefault();

  const parentId = form.dataset.replyForm;
  const writer = form.querySelector("[data-reply-writer]")?.value.trim() || "익명";
  const password = form.querySelector("[data-reply-password]")?.value.trim() || "";
  const company = form.querySelector("[data-reply-company]")?.value.trim() || "";
  const body = form.querySelector("[data-reply-body]")?.value.trim() || "";
  if (!body || !password || !parentId) return;

  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    await postEssayComment({ writer, body, password, parentId, company });
    activeReplyPath = null;
  } catch (error) {
    window.alert(error.message || "답글을 등록하지 못했습니다.");
  } finally {
    submitButton.disabled = false;
  }
});

/* project board memo → Supabase 저장 (비공개 의견함) */
(function() {
  const form = document.querySelector("#projectMemoForm");
  if (!form) return;
  const statusEl = document.querySelector("#memoStatus");

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.classList.toggle("is-error", Boolean(isError));
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();

    const writer = document.querySelector("#memoWriter")?.value.trim() || "익명";
    const title = document.querySelector("#memoTitle")?.value.trim() || "";
    const body = document.querySelector("#memoBody")?.value.trim() || "";
    const company = document.querySelector("#memoCompany")?.value || ""; // 허니팟

    if (!title || !body) {
      setStatus("제목과 내용을 입력해 주세요.", true);
      return;
    }

    const submitBtn = form.querySelector(".memo-submit");
    if (submitBtn) submitBtn.disabled = true;
    setStatus("전송 중…", false);

    try {
      const response = await fetch(apiUrl("/api/memos"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ writer, title, body, company })
      });
      if (response.ok) {
        form.reset();
        setStatus("메모가 전달되었습니다. 감사합니다.", false);
      } else if (response.status === 429) {
        setStatus("잠시 후 다시 시도해 주세요.", true);
      } else {
        setStatus("전송에 실패했습니다. 잠시 후 다시 시도해 주세요.", true);
      }
    } catch {
      setStatus("네트워크 오류로 전송하지 못했습니다.", true);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
})();

/* topbar mail and kakao functions */
(function() {
  function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(() => {});
    } else {
      const temp = document.createElement("textarea");
      temp.value = text;
      temp.style.position = "fixed";
      temp.style.left = "-9999px";
      document.body.appendChild(temp);
      temp.focus();
      temp.select();
      try { document.execCommand("copy"); } catch(e) {}
      temp.remove();
    }
  }

  const mailBtn = document.querySelector(".js-mail-contact");
  const mailModal = document.querySelector("#mailContactModal");
  const mailIdText = document.querySelector("#mailIdText");
  const copyMailBtn = document.querySelector("#copyMailId");
  const closeMailBtns = document.querySelectorAll(".js-close-mail");

  function copyMailId() {
    const id = mailBtn?.dataset.mailId || mailIdText?.textContent?.trim() || "band17dal@gmail.com";
    copyToClipboard(id);
    if (copyMailBtn) {
      const old = copyMailBtn.textContent;
      copyMailBtn.textContent = "복사 완료";
      setTimeout(() => copyMailBtn.textContent = old, 1200);
    }
  }

  function openMailMenu() {
    const id = mailBtn?.dataset.mailId || "band17dal@gmail.com";
    if (mailIdText) mailIdText.textContent = id;
    copyMailId();
    mailModal?.classList.add("open");
    mailModal?.setAttribute("aria-hidden", "false");
  }

  function closeMailMenu() {
    mailModal?.classList.remove("open");
    mailModal?.setAttribute("aria-hidden", "true");
  }

  mailBtn?.addEventListener("click", () => {
    /* href mailto handles the actual mail client opening; we don't preventDefault */
    openMailMenu();
  });

  copyMailBtn?.addEventListener("click", copyMailId);
  closeMailBtns.forEach(btn => btn.addEventListener("click", closeMailMenu));

  const kakaoBtn = document.querySelector(".js-kakao-friend");
  const kakaoModal = document.querySelector("#kakaoFriendModal");
  const kakaoIdText = document.querySelector("#kakaoIdText");
  const copyBtn = document.querySelector("#copyKakaoId");
  const closeBtns = document.querySelectorAll(".js-close-kakao");

  function copyKakaoId() {
    const id = kakaoBtn?.dataset.kakaoId || kakaoIdText?.textContent?.trim() || "black_star17@naver.com";
    copyToClipboard(id);
    if (copyBtn) {
      const old = copyBtn.textContent;
      copyBtn.textContent = "복사 완료";
      setTimeout(() => copyBtn.textContent = old, 1200);
    }
  }

  function openKakaoMenu() {
    const id = kakaoBtn?.dataset.kakaoId || "black_star17@naver.com";
    if (kakaoIdText) kakaoIdText.textContent = id;
    copyKakaoId();
    kakaoModal?.classList.add("open");
    kakaoModal?.setAttribute("aria-hidden", "false");
  }

  function closeKakaoMenu() {
    kakaoModal?.classList.remove("open");
    kakaoModal?.setAttribute("aria-hidden", "true");
  }

  kakaoBtn?.addEventListener("click", e => {
    e.preventDefault();
    openKakaoMenu();
  });

  copyBtn?.addEventListener("click", copyKakaoId);
  closeBtns.forEach(btn => btn.addEventListener("click", closeKakaoMenu));

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      closeKakaoMenu();
      closeMailMenu();
    }
  });
})();

function initStoryV6() {
  const coords = {};
  $$(".v6-place").forEach(place => {
    coords[place.dataset.place] = {
      x: place.style.getPropertyValue("--x"),
      y: place.style.getPropertyValue("--y")
    };
  });
  const rows = $$(".moving-v6-table button");
  const homePin = $("#storyV6HomePin");
  const workPin = $("#storyV6WorkPin");
  const homeLabel = $("#storyV6HomeLabel");
  const workLabel = $("#storyV6WorkLabel");
  const yearLabel = $("#storyV6MoveYear");
  const routePath = $("#storyV6MovePath");
  const routeNodes = $("#storyV6MoveNodes");

  function offsetPercent(value, amount) {
    const number = parseFloat(value);
    return Number.isFinite(number) ? `${number + amount}%` : value;
  }

  function placePin(pin, place, offsetX = 0) {
    const coord = coords[place];
    if (!pin || !coord) {
      pin?.classList.remove("visible");
      return;
    }
    pin.style.left = offsetX ? offsetPercent(coord.x, offsetX) : coord.x;
    pin.style.top = coord.y;
    pin.classList.add("visible");
  }

  function coordPoint(place) {
    const coord = coords[place];
    if (!coord) return null;
    return {
      x: parseFloat(coord.x),
      y: parseFloat(coord.y)
    };
  }

  function rowPoint(row) {
    return coordPoint(row.dataset.home) || coordPoint(row.dataset.work);
  }

  function updateRoute(row) {
    if (!routePath || !routeNodes) return;
    const targetYear = Number(row.dataset.year);
    const points = rows
      .filter(item => Number(item.dataset.year) <= targetYear)
      .map(rowPoint)
      .filter(Boolean);
    const uniquePoints = points.filter((point, index, list) => {
      const prev = list[index - 1];
      return !prev || Math.abs(prev.x - point.x) > .2 || Math.abs(prev.y - point.y) > .2;
    });
    routePath.setAttribute("d", uniquePoints.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" "));
    routeNodes.innerHTML = uniquePoints.map(point => `<circle cx="${point.x}" cy="${point.y}" r="1.2"></circle>`).join("");
  }

  function activate(row) {
    rows.forEach(item => item.classList.toggle("active", item === row));
    const samePlace = row.dataset.home === row.dataset.work;
    placePin(homePin, row.dataset.home, samePlace ? -1.4 : 0);
    placePin(workPin, row.dataset.work, samePlace ? 1.4 : 0);
    updateRoute(row);
    if (homeLabel) homeLabel.textContent = row.dataset.homeLabel || "-";
    if (workLabel) workLabel.textContent = row.dataset.workLabel || "-";
    if (yearLabel) yearLabel.textContent = row.dataset.period || row.dataset.year || "";
  }

  rows.forEach(row => row.addEventListener("click", () => activate(row)));
  if (rows[0]) activate(rows[0]);

  $$(".story-v6-drag").forEach(scroller => {
    let down = false;
    let startX = 0;
    let left = 0;
    scroller.addEventListener("pointerdown", e => {
      down = true;
      startX = e.clientX;
      left = scroller.scrollLeft;
      scroller.classList.add("dragging");
      scroller.setPointerCapture?.(e.pointerId);
    });
    scroller.addEventListener("pointermove", e => {
      if (!down) return;
      scroller.scrollLeft = left - (e.clientX - startX);
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(type => {
      scroller.addEventListener(type, () => {
        down = false;
        scroller.classList.remove("dragging");
      });
    });
  });

  const storylineV6 = document.querySelector(".storyline-v6");
  const traceClasses = ["trace-education", "trace-moving", "trace-trials", "trace-leadership"];
  let storyTraceTimer = null;
  let storyScrollTimer = null;
  let storyLinkedTimer = null;
  let storyScrollFrame = null;
  let storyScrollTarget = null;
  let storyPausedScrollTarget = null;
  let restoreStoryScrollBehavior = null;
  let storyScrollActive = false;
  let storySuppressNextClick = false;
  const STORY_SCROLL_MAX_DURATION = 2940;
  const STORY_SCROLL_MIN_DURATION = 850;
  const STORY_SCROLL_MS_PER_PIXEL = 3;

  function getStoryScrollTargetY(element) {
    return window.scrollY + element.getBoundingClientRect().top - (window.innerHeight - element.offsetHeight) / 2;
  }

  function stopStoryScroll(options = {}) {
    if (options.pause && storyScrollTarget) storyPausedScrollTarget = storyScrollTarget;
    if (storyScrollFrame) cancelAnimationFrame(storyScrollFrame);
    storyScrollFrame = null;
    storyScrollTarget = null;
    storyScrollActive = false;
    if (restoreStoryScrollBehavior) {
      restoreStoryScrollBehavior();
      restoreStoryScrollBehavior = null;
    }
  }

  function slowScrollToElement(element) {
    stopStoryScroll();
    storyPausedScrollTarget = null;
    const root = document.documentElement;
    const previousRootBehavior = root.style.scrollBehavior;
    const previousBodyBehavior = document.body.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    document.body.style.scrollBehavior = "auto";
    restoreStoryScrollBehavior = () => {
      root.style.scrollBehavior = previousRootBehavior;
      document.body.style.scrollBehavior = previousBodyBehavior;
    };
    storyScrollTarget = element;
    storyScrollActive = true;
    const startY = window.scrollY;
    const targetY = getStoryScrollTargetY(element);
    const distance = targetY - startY;
    if (distance <= 4) {
      storyScrollTarget = null;
      storyScrollActive = false;
      if (restoreStoryScrollBehavior) {
        restoreStoryScrollBehavior();
        restoreStoryScrollBehavior = null;
      }
      return;
    }
    const duration = Math.min(STORY_SCROLL_MAX_DURATION, Math.max(STORY_SCROLL_MIN_DURATION, Math.abs(distance) * STORY_SCROLL_MS_PER_PIXEL));
    const startTime = performance.now();

    function step(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      if (!storyScrollActive) return;
      window.scrollTo({ top: startY + distance * progress, left: 0, behavior: "instant" });
      if (progress < 1) {
        storyScrollFrame = requestAnimationFrame(step);
      } else {
        storyScrollFrame = null;
        storyScrollTarget = null;
        storyScrollActive = false;
        if (restoreStoryScrollBehavior) {
          restoreStoryScrollBehavior();
          restoreStoryScrollBehavior = null;
        }
      }
    }

    storyScrollFrame = requestAnimationFrame(step);
  }

  function jumpToStoryCard(control) {
    const href = control.dataset.storyCard;
    const card = document.querySelector(href);
    if (!card) return;
    if (storyScrollActive && storyScrollTarget === card) {
      stopStoryScroll();
      return;
    }
    $$(".story-v6-card-strip a, .storyline-v6-years [data-story-card]").forEach(item => {
      item.classList.toggle("is-active", item === control || item === card);
    });
    if (storylineV6 && control.dataset.storyTrace) {
      storylineV6.classList.remove("is-tracing", ...traceClasses);
      void storylineV6.offsetWidth;
      storylineV6.classList.add("is-tracing", control.dataset.storyTrace);
      window.clearTimeout(storyTraceTimer);
      storyTraceTimer = window.setTimeout(() => {
        storylineV6.classList.remove("is-tracing", ...traceClasses);
      }, 920);
    }
    window.clearTimeout(storyScrollTimer);
    card.classList.add("is-linked");
    history.replaceState(null, "", href);
    slowScrollToElement(card);
    window.clearTimeout(storyLinkedTimer);
    storyLinkedTimer = window.setTimeout(() => {
      card.classList.remove("is-linked");
    }, 4400);
  }

  function handleStoryCardJumpEvent(e) {
    const control = e.target.closest(".storyline-v6-years [data-story-card]");
    if (!control) return;
    e.preventDefault();
    e.stopPropagation();
    if (storyScrollActive) {
      stopStoryScroll();
      return;
    }
    jumpToStoryCard(control);
  }

  function handleStoryScrollStopEvent(e) {
    const control = e.target.closest(".storyline-v6-years [data-story-card]");
    const interactive = e.target.closest(".story-v6-card-strip a, a, button, input, textarea, select, [role='button']");
    if (!storyScrollActive && !storyPausedScrollTarget && !control) return;
    if (storyPausedScrollTarget && !storyScrollActive && !control && interactive) {
      storyPausedScrollTarget = null;
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    storySuppressNextClick = true;
    window.setTimeout(() => {
      storySuppressNextClick = false;
    }, 120);
    if (storyScrollActive) {
      stopStoryScroll({ pause: true });
      return;
    }
    if (control) {
      jumpToStoryCard(control);
      return;
    }
    if (storyPausedScrollTarget) {
      const target = storyPausedScrollTarget;
      const targetY = getStoryScrollTargetY(target);
      if (targetY <= window.scrollY + 4) {
        storyPausedScrollTarget = null;
        return;
      }
      slowScrollToElement(target);
    }
  }

  function suppressStoryStopClick(e) {
    if (!storySuppressNextClick) return;
    storySuppressNextClick = false;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
  }

  document.addEventListener("pointerdown", handleStoryScrollStopEvent, true);
  document.addEventListener("click", suppressStoryStopClick, true);

  $$(".story-v6-card-strip a").forEach(link => {
    link.addEventListener("click", e => {
      const href = link.getAttribute("href");
      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      const cardHash = `#${link.id}`;
      $$(".story-v6-card-strip a, .storyline-v6-years [data-story-card]").forEach(item => {
        item.classList.toggle("is-active", item === link || item.dataset.storyCard === cardHash);
      });
      history.replaceState(null, "", href);
      scrollToTargetWithTopbar(target, "smooth");
    });
  });
}

initStoryV6();

/* ═══════════ Archiving 탭 ═══════════ */
(function initArchiving() {
  const $$ = (sel, ctx=document) => Array.from((ctx||document).querySelectorAll(sel));
  const $1 = (sel, ctx=document) => (ctx||document).querySelector(sel);

  // ── BLOCK 2: Portfolio 표 ──
  const pfTable = $1("#archPfTable");
  function parseStartYear(period) {
    const m = String(period).match(/(\d{4})/);
    return m ? parseInt(m[1], 10) : 0;
  }
  function renderPortfolio(filter) {
    if (!pfTable || typeof PROJECTS === "undefined") return;
    const list = (filter && filter !== "all")
      ? PROJECTS.filter(p => p.category === filter)
      : PROJECTS.slice();
    // 연도(최신순) 그룹화 — period 시작연도 기준
    const groups = {};
    list.forEach(p => {
      const y = p.period || "기타";
      (groups[y] = groups[y] || []).push(p);
    });
    const years = Object.keys(groups).sort((a,b) => parseStartYear(b) - parseStartYear(a));
    pfTable.innerHTML = "";
    years.forEach(year => {
      const g = document.createElement("div");
      g.className = "arch-pf-yeargroup";
      g.innerHTML = `
        <div class="arch-pf-year">${year}<span class="arch-pf-year-count">${groups[year].length}건</span></div>
        <div class="arch-pf-head">
          <span>분류</span><span>업무</span><span>주요내용</span><span>주요 성과</span>
        </div>`;
      groups[year].forEach(p => {
        const row = document.createElement("div");
        row.className = "arch-pf-rowitem js-open-project";
        row.dataset.project = p.id;
        const summary = p.description || p.short || "";
        row.innerHTML = `
          <span class="arch-pf-cat" data-cat="${escapeHtml(p.category)}">${escapeHtml(p.category)}</span>
          <span class="arch-pf-title">${escapeHtml(p.title)}<span class="arch-pf-title-short">${escapeHtml(p.short || "")}</span></span>
          <span class="arch-pf-summary">${escapeHtml(summary)}</span>
          <span class="arch-pf-metric">${escapeHtml(p.metric || "")}</span>`;
        g.appendChild(row);
      });
      pfTable.appendChild(g);
    });
    // 모달 연결 (기존 핸들러 재사용)
    $$(".js-open-project", pfTable).forEach(btn => {
      btn.addEventListener("click", () => {
        if (typeof openProjectModal === "function") openProjectModal(btn.dataset.project);
      });
    });
  }
  // 필터 버튼
  $$("#archPfFilters .arch-pf-filter").forEach(btn => {
    btn.addEventListener("click", () => {
      $$("#archPfFilters .arch-pf-filter").forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      renderPortfolio(btn.dataset.cat);
    });
  });
  renderPortfolio("all");

  // ── BLOCK 3: Essay 목록 ──
  const essayList = $1("#archEssayList");
  const essayTags = $1("#archEssayTags");
  const essayNav = $1("#archEssayNav");
  let archEssayActiveTag = null;
  const ESSAY_CATS = [
    ["publicBusiness", "公과 Business"],
    ["worldOutside", "세계 : The outside world"],
    ["others", "好不好, Like & Others"],
    ["thinkingEmotion", "私와 思, Thinking & Emotion"],
  ];
  function renderEssayArchiveTags() {
    if (!essayTags || typeof ESSAYS === "undefined") return;
    const tags = [...new Set(ESSAY_CATS.flatMap(([key]) => (ESSAYS[key] || []).flatMap(item => Array.isArray(item[4]) ? item[4] : [])))];
    essayTags.innerHTML = [
      `<button type="button" class="arch-essay-tag-filter${archEssayActiveTag ? "" : " is-active"}" data-arch-essay-tag="">#전체</button>`,
      ...tags.map(tag => `<button type="button" class="arch-essay-tag-filter${archEssayActiveTag === tag ? " is-active" : ""}" data-arch-essay-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`)
    ].join("");
  }
  function enableArchEssayBoardSwipe(board) {
    if (!board || board.dataset.dragReady === "true") return;
    board.dataset.dragReady = "true";
    let isDown = false;
    let moved = false;
    let startY = 0;
    let scrollTop = 0;
    let captured = false;

    board.addEventListener("pointerdown", e => {
      if (e.button !== undefined && e.button !== 0) return;
      isDown = true;
      moved = false;
      captured = false;
      startY = e.clientY;
      scrollTop = board.scrollTop;
    });

    board.addEventListener("pointermove", e => {
      if (!isDown) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 4) {
        moved = true;
        // 실제 드래그가 시작된 순간에만 캡처(단순 클릭은 캡처 안 함 → 클릭 정상 동작)
        if (!captured) {
          board.classList.add("dragging");
          board.setPointerCapture?.(e.pointerId);
          captured = true;
        }
      }
      if (moved) board.scrollTop = scrollTop - dy;
    });

    function endDrag() {
      if (!isDown) return;
      isDown = false;
      board.classList.remove("dragging");
      if (moved) {
        board.dataset.suppressClick = "true";
        window.setTimeout(() => { board.dataset.suppressClick = ""; }, 80);
      }
    }

    board.addEventListener("pointerup", endDrag);
    board.addEventListener("pointercancel", endDrag);
    board.addEventListener("pointerleave", endDrag);
    board.addEventListener("click", e => {
      // 실제 드래그 직후의 클릭만 억제. 단순 클릭은 통과시켜 모달이 열리게 함.
      if (board.dataset.suppressClick === "true") {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      }
    }, true);
  }
  function renderEssays() {
    if (!essayList || typeof ESSAYS === "undefined") return;
    essayList.innerHTML = "";
    renderEssayArchiveTags();
    ESSAY_CATS.forEach(([key, label]) => {
      const sourceItems = ESSAYS[key] || [];
      const items = archEssayActiveTag
        ? sourceItems.filter(item => (item[4] || []).includes(archEssayActiveTag))
        : sourceItems;
      if (!items || !items.length) return;
      const cat = document.createElement("div");
      cat.className = "arch-essay-cat";
      cat.id = `archEssayCat-${key}`;
      cat.dataset.archEssayCat = key;
      cat.innerHTML = `<div class="arch-essay-cat-head">${label}</div><div class="arch-essay-board" data-arch-essay-board></div>`;
      const board = cat.querySelector("[data-arch-essay-board]");
      items.forEach(item => {
        // item: [id, tagLabel, title, desc, [tags]]
        const [id, , title, desc] = item;
        const essay = typeof essayToObject === "function" ? essayToObject(item) : { date: item[5] || "날짜 미정", tags: item[4] || [] };
        const row = document.createElement("div");
        row.className = "arch-essay-item js-open-essay";
        row.dataset.essayId = id;
        const tags = (essay.tags || []).map(tag => `#${tag}`).join(" ");
        row.innerHTML = `
          <span class="arch-essay-tag">${label.split(/[ ,:]/)[0]}</span>
          <span class="arch-essay-body">
            <span class="arch-essay-title">${escapeHtml(title)}</span>
            <span class="arch-essay-desc">${escapeHtml(desc || "")}</span>
            <span class="arch-essay-hashes" title="${escapeHtml(tags)}">${escapeHtml(tags)}</span>
          </span>`;
        row._essayItem = item;
        board.appendChild(row);
      });
      essayList.appendChild(cat);
      enableArchEssayBoardSwipe(board);
    });
    // 모달 연결: 개별 바인딩 대신 컨테이너 이벤트 위임(재렌더돼도 안 끊김)
    // 위임은 renderEssays 밖에서 1회만 등록(아래 ensureArchEssayDelegation).
  }

  // essayList에 클릭 위임을 단 한 번만 등록 (renderEssays 재호출에도 유지)
  let archEssayDelegationBound = false;
  function ensureArchEssayDelegation() {
    if (archEssayDelegationBound || !essayList) return;
    archEssayDelegationBound = true;
    essayList.addEventListener("click", e => {
      const row = e.target.closest(".js-open-essay");
      if (!row) return;
      if (typeof openEssayModal !== "function" || typeof createEssayCard !== "function") return;
      // _essayItem 우선, 없으면 essayId로 ESSAYS에서 찾아 폴백
      let item = row._essayItem;
      if (!item && row.dataset.essayId && typeof ESSAYS !== "undefined") {
        for (const key of Object.keys(ESSAYS)) {
          const found = (ESSAYS[key] || []).find(it => it[0] === row.dataset.essayId);
          if (found) { item = found; break; }
        }
      }
      if (item) openEssayModal(createEssayCard(item));
    });
  }
  ensureArchEssayDelegation();
  essayTags?.addEventListener("click", e => {
    const button = e.target.closest("[data-arch-essay-tag]");
    if (!button) return;
    archEssayActiveTag = button.dataset.archEssayTag || null;
    renderEssays();
  });
  renderEssays();
  // Supabase 에세이 hydrate 이후 archiving 목록도 갱신할 수 있게 외부 노출
  window.refreshArchEssays = renderEssays;
  essayNav?.addEventListener("click", e => {
    const button = e.target.closest("[data-arch-essay-target]");
    if (!button || !essayList) return;
    const target = $1(`#archEssayCat-${button.dataset.archEssayTarget}`);
    if (!target) return;
    $$(".arch-essay-nav-btn", essayNav).forEach(btn => btn.classList.toggle("is-active", btn === button));
    scrollToTargetWithTopbar(target, "smooth");
  });

  // ── 블록 네비게이션 ──
  const archNav = $1("#taste .arch-blocknav");
  const navBtns = archNav ? $$(".arch-blocknav-btn", archNav) : [];
  const blocks = navBtns.map(b => $1("#" + b.dataset.archTarget)).filter(Boolean);
  navBtns.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const target = $1("#" + btn.dataset.archTarget);
      scrollToTargetWithTopbar(target, "smooth");
    });
  });
  // 스크롤 시 현재 블록 하이라이트
  if ("IntersectionObserver" in window && blocks.length) {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          const id = en.target.id;
          navBtns.forEach(b => b.classList.toggle("is-active", b.dataset.archTarget === id));
        }
      });
    }, { rootMargin: "-40% 0px -55% 0px", threshold: 0 });
    blocks.forEach(b => obs.observe(b));
  }
})();

/* ── Story 탭 블록 네비게이션 ── */
(function initStoryBlockNav() {
  const nav = document.querySelector(".story-blocknav");
  if (!nav) return;
  const navBtns = Array.from(nav.querySelectorAll(".arch-blocknav-btn"));
  const blocks = navBtns.map(b => document.getElementById(b.dataset.archTarget)).filter(Boolean);
  navBtns.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const target = document.getElementById(btn.dataset.archTarget);
      scrollToTargetWithTopbar(target, "smooth");
    });
  });
  if ("IntersectionObserver" in window && blocks.length) {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          const id = en.target.id;
          navBtns.forEach(b => b.classList.toggle("is-active", b.dataset.archTarget === id));
        }
      });
    }, { rootMargin: "-40% 0px -55% 0px", threshold: 0 });
    blocks.forEach(b => obs.observe(b));
  }
})();

/* ── Trial: 연도 타임라인 재생 (시련=칸단위, life막대=진행도 동기화) ── */
(function initTrialsInteraction() {
  const scroll = document.getElementById("trialsHScroll");
  if (!scroll) return;

  const Y0 = 1995, Y1 = 2026;
  const PLAY_DURATION = 21000;
  const EVENT_BOX_DELAY = 160;
  const EVENT_TEXT_DELAY = 340;
  const EVENT_STEP_DELAY = 120;
  const SCROLL_HOLD = 3800;

  // 시련 셀: data-year 기준으로 연도별 그룹화
  const trialCells = Array.from(scroll.querySelectorAll(".trials-h-cell[data-year]"))
    .filter(c => c.textContent.trim().length > 0)
    .map((c, index) => ({
      el: c,
      year: +c.dataset.year,
      lane: Array.from(scroll.querySelectorAll(".trials-h-lane")).indexOf(c.closest(".trials-h-lane")),
      index
    }))
    .sort((a, b) => (a.year - b.year) || (a.lane - b.lane) || (a.index - b.index));

  // life 막대: from~to 범위
  const lifeBars = Array.from(scroll.querySelectorAll(".trials-h-lifebar[data-from]"))
    .map(b => ({ el: b, from: +b.dataset.from, to: +b.dataset.to }));

  let playing = false;
  let paused = false;
  let isDown = false, startX = 0, startScroll = 0, dragMoved = false;
  let playFrame = null;
  let playTimers = [];
  let playElapsed = 0;
  let playStartedAt = 0;
  let playMaxLeft = 0;

  function progressForYear(year) {
    return Math.max(0, Math.min(1, (year - Y0) / (Y1 - Y0)));
  }

  function resetAll() {
    playTimers.forEach(timer => clearTimeout(timer));
    playTimers = [];
    if (playFrame) {
      cancelAnimationFrame(playFrame);
      playFrame = null;
    }
    trialCells.forEach(({ el }) => el.classList.remove("is-box-visible", "revealed"));
    lifeBars.forEach(({ el }) => {
      el.classList.remove("revealed", "label-visible");
      el.style.setProperty("--fill", "0");
    });
    playElapsed = 0;
    paused = false;
  }

  function setLifeProgress(currentYear) {
    lifeBars.forEach(({ el, from, to }) => {
      if (currentYear < from) {
        el.classList.remove("revealed", "label-visible");
        el.style.setProperty("--fill", "0");
        return;
      }
      const endYear = to + 1;
      const span = Math.max(1, endYear - from);
      const ratio = currentYear >= endYear ? 1 : Math.max(0, Math.min(1, (currentYear - from) / span));
      const labelThreshold = .92;
      el.classList.add("revealed");
      el.classList.toggle("label-visible", ratio >= labelThreshold);
      el.style.setProperty("--fill", ratio.toFixed(3));
    });
  }

  function queueEvents(offset = 0) {
    playTimers.forEach(timer => clearTimeout(timer));
    playTimers = [];
    const usableDuration = PLAY_DURATION - EVENT_BOX_DELAY - EVENT_TEXT_DELAY - 720;
    let nextAvailable = EVENT_BOX_DELAY;
    trialCells.forEach(({ el, year }) => {
      const naturalTime = EVENT_BOX_DELAY + progressForYear(year) * usableDuration;
      const eventTime = Math.max(naturalTime, nextAvailable);
      const textTime = eventTime + EVENT_TEXT_DELAY;
      nextAvailable = textTime + EVENT_STEP_DELAY;
      if (offset >= eventTime) {
        el.classList.add("is-box-visible");
      } else {
        const boxTimer = setTimeout(() => {
          el.classList.add("is-box-visible");
        }, eventTime - offset);
        playTimers.push(boxTimer);
      }
      if (offset >= textTime) {
        el.classList.add("revealed");
      } else {
        const textTimer = setTimeout(() => el.classList.add("revealed"), textTime - offset);
        playTimers.push(textTimer);
      }
    });
  }

  function startLoop() {
    playStartedAt = performance.now();
    function step(now) {
      const elapsed = Math.min(PLAY_DURATION, playElapsed + now - playStartedAt);
      const progress = Math.min(1, elapsed / PLAY_DURATION);
      const currentYear = Y0 + (Y1 - Y0 + 1) * progress;
      const scrollProgress = Math.max(0, Math.min(1, (elapsed - SCROLL_HOLD) / (PLAY_DURATION - SCROLL_HOLD)));
      setLifeProgress(currentYear);
      scroll.scrollLeft = playMaxLeft * scrollProgress;

      if (progress < 1) {
        playFrame = requestAnimationFrame(step);
      } else {
        playFrame = null;
        playTimers.push(setTimeout(() => {
          playing = false;
          paused = false;
          playElapsed = 0;
        }, EVENT_TEXT_DELAY + EVENT_STEP_DELAY));
      }
    }

    playFrame = requestAnimationFrame(step);
  }

  function pauseReveal() {
    if (!playing) return;
    playElapsed = Math.min(PLAY_DURATION, playElapsed + performance.now() - playStartedAt);
    if (playFrame) {
      cancelAnimationFrame(playFrame);
      playFrame = null;
    }
    playTimers.forEach(timer => clearTimeout(timer));
    playTimers = [];
    playing = false;
    paused = true;
  }

  function resumeReveal() {
    if (!paused) return;
    playing = true;
    paused = false;
    queueEvents(playElapsed);
    startLoop();
  }

  function playReveal() {
    if (playing) {
      pauseReveal();
      return;
    }
    if (paused) {
      resumeReveal();
      return;
    }
    playing = true;
    resetAll();
    scroll.scrollLeft = 0;
    playMaxLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    queueEvents(0);
    startLoop();
  }

  // 블록 어느 영역을 클릭해도 재생
  scroll.addEventListener("click", () => {
    if (dragMoved) { dragMoved = false; return; }
    playReveal();
  });

  // ── 클릭-드래그 스와이프 ──
  scroll.addEventListener("pointerdown", e => {
    isDown = true; dragMoved = false;
    startX = e.clientX; startScroll = scroll.scrollLeft;
    scroll.classList.add("dragging");
    scroll.setPointerCapture(e.pointerId);
  });
  scroll.addEventListener("pointermove", e => {
    if (!isDown) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 4) dragMoved = true;
    scroll.scrollLeft = startScroll - dx;
  });
  function endDrag(e) {
    if (!isDown) return;
    isDown = false;
    scroll.classList.remove("dragging");
    try { scroll.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  scroll.addEventListener("pointerup", endDrag);
  scroll.addEventListener("pointercancel", endDrag);
})();


