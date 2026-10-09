(function () {
  "use strict";

  const statusNames = { RECEIVED: "접수", CHECKING: "확인중", PROCESSING: "처리중", COMPLETED: "완료" };
  const statuses = Object.keys(statusNames);
  const list = document.querySelector("#admin-list");
  const summary = document.querySelector("#admin-summary");
  const notice = document.querySelector("#admin-notice");
  const filter = document.querySelector("#status-filter");
  const kindFilter = document.querySelector("#request-kind-filter");
  const includeDeleted = document.querySelector("#include-deleted");
  const authForm = document.querySelector("#admin-auth");
  const workspace = document.querySelector("#admin-workspace");
  let requests = [];
  let adminKey = sessionStorage.getItem("bigDataHelpAdminKey") || "";
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

  function renderSummary() {
    const active = requests.filter((item) => !item.isDeleted);
    const cards = [{ key: "ALL", label: "전체", count: active.length }].concat(statuses.map((key) => ({
      key, label: statusNames[key], count: active.filter((item) => item.status === key).length
    })));
    summary.innerHTML = cards.map((item) => `<div class="summary-card"><span>${item.label}</span><strong>${item.count}</strong></div>`).join("");
  }

  function reportInfo(item) {
  const source = String(item.content || "");
  const type = source.match(/^문제 유형: (실기문제|기술면접)$/m)?.[1];
  const id = source.match(/^문제 ID: ([A-Za-z0-9_-]{1,80})$/m)?.[1];
  const rawUrl = source.match(/^문제 화면: (https:\/\/[^\s]+)$/m)?.[1];
  if (!type || !id || !rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    const page = type === "실기문제" ? "/practical.html" : "/interview.html";
    if (url.origin !== "https://portal.k-bigdata.kr" || url.pathname !== page || url.searchParams.get("id") !== id) return null;
    return { type, id, url: url.href, kind: type === "실기문제" ? "practical" : "interview" };
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

  function renderList() {
  const selected = filter.value;
  const kind = kindFilter.value;
  const visible = requests.filter(item => {
    const report = reportInfo(item);
    return (selected === "ALL" || item.status === selected) &&
      (kind === "ALL" || kind === (report?.kind || "other"));
  });
  const groups = new Map();
  visible.forEach(item => {
    const report = reportInfo(item);
    const key = report ? `${report.kind}:${report.id}` : `ticket:${item.requestId}`;
    if (!groups.has(key)) groups.set(key, { report, items: [] });
    groups.get(key).items.push(item);
  });
  list.innerHTML = visible.length ? Array.from(groups.values()).map(group => {
    const tickets = group.items.map(renderTicket).join("");
    if (!group.report) return tickets;
    return `<section class="admin-report-group"><h3>${escapeHtml(group.report.type)} · ${escapeHtml(group.report.id)} <small>접수 ${group.items.length}건</small></h3>${tickets}</section>`;
  }).join("") : '<div class="empty-state">조건에 맞는 요청이 없습니다.</div>';
}

  async function load() {
    notice.textContent = "불러오는 중...";
    if (!window.BigDataHelpAPI.isConfigured()) {
      notice.textContent = "API가 설정되지 않았습니다. js/config.js에 Web App URL을 입력해주세요.";
      return;
    }
    try {
      requests = await window.BigDataHelpAPI.adminList(includeDeleted.checked, adminKey, adminSessionToken);
      renderSummary();
      renderList();
      notice.textContent = "";
    } catch (error) {
      if (error.message === "ADMIN_UNAUTHORIZED") {
        adminSessionToken = "";
        sessionStorage.removeItem("bigDataHelpAdminSession");
        notice.textContent = "관리자 인증이 만료되었거나 접근 키가 올바르지 않습니다.";
      } else {
        notice.textContent = "요청 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
      }
      workspace.hidden = true;
      authForm.hidden = false;
    }
  }

  filter.addEventListener("change", renderList);
  kindFilter.addEventListener("change", renderList);
  includeDeleted.addEventListener("change", load);
  list.addEventListener("submit", async (event) => {
    const form = event.target.closest(".admin-update-form");
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await window.BigDataHelpAPI.update(form.dataset.id, form.status.value, form.adminReply.value.trim(), adminKey, adminSessionToken);
      notice.textContent = "저장되었습니다.";
      await load();
    } catch (error) {
      notice.textContent = "저장하지 못했습니다. 잠시 후 다시 시도해주세요.";
      button.disabled = false;
    }
  });

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    adminKey = authForm.adminKey.value.trim();
    adminSessionToken = "";
    sessionStorage.removeItem("bigDataHelpAdminSession");
    sessionStorage.setItem("bigDataHelpAdminKey", adminKey);
    authForm.hidden = true;
    workspace.hidden = false;
    await load();
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
      adminKey = "";
      workspace.hidden = false;
      notice.textContent = "관리자 자동 로그인이 완료되었습니다.";
      await load();
      return true;
    } catch (error) {
      adminSessionToken = "";
      sessionStorage.removeItem("bigDataHelpAdminSession");
      notice.textContent = error.message === "ADMIN_MAGIC_EXPIRED" || error.message === "ADMIN_MAGIC_INVALID"
        ? "메일의 자동 로그인 링크가 만료되었거나 이미 사용되었습니다. 관리자 접근 키로 로그인해주세요."
        : "자동 로그인에 실패했습니다. 관리자 접근 키로 로그인해주세요.";
      authForm.hidden = false;
      return false;
    }
  }

  (async function init() {
    if (await redeemMagicLink()) return;
    if (adminSessionToken || adminKey) {
      authForm.hidden = true;
      workspace.hidden = false;
      await load();
    }
  })();
})();
