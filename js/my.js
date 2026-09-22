(function () {
  "use strict";

  const form = document.querySelector("#lookup-form");
  const feedback = document.querySelector("#lookup-feedback");
  const results = document.querySelector("#my-results");
  const statusNames = { RECEIVED: "접수", CHECKING: "확인중", PROCESSING: "처리중", COMPLETED: "완료" };
  let credentials = null;

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

  function render(items) {
    if (!items.length) {
      results.innerHTML = '<div class="empty-state">일치하는 요청이 없습니다.</div>';
      return;
    }
    results.innerHTML = items.map((item) => `
      <article class="ticket-card ticket-card--detail">
        <div class="ticket-card__top"><span class="badge badge--${escapeHtml(item.status.toLowerCase())}">${escapeHtml(statusNames[item.status])}</span><span class="request-id">${escapeHtml(item.requestId)}</span></div>
        <h3>${escapeHtml(item.title)}</h3>
        <p class="ticket-meta">${escapeHtml(item.category)} · ${escapeHtml(item.location)}</p>
        <time>${escapeHtml(formatDate(item.createdAt))}</time>
        <p class="ticket-content">${escapeHtml(item.content)}</p>
        <div class="reply-box"><strong>관리자 답변</strong><p>${item.adminReply ? escapeHtml(item.adminReply) : "아직 등록된 답변이 없습니다."}</p></div>
        <button class="button button--danger button--small delete-request" data-id="${escapeHtml(item.requestId)}" type="button">요청 삭제</button>
      </article>`).join("");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    feedback.textContent = "";
    const studentId = form.studentId.value.trim();
    const pin = form.pin.value.trim();
    if (!/^\d{4}$/.test(pin)) {
      feedback.textContent = "PIN은 숫자 4자리로 입력해주세요.";
      return;
    }
    if (!window.BigDataHelpAPI.isConfigured()) {
      feedback.textContent = "API가 아직 설정되지 않았습니다. 운영자에게 문의해주세요.";
      return;
    }
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      credentials = { studentId, pin };
      render(await window.BigDataHelpAPI.myRequests(studentId, pin));
    } catch (error) {
      feedback.textContent = "요청 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
    } finally {
      button.disabled = false;
    }
  });

  results.addEventListener("click", async (event) => {
    const button = event.target.closest(".delete-request");
    if (!button || !credentials) return;
    if (!window.confirm("이 요청을 삭제하시겠습니까?\n\n삭제하면 내 요청 화면에서 더 이상 확인할 수 없습니다.")) return;
    button.disabled = true;
    try {
      await window.BigDataHelpAPI.deleteRequest(button.dataset.id, credentials.studentId, credentials.pin);
      render(await window.BigDataHelpAPI.myRequests(credentials.studentId, credentials.pin));
      feedback.textContent = "요청이 삭제되었습니다.";
    } catch (error) {
      feedback.textContent = "요청을 삭제하지 못했습니다. 입력 정보와 네트워크 상태를 확인해주세요.";
      button.disabled = false;
    }
  });
})();
