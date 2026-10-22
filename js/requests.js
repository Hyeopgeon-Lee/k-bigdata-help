(function () {
  "use strict";

  const statusNames = {RECEIVED: "접수", CHECKING: "확인중", PROCESSING: "처리중", COMPLETED: "완료"};
  const status = document.querySelector("#public-status");
  const sort = document.querySelector("#public-sort");
  const list = document.querySelector("#public-requests");
  const pager = document.querySelector("#public-pagination");
  const count = document.querySelector("#public-count");
  const notice = document.querySelector("#public-notice");
  let page = 1;
  let latestLoad = 0;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, ch =>
      ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[ch]);
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("ko-KR", {
      year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit",
      hour12:false, timeZone:"Asia/Seoul"
    }).format(date);
  }

  async function load() {
    const sequence = ++latestLoad;
    count.textContent = "요청 목록을 불러오는 중...";
    if (!window.BigDataHelpAPI.isConfigured()) {
      notice.hidden = false;
      notice.textContent = "요청 조회 API가 설정되지 않았습니다.";
      return;
    }
    try {
      const data = await window.BigDataHelpAPI.list({
        page: String(page), pageSize: "20", status: status.value, sort: sort.value
      });
      if (sequence !== latestLoad) return;
      page = data.page || 1;
      const total = Number(data.total || 0);
      const totalPages = Number(data.totalPages || 1);
      const requests = Array.isArray(data.requests) ? data.requests : [];
      const start = total ? (page - 1) * 20 + 1 : 0;
      const end = Math.min(total, page * 20);
      count.textContent = "총 " + total.toLocaleString("ko-KR") + "건 · " + start + "–" + end + "건 표시";
      list.innerHTML = requests.length ? requests.map(item => `
        <article class="ticket-card">
          <div class="ticket-card__top">
            <span class="badge badge--${escapeHtml(item.status.toLowerCase())}">${escapeHtml(statusNames[item.status] || item.status)}</span>
            <span class="request-id">${escapeHtml(item.requestId)}</span>
          </div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.category)} · ${escapeHtml(item.location)} · ${escapeHtml(formatDate(item.createdAt))}</p>
        </article>`).join("") : '<div class="empty-state">조건에 맞는 요청이 없습니다.</div>';
      pager.innerHTML = totalPages > 1 ? `
        <button type="button" data-page="${page - 1}" ${page === 1 ? "disabled" : ""}>이전</button>
        <span aria-live="polite">${page} / ${totalPages} 페이지</span>
        <button type="button" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>다음</button>` : "";
      notice.hidden = true;
    } catch (_) {
      if (sequence !== latestLoad) return;
      count.textContent = "조회 실패";
      list.innerHTML = '<div class="empty-state">요청 목록을 불러오지 못했습니다.</div>';
      pager.innerHTML = "";
      notice.hidden = false;
      notice.textContent = "잠시 후 다시 시도해 주세요.";
    }
  }

  status.addEventListener("change", () => { page = 1; load(); });
  sort.addEventListener("change", () => { page = 1; load(); });
  pager.addEventListener("click", event => {
    const button = event.target.closest("button[data-page]");
    if (!button || button.disabled) return;
    page = Math.max(1, Number(button.dataset.page) || 1);
    load();
  });
  load();
})();
