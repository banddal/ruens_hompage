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

const DEFAULT_API_ORIGIN = "https://ruens-hompage.onrender.com";
const TEAM_POSITION_LABELS = {
  director: "Directer",
  pm: "PM",
  member: "Member",
  independent: "Independent"
};
const API_BASE = (() => {
  const configured = window.HOMO_RUENS_API_BASE || "";
  if (configured) return configured.replace(/\/+$/, "");
  const host = window.location.hostname || "";
  if (host === "ruens-hompage.onrender.com") return "";
  return DEFAULT_API_ORIGIN;
})();
const backendProjectCache = new Map();

let activeEssayId = null;
let activeReplyPath = null;
const activeEssayTags = {
  publicBusiness: null,
  worldOutside: null,
  thinkingEmotion: null,
  others: null
};
const ESSAY_COMMENT_STORAGE_KEY = "homoRuensEssayComments";
const essayComments = loadEssayComments();

function escapeHtml(v) {
  return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
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

function cacheProject(project) {
  if (!project?.id) return project;
  backendProjectCache.set(project.id, project);
  if (project.slug) backendProjectCache.set(project.slug, project);
  return project;
}

function getStaticProject(projectId) {
  return PROJECTS.find(item => item.id === projectId || item.slug === projectId);
}

function getCachedProject(projectId) {
  return backendProjectCache.get(projectId) || getStaticProject(projectId);
}

function loadEssayComments() {
  try {
    return JSON.parse(localStorage.getItem(ESSAY_COMMENT_STORAGE_KEY) || "{}");
  } catch(e) {
    return {};
  }
}

function saveEssayComments() {
  try {
    localStorage.setItem(ESSAY_COMMENT_STORAGE_KEY, JSON.stringify(essayComments));
  } catch(e) {}
}

function normalizeEssayComment(comment) {
  return {
    writer: comment?.writer || "익명",
    body: comment?.body || "",
    replies: Array.isArray(comment?.replies) ? comment.replies.map(normalizeEssayComment) : []
  };
}

function getEssayCommentByPath(comments, path) {
  return String(path).split(".").reduce((items, part, idx, parts) => {
    const comment = Array.isArray(items) ? items[Number(part)] : null;
    if (!comment) return null;
    return idx === parts.length - 1 ? comment : comment.replies;
  }, comments);
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

function essayToObject(item) {
  const fullText = ESSAY_FULL_TEXTS[item[0]];
  const bodyBlocks = fullText
    ? fullText.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
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
    body: bodyBlocks
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
  btn.dataset.date = essay.date;
  btn.dataset.lead = essay.lead;
  btn.dataset.body = essay.body.join("\n\n");
  const tagHtml = essay.tags.length
    ? `<span class="essay-card-tags">${essay.tags.map(tag => `<small>${escapeHtml(tag)}</small>`).join("")}</span>`
    : "";
  btn.innerHTML = `
    <span class="front">
      <strong>${escapeHtml(essay.title)}</strong>
      ${tagHtml || `<span class="essay-card-tags" aria-hidden="true"></span>`}
      <em>${escapeHtml(essay.date)}</em>
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
    ? comments.map((comment, idx) => renderEssayCommentNode(comment, String(idx), 0)).join("")
    : `<div class="essay-comment"><span>아직 댓글이 없습니다. 첫 댓글을 남겨주세요.</span></div>`;
}

function renderEssayCommentNode(comment, path, depth) {
  const replies = Array.isArray(comment.replies) ? comment.replies : [];
  const repliesHtml = replies.length
    ? `<div class="essay-replies">${replies.map((reply, idx) => renderEssayCommentNode(reply, `${path}.${idx}`, depth + 1)).join("")}</div>`
    : "";
  const nodeClass = depth ? "essay-comment essay-reply" : "essay-comment";
  return `<div class="${nodeClass}">
    <b>${escapeHtml(comment.writer || "익명")}</b>
    <span>${escapeHtml(comment.body || "")}</span>
    ${repliesHtml}
    <div class="essay-comment-actions">
      <button type="button" class="essay-reply-toggle" data-reply-toggle="${escapeHtml(path)}">${activeReplyPath === path ? "답글 닫기" : "답글 달기"}</button>
    </div>
    <form class="essay-reply-form" data-reply-form="${escapeHtml(path)}" ${activeReplyPath === path ? "" : "hidden"}>
      <input type="text" data-reply-writer placeholder="이름" required>
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
  const bodyHtml = rawBody
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
  $("#essayModalBody").innerHTML = imageHtml + bodyHtml;
  renderEssayComments();
  $("#essayModal").classList.add("open");
  $("#essayModal").setAttribute("aria-hidden", "false");
  document.body.classList.add("lock");
}

function closeEssayModal() {
  $("#essayModal").classList.remove("open");
  $("#essayModal").setAttribute("aria-hidden", "true");
  document.body.classList.remove("lock");
  activeEssayId = null;
  activeReplyPath = null;
}

renderEssayCards();
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
    if (Array.isArray(projects)) projects.forEach(cacheProject);
  } catch (error) {
    console.warn("Project index API failed:", error);
  }
}

