(function () {
  "use strict";

  const statusNames = { RECEIVED: "접수", CHECKING: "확인중", PROCESSING: "처리중", COMPLETED: "완료" };
  const statuses = Object.keys(statusNames);
  const list = document.querySelector("#admin-list");
  const summary = document.querySelector("#admin-summary");
  const notice = document.querySelector("#admin-notice");
  const filter = document.querySelector("#status-filter");
  const includeDeleted = document.querySelector("#include-deleted");
  const authForm = document.querySelector("#admin-auth");
  const workspace = document.querySelector("#admin-workspace");
  let requests = [];
  const urlAdminKey = new URLSearchParams(window.location.search).get("key") || "";
  let adminKey = urlAdminKey.trim() || sessionStorage.getItem("bigDataHelpAdminKey") || "";
  if (urlAdminKey.trim()) sessionStorage.setItem("bigDataHelpAdminKey", urlAdminKey.trim());

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

  function renderList() {
    const selected = filter.value;
    const visible = requests.filter((item) => (selected === "ALL" || item.status === selected));
    list.innerHTML = visible.length ? visible.map((item) => `
      <details class="admin-ticket${item.isDeleted ? " admin-ticket--deleted" : ""}">
        <summary>
          <span class="badge badge--${escapeHtml(item.status.toLowerCase())}">${escapeHtml(statusNames[item.status])}</span>
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
          <div class="content-panel"><strong>상세 내용</strong><p>${escapeHtml(item.content)}</p></div>
          <form class="admin-update-form" data-id="${escapeHtml(item.requestId)}">
            <label>처리 상태<select name="status">${statuses.map((status) => `<option value="${status}"${item.status === status ? " selected" : ""}>${statusNames[status]}</option>`).join("")}</select></label>
            <label>관리자 답변<textarea name="adminReply" maxlength="2000" rows="5" placeholder="학생에게 보여줄 답변을 입력하세요">${escapeHtml(item.adminReply || "")}</textarea></label>
            <button class="button button--primary button--small" type="submit"${item.isDeleted ? " disabled" : ""}>저장</button>
          </form>
        </div>
      </details>`).join("") : '<div class="empty-state">조건에 맞는 요청이 없습니다.</div>';
  }

  async function load() {
    notice.textContent = "불러오는 중...";
    if (!window.BigDataHelpAPI.isConfigured()) {
      notice.textContent = "API가 설정되지 않았습니다. js/config.js에 Web App URL을 입력해주세요.";
      return;
    }
    try {
      requests = await window.BigDataHelpAPI.adminList(includeDeleted.checked, adminKey);
      renderSummary();
      renderList();
      notice.textContent = "";
    } catch (error) {
      notice.textContent = error.message === "ADMIN_UNAUTHORIZED" ? "관리자 접근 키가 올바르지 않습니다." : "요청 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
      workspace.hidden = true;
      authForm.hidden = false;
    }
  }

  filter.addEventListener("change", renderList);
  includeDeleted.addEventListener("change", load);
  list.addEventListener("submit", async (event) => {
    const form = event.target.closest(".admin-update-form");
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await window.BigDataHelpAPI.update(form.dataset.id, form.status.value, form.adminReply.value.trim(), adminKey);
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
    sessionStorage.setItem("bigDataHelpAdminKey", adminKey);
    authForm.hidden = true;
    workspace.hidden = false;
    await load();
  });
  if (adminKey) {
    authForm.hidden = true;
    workspace.hidden = false;
    load();
  }
})();
