(function () {
  "use strict";

  const statusNames = { RECEIVED: "접수", CHECKING: "확인중", PROCESSING: "처리중", COMPLETED: "완료" };
  const statuses = Object.keys(statusNames);
  const list = document.querySelector("#admin-list");
  const summary = document.querySelector("#admin-summary");
  const notice = document.querySelector("#admin-notice");
  const filter = document.querySelector("#status-filter");
  const kindFilter = document.querySelector("#request-kind-filter");
  const deletedFilter = document.querySelector("#deleted-filter");
  const searchInput = document.querySelector("#request-search");
  const dateFrom = document.querySelector("#date-from");
  const dateTo = document.querySelector("#date-to");
  const sortOrder = document.querySelector("#sort-order");
  const pageSizeInput = document.querySelector("#page-size");
  const resultCount = document.querySelector("#admin-result-count");
  const pager = document.querySelector("#admin-pagination");
  const authForm = document.querySelector("#admin-auth");
  const workspace = document.querySelector("#admin-workspace");
  let requests = [];
  let currentPage = 1;
  sessionStorage.removeItem("bigDataHelpAdminKey"); // Do not retain legacy shared keys.
  let adminSessionToken = sessionStorage.getItem("bigDataHelpAdminSession") || "";

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("ko-KR", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      hour12: false, timeZone: "Asia/Seoul"
    }).format(date);
  }

  function renderSummary(visible) {
    const cards = [{key: "ALL", label: "전체", count: visible.length}].concat(statuses.map(key => ({
      key, label: statusNames[key], count: visible.filter(item => item.status === key).length
    })));
    summary.innerHTML = cards.map(item =>
      `<div class="summary-card"><span>${item.label}</span><strong>${item.count}</strong></div>`
    ).join("");
  }

  function reportInfo(item) {
  const source = String(item.content || "");
  const type = source.match(/^문제 유형: (실기문제|기술면접|기초 학습문제|기초학습문제|NCP 기출문제)$/m)?.[1];
  const id = source.match(/^문제 ID: ([A-Za-z0-9_-]{1,80})$/m)?.[1];
  const rawUrl = source.match(/^문제 화면: (https:\/\/[^\s]+)$/m)?.[1];
  if (!type || !id || !rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    const page = type === "실기문제" ? "/practical.html" : type === "기술면접" ? "/interview.html" : type === "NCP 기출문제" ? "/ncp.html" : "/coding.html";
    if (url.origin !== "https://portal.k-bigdata.kr" || url.pathname !== page || url.searchParams.get("id") !== id) return null;
    return { type, id, url: url.href, kind: type === "실기문제" ? "practical" : type === "기술면접" ? "interview" : type === "NCP 기출문제" ? "ncp" : "coding" };
  } catch (_) { return null; }
}

  function renderTicket(item) {
  const report = reportInfo(item);
  const safeLink = report ? `<p class="admin-report-link">학습문제 · ${escapeHtml(report.id)} <a href="${escapeHtml(report.url)}" target="_blank" rel="noopener noreferrer">해당 문제 열기 ↗</a></p>` : "";
  return `
      <details class="admin-ticket${item.isDeleted ? " admin-ticket--deleted" : ""}">
        <summary>
          <span class="badge badge--${escapeHtml(item.status.toLowerCase())}">${escapeHtml(statusNames[item.status] || item.status)}</span>
          <span class="admin-ticket__title">${escapeHtml(item.title)}</span>
          <span class="admin-ticket__meta">${escapeHtml(item.category)} · ${escapeHtml(item.location)} · ${escapeHtml(item.studentName)} · ${escapeHtml(formatDate(item.createdAt))}</span>
          ${item.isDeleted ? '<span class="deleted-label">삭제됨</span>' : ""}
        </summary>
        <div class="admin-ticket__body">
          <dl class="detail-grid">
            <div><dt>요청번호</dt><dd>${escapeHtml(item.requestId)}</dd></div>
            <div><dt>학생</dt><dd>${escapeHtml(item.studentName)} / ${escapeHtml(item.studentId)}</dd></div>
            <div><dt>요청 유형</dt><dd>${escapeHtml(item.category)}</dd></div>
            <div><dt>장소</dt><dd>${escapeHtml(item.location)}</dd></div>
            <div><dt>등록일</dt><dd>${escapeHtml(formatDate(item.createdAt))}</dd></div>
          </dl>
          ${safeLink}
          <div class="content-panel"><strong>상세 내용</strong><p>${escapeHtml(item.content)}</p></div>
          <form class="admin-update-form" data-id="${escapeHtml(item.requestId)}">
            <label>처리 상태<select name="status">${statuses.map(status => `<option value="${status}"${item.status === status ? " selected" : ""}>${statusNames[status]}</option>`).join("")}</select></label>
            <label>관리자 답변<textarea name="adminReply" maxlength="2000" rows="5" placeholder="학생에게 보여줄 답변을 입력하세요">${escapeHtml(item.adminReply || "")}</textarea></label>
            <button class="button button--primary button--small" type="submit"${item.isDeleted ? " disabled" : ""}>저장</button>
          </form>
        </div>
      </details>`;
}

  function localDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-US", {
      year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul"
    }).formatToParts(date);
    const part = type => parts.find(item => item.type === type)?.value || "";
    return part("year") + "-" + part("month") + "-" + part("day");
  }

  function filteredRequests() {
    const selected = filter.value;
    const kind = kindFilter.value;
    const scope = deletedFilter.value;
    const query = searchInput.value.trim().toLocaleLowerCase();
    const from = dateFrom.value;
    const to = dateTo.value;
    const direction = sortOrder.value === "oldest" ? 1 : -1;
    return requests.filter(item => {
      if (scope === "active" && item.isDeleted) return false;
      if (scope === "deleted" && !item.isDeleted) return false;
      if (selected !== "ALL" && item.status !== selected) return false;
      if (kind !== "ALL" && kind !== (reportInfo(item)?.kind || "other")) return false;
      const day = localDate(item.createdAt);
      if ((from && day < from) || (to && day > to)) return false;
      if (!query) return true;
      return [
        item.requestId, item.title, item.content, item.studentName, item.studentId,
        item.category, item.location
      ].some(value => String(value || "").toLocaleLowerCase().includes(query));
    }).sort((a, b) => direction * (
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
      String(a.requestId).localeCompare(String(b.requestId))
    ));
  }

  function renderList() {
    const visible = filteredRequests();
    renderSummary(visible);
    const pageSize = Math.max(1, Number(pageSizeInput.value) || 20);
    const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
    currentPage = Math.max(1, Math.min(currentPage, totalPages));
    const first = (currentPage - 1) * pageSize;
    const pageItems = visible.slice(first, first + pageSize);
    const groups = new Map();
    pageItems.forEach(item => {
      const report = reportInfo(item);
      const key = report ? `${report.kind}:${report.id}` : `ticket:${item.requestId}`;
      if (!groups.has(key)) groups.set(key, {report, items: []});
      groups.get(key).items.push(item);
    });
    list.innerHTML = pageItems.length ? Array.from(groups.values()).map(group => {
      const tickets = group.items.map(renderTicket).join("");
      if (!group.report) return tickets;
      return `<section class="admin-report-group"><h3>${escapeHtml(group.report.type)} · ${escapeHtml(group.report.id)} <small>이 페이지 ${group.items.length}건</small></h3>${tickets}</section>`;
    }).join("") : '<div class="empty-state">조건에 맞는 요청이 없습니다.</div>';
    const start = visible.length ? first + 1 : 0;
    const end = Math.min(visible.length, first + pageSize);
    resultCount.textContent = `총 ${visible.length.toLocaleString("ko-KR")}건 중 ${start}–${end}건 표시`;
    pager.innerHTML = totalPages > 1 ? `
      <button type="button" data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""}>이전</button>
      <span aria-live="polite">${currentPage} / ${totalPages} 페이지</span>
      <button type="button" data-page="${currentPage + 1}" ${currentPage === totalPages ? "disabled" : ""}>다음</button>` : "";
  }

  async function load() {
    notice.textContent = "불러오는 중...";
    if (!window.BigDataHelpAPI.isConfigured()) {
      notice.textContent = "API가 설정되지 않았습니다. js/config.js에 Web App URL을 입력해주세요.";
      return;
    }
    try {
      requests = await window.BigDataHelpAPI.adminList(true, adminSessionToken);
      renderList();
      notice.textContent = "";
    } catch (error) {
      if (error.message === "ADMIN_UNAUTHORIZED") {
        adminSessionToken = "";
        sessionStorage.removeItem("bigDataHelpAdminSession");
        notice.textContent = "관리자 로그인이 만료되었습니다. 다시 로그인해 주세요.";
      } else {
        notice.textContent = "요청 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
      }
      workspace.hidden = true;
      authForm.hidden = false;
    }
  }

  [filter, kindFilter, deletedFilter, dateFrom, dateTo, sortOrder, pageSizeInput].forEach(control => {
    control.addEventListener("change", () => {
      currentPage = 1;
      renderList();
    });
  });
  searchInput.addEventListener("input", () => {
    currentPage = 1;
    renderList();
  });
  pager.addEventListener("click", event => {
    const button = event.target.closest("button[data-page]");
    if (!button || button.disabled) return;
    currentPage = Math.max(1, Number(button.dataset.page) || 1);
    renderList();
  });
  list.addEventListener("submit", async (event) => {
    const form = event.target.closest(".admin-update-form");
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await window.BigDataHelpAPI.update(form.dataset.id, form.status.value, form.adminReply.value.trim(), adminSessionToken);
      notice.textContent = "저장되었습니다.";
      await load();
    } catch (error) {
      notice.textContent = "저장하지 못했습니다. 잠시 후 다시 시도해주세요.";
      button.disabled = false;
    }
  });

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = authForm.elements.namedItem("adminUsername").value.trim();
    const passwordInput = authForm.elements.namedItem("adminPassword");
    const password = passwordInput.value;
    const submitButton = authForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    adminSessionToken = "";
    sessionStorage.removeItem("bigDataHelpAdminSession");
    try {
      const result = await window.BigDataHelpAPI.adminLogin(username, password);
      adminSessionToken = result.adminSessionToken || "";
      if (!adminSessionToken) throw new Error("ADMIN_UNAUTHORIZED");
      sessionStorage.setItem("bigDataHelpAdminSession", adminSessionToken);
      authForm.hidden = true;
      workspace.hidden = false;
      notice.textContent = "";
      await load();
    } catch (error) {
      authForm.hidden = false;
      workspace.hidden = true;
      notice.textContent = error.message === "ADMIN_RATE_LIMITED"
        ? "로그인 실패 횟수가 초과되었습니다. 15분 후 다시 시도해 주세요."
        : error.message === "ADMIN_UNAUTHORIZED"
          ? "아이디 또는 비밀번호가 올바르지 않거나, 서버 인증 설정이 완료되지 않았습니다."
          : "로그인에 실패했습니다. 다시 시도해 주세요.";
    } finally {
      passwordInput.value = "";
      submitButton.disabled = false;
    }
  });

  async function redeemMagicLink() {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const magicToken = params.get("magic");
    if (!magicToken) return false;

    history.replaceState(null, "", window.location.pathname + window.location.search);
    authForm.hidden = true;
    workspace.hidden = true;
    notice.textContent = "메일의 관리자 로그인 링크를 확인하고 있습니다...";

    try {
      const result = await window.BigDataHelpAPI.redeemAdminMagic(magicToken);
      adminSessionToken = result.adminSessionToken || "";
      if (!adminSessionToken) throw new Error("ADMIN_MAGIC_INVALID");
      sessionStorage.setItem("bigDataHelpAdminSession", adminSessionToken);
      sessionStorage.removeItem("bigDataHelpAdminKey");
      workspace.hidden = false;
      notice.textContent = "관리자 자동 로그인이 완료되었습니다.";
      await load();
      return true;
    } catch (error) {
      adminSessionToken = "";
      sessionStorage.removeItem("bigDataHelpAdminSession");
      notice.textContent = error.message === "ADMIN_MAGIC_EXPIRED" || error.message === "ADMIN_MAGIC_INVALID"
        ? "메일의 자동 로그인 링크가 만료되었거나 이미 사용되었습니다. 아이디와 비밀번호로 로그인해주세요."
        : "자동 로그인에 실패했습니다. 아이디와 비밀번호로 로그인해주세요.";
      authForm.hidden = false;
      return false;
    }
  }

  (async function init() {
    if (await redeemMagicLink()) return;
    if (adminSessionToken) {
      authForm.hidden = true;
      workspace.hidden = false;
      await load();
    }
  })();
})();