function renderProjectUploads(project) {
  const root = $("#projectUploads");
  const strip = $("#projectAttachmentStrip");
  const images = Array.isArray(project?.images) ? project.images : [];
  const files = Array.isArray(project?.files) ? project.files.filter(file => file.visibility !== "private") : [];
  const visibleImages = images.filter(image => image.publicUrl || image.path);

  const fileHtml = `
    <section class="project-upload-section">
      <h4>첨부파일</h4>
      <div class="project-upload-files">
        ${files.length ? files.map(file => {
          const href = file.publicUrl || file.path || "";
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
  
  const skillLabels = (p.skillTags || []).map(t => SKILLSET_LABELS[t] || t);
  $("#projectMetric").innerHTML = (skillLabels.length ? skillLabels : [p.category || "Project"])
    .slice(0, 4)
    .map(label => `<span class="tag skill-tag">${escapeHtml(label)}</span>`)
    .join("");
  const teamPositions = Array.isArray(p.teamPositions) && p.teamPositions.length
    ? p.teamPositions
    : [];
  $("#projectTags").innerHTML = Object.entries(TEAM_POSITION_LABELS).map(([value, label]) => {
    const active = teamPositions.includes(value);
    return `<span class="team-position-chip${active ? " active" : ""}">${escapeHtml(label)}</span>`;
  }).join("");

  $("#thumbs").innerHTML = "";
  const uploadedImages = Array.isArray(p.images) ? p.images
    .filter(image => image.publicUrl || image.path)
    .map((image, imageIndex) => {
      const caption = cleanAssetText(image.caption);
      const description = cleanAssetText(image.description);
      const alt = cleanAssetText(image.alt);
      return {
        kind: "image",
        type: "사진 설명",
        title: "",
        desc: caption || description || "",
        src: image.publicUrl || image.path,
        alt: alt || caption || p.title || `Project image ${imageIndex + 1}`
      };
    }) : [];
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
      btn.addEventListener("click", () => renderProjectImageAt(i));
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
  } else if (activeProject) {
    const strip = $("#projectAttachmentStrip");
    if (strip && API_BASE) {
      strip.insertAdjacentHTML("afterbegin", `<span class="project-attachment-empty">백엔드 상세 데이터를 불러오지 못했습니다. API 주소를 확인해 주세요.</span>`);
    }
  }
}

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
  caption.textContent = `${safeIndex + 1} / ${total}`;
  if (prev) prev.disabled = total < 2;
  if (next) next.disabled = total < 2;
  renderAssetText(image, safeIndex);
  $$("#thumbs .thumb").forEach((t, i) => t.classList.toggle("active", i === safeIndex));
}

function setProjectImageZoom(zoomed) {
  projectImageZoomed = Boolean(zoomed && projectGalleryImages.length);
  $("#projectModal")?.classList.toggle("image-zoomed", projectImageZoomed);
}

function toggleProjectImageZoom() {
  if (!projectGalleryImages.length) return;
  setProjectImageZoom(!projectImageZoomed);
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

/* staged reveal for Portfolio timeline rows */
(function() {
  const timeline = document.querySelector(".timeline-screen.timeline-staged");
  if (!timeline) return;

  let revealTimers = [];

  function clearRevealTimers() {
    revealTimers.forEach(timer => window.clearTimeout(timer));
    revealTimers = [];
  }

  function timelineEventsForRow(row) {
    const years = Array.from(row.querySelectorAll(".year-header span")).map(item => item.textContent.trim());
    const events = [];

    years.forEach(year => {
      row.querySelectorAll(`.lane.main .year-cell[data-year="${year}"] .grid-event.js-open-project`)
        .forEach(event => events.push(event));
      row.querySelectorAll(`.lane.side .year-cell[data-year="${year}"] .grid-event.js-open-project`)
        .forEach(event => events.push(event));
    });

    return events;
  }

  function revealTimelineRow(row) {
    const events = timelineEventsForRow(row).filter(event => !event.classList.contains("is-revealed"));
    clearRevealTimers();
    row.classList.add("is-revealing");

    if (!events.length) {
      row.classList.remove("is-revealing");
      row.classList.add("is-revealed-row");
      return;
    }

    events.forEach((event, index) => {
      const timer = window.setTimeout(() => {
        event.classList.add("is-revealed");
        if (index === events.length - 1) {
          row.classList.remove("is-revealing");
          row.classList.add("is-revealed-row");
        }
      }, index * 260);
      revealTimers.push(timer);
    });
  }

  timeline.querySelectorAll(".timeline-row.equal-row").forEach(row => {
    const phase = row.querySelector(".phase");
    if (!phase) return;
    phase.setAttribute("role", "button");
    phase.setAttribute("tabindex", "0");
    phase.setAttribute("aria-label", `${phase.querySelector("strong")?.textContent.trim() || "Timeline phase"} 프로젝트 순차 보기`);

    phase.addEventListener("click", () => revealTimelineRow(row));
    phase.addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      revealTimelineRow(row);
    });
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

$("#essayCommentForm")?.addEventListener("submit", e => {
  e.preventDefault();
  if (!activeEssayId) return;

  const writerInput = $("#essayCommentWriter");
  const bodyInput = $("#essayCommentBody");
  const writer = writerInput?.value.trim() || "익명";
  const body = bodyInput?.value.trim() || "";
  if (!body) return;

  essayComments[activeEssayId] = essayComments[activeEssayId] || [];
  essayComments[activeEssayId].push({ writer, body, replies: [] });
  saveEssayComments();
  if (writerInput) writerInput.value = "";
  if (bodyInput) bodyInput.value = "";
  renderEssayComments();
});

$("#essayCommentList")?.addEventListener("click", e => {
  const button = e.target.closest("[data-reply-toggle]");
  if (!button || !activeEssayId) return;
  const path = button.dataset.replyToggle;
  activeReplyPath = activeReplyPath === path ? null : path;
  renderEssayComments();
});

$("#essayCommentList")?.addEventListener("submit", e => {
  const form = e.target.closest(".essay-reply-form");
  if (!form || !activeEssayId) return;
  e.preventDefault();

  const path = form.dataset.replyForm;
  const comments = essayComments[activeEssayId] || [];
  const targetComment = getEssayCommentByPath(comments, path);
  if (!targetComment) return;

  const writer = form.querySelector("[data-reply-writer]")?.value.trim() || "익명";
  const body = form.querySelector("[data-reply-body]")?.value.trim() || "";
  if (!body) return;

  targetComment.replies = Array.isArray(targetComment.replies) ? targetComment.replies : [];
  targetComment.replies.push({ writer, body, replies: [] });
  activeReplyPath = null;
  saveEssayComments();
  renderEssayComments();
});

/* project board memo mailto */
(function() {
  const form = document.querySelector("#projectMemoForm");
  if (!form) return;

  form.addEventListener("submit", e => {
    e.preventDefault();

    const writer = document.querySelector("#memoWriter")?.value.trim() || "익명";
    const title = document.querySelector("#memoTitle")?.value.trim() || "프로젝트 메모";
    const body = document.querySelector("#memoBody")?.value.trim() || "";

    const subject = `[Homo Ruens Memo] ${title}`;
    const mailBody = [
      `작성자: ${writer}`,
      `제목: ${title}`,
      "",
      "내용:",
      body,
      "",
      "※ 메시지 보내기 버튼을 누르면 입력 정보의 수집·이용에 동의한 것으로 간주한다는 안내 문구를 확인했습니다."
    ].join("\n");

    window.location.href = `mailto:band17dal@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(mailBody)}`;
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
          <span>분류</span><span>업무</span><span>전달처</span><span>주요 성과</span>
        </div>`;
      groups[year].forEach(p => {
        const row = document.createElement("div");
        row.className = "arch-pf-rowitem js-open-project";
        row.dataset.project = p.id;
        row.innerHTML = `
          <span class="arch-pf-cat" data-cat="${p.category}">${p.category}</span>
          <span class="arch-pf-title">${p.title}<span class="arch-pf-title-short">${p.short || ""}</span></span>
          <span class="arch-pf-to">—</span>
          <span class="arch-pf-metric">${p.metric || ""}</span>`;
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
    ["others", "好不好 , Like & Others"],
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

    board.addEventListener("pointerdown", e => {
      if (e.button !== undefined && e.button !== 0) return;
      isDown = true;
      moved = false;
      startY = e.clientY;
      scrollTop = board.scrollTop;
      board.classList.add("dragging");
      board.setPointerCapture?.(e.pointerId);
    });

    board.addEventListener("pointermove", e => {
      if (!isDown) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 4) moved = true;
      board.scrollTop = scrollTop - dy;
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
        row.innerHTML = `
          <span class="arch-essay-tag">${label.split(/[ ,:]/)[0]}</span>
          <span class="arch-essay-body">
            <span class="arch-essay-title">${title}</span>
            <span class="arch-essay-meta"><span class="arch-essay-date">${essay.date}</span><span class="arch-essay-hashes">${essay.tags.map(tag => `<span class="arch-essay-hash">#${tag}</span>`).join(" ")}</span></span>
          </span>`;
        row._essayItem = item;
        board.appendChild(row);
      });
      essayList.appendChild(cat);
      enableArchEssayBoardSwipe(board);
    });
    // 모달 연결
    $$(".js-open-essay", essayList).forEach(row => {
      row.addEventListener("click", () => {
        if (typeof openEssayModal === "function" && typeof createEssayCard === "function") {
          openEssayModal(createEssayCard(row._essayItem));
        }
      });
    });
  }
  essayTags?.addEventListener("click", e => {
    const button = e.target.closest("[data-arch-essay-tag]");
    if (!button) return;
    archEssayActiveTag = button.dataset.archEssayTag || null;
    renderEssays();
  });
  renderEssays();
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


