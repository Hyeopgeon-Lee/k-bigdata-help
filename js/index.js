(function () {
  "use strict";

  const statusOrder = ["RECEIVED", "CHECKING", "PROCESSING", "COMPLETED"];
  const statusNames = { RECEIVED: "접수", CHECKING: "확인중", PROCESSING: "처리중", COMPLETED: "완료" };
  const counts = document.querySelector("#status-counts");
  const list = document.querySelector("#recent-list");
  const notice = document.querySelector("#home-notice");

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul" })
      .format(date).replace(/\.\s?/g, "/").replace(/\/$/, "");
  }

  function render(data) {
    const summary = data.counts || {};
    counts.innerHTML = statusOrder.map((status) => `
      <div class="status-stat status-stat--${status.toLowerCase()}">
        <span>${statusNames[status]}</span><strong>${Number(summary[status] || 0)}</strong>
      </div>`).join("");

    const requests = Array.isArray(data.requests) ? data.requests : [];
    list.innerHTML = requests.length ? requests.map((item) => `
      <article class="ticket-card">
        <span class="badge badge--${escapeHtml(item.status.toLowerCase())}">${escapeHtml(statusNames[item.status] || item.status)}</span>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.category)} · ${escapeHtml(item.location)} · ${escapeHtml(formatDate(item.createdAt))}</p>
      </article>`).join("") : '<div class="empty-state">아직 등록된 요청이 없습니다.</div>';
  }

  async function init() {
    if (!window.BigDataHelpAPI.isConfigured()) {
      notice.hidden = false;
      notice.textContent = "현재 API 연결 전입니다. 운영자는 js/config.js에 Apps Script Web App URL을 설정해주세요.";
      render({ counts: {}, requests: [] });
      return;
    }
    try {
      render(await window.BigDataHelpAPI.list());
    } catch (error) {
      notice.hidden = false;
      notice.textContent = "요청 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
      render({ counts: {}, requests: [] });
    }
  }

  init();
})();
