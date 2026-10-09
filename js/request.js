(function () {
  "use strict";

  const form = document.querySelector("#request-form");
  const category = document.querySelector("#category");
  const locationSelect = document.querySelector("#location");
  const submit = document.querySelector("#submit-request");
  const feedback = document.querySelector("#form-feedback");
  const success = document.querySelector("#request-success");
  const config = window.APP_CONFIG;

  function fillOptions(select, values, placeholder) {
    select.innerHTML = '<option value="">' + placeholder + '</option>' +
      values.map(value => '<option value="' + value + '">' + value + '</option>').join("");
  }

  function compact(value, maxLength) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  }

  // Only the two approved portal learning pages may activate this specialized form.
  function getReportContext() {
    const params = new URLSearchParams(window.location.search);
    const source = params.get("source");
    const page = source === "practical" ? "practical.html" : source === "interview" ? "interview.html" : "";
    const id = compact(params.get("id"), 80);
    if (!page || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return null;
    let problem;
    try { problem = new URL(params.get("url") || ""); } catch (_) { return null; }
    if (problem.origin !== "https://portal.k-bigdata.kr" ||
        problem.pathname !== "/" + page || problem.searchParams.get("id") !== id) return null;
    const type = source === "practical" ? "실기문제" : "기술면접";
    const code = compact(params.get("code"), 40) || id;
    return {
      source, type, id, code, url: problem.href,
      label: compact(params.get("label"), 80),
      question: compact(params.get("question"), 125)
    };
  }

  const reasons = {
    practical: ["문제 오류", "정답 오류", "해설 오류", "값 추적 오류", "코드·SQL 오류", "기타"],
    interview: ["질문 오류", "모범답안 오류", "핵심 용어 오류", "설명 부족", "기타"]
  };

  const report = getReportContext();
  fillOptions(category, config.REQUEST_CATEGORIES.filter(value => report || value !== "학습문제 오류 신고"), "요청 유형을 선택하세요");
  fillOptions(locationSelect, config.LOCATIONS, "장소를 선택하세요");
  form.elements.title.maxLength = config.LIMITS.title;
  form.elements.content.maxLength = config.LIMITS.content;

  if (report) {
    document.querySelector("#learning-report-panel").hidden = false;
    document.querySelector("#request-content-label").hidden = true;
    const detail = document.querySelector("#report-description");
    const reason = document.querySelector("#report-reason");
    fillOptions(reason, reasons[report.source], "오류 유형을 선택하세요");
    reason.required = true;
    detail.required = true;
    form.elements.content.required = false;
    category.value = "학습문제 오류 신고";
    locationSelect.value = "온라인 포털";
    form.elements.title.value = ("[" + report.type + " 오류] " + report.code + " " + report.question).slice(0, config.LIMITS.title);
    form.elements.title.readOnly = true;
    document.querySelector("#report-question-title").textContent = report.question || report.code;
    document.querySelector("#report-question-meta").textContent =
      report.type + " · " + (report.label || report.code) + " · ID " + report.id + (report.code !== report.id ? " · 코드 " + report.code : "");
    document.querySelector("#report-question-link").href = report.url;
  }

  function buildReportContent() {
    const reason = document.querySelector("#report-reason").value;
    const details = document.querySelector("#report-description").value.trim();
    if (!reason || !details) throw new Error("REPORT_DETAILS_REQUIRED");
    return [
      "문제 유형: " + report.type,
      "문제 ID: " + report.id,
      "문제 코드: " + report.code,
      "문제 제목: " + report.question,
      "문제 화면: " + report.url,
      "오류 구분: " + reason,
      "신고 내용:",
      details
    ].join("\n");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    feedback.textContent = "";
    if (!window.BigDataHelpAPI.isConfigured()) {
      feedback.textContent = "API가 아직 설정되지 않았습니다. 운영자에게 문의해주세요.";
      return;
    }

    const payload = Object.fromEntries(new FormData(form).entries());
    Object.keys(payload).forEach(key => { payload[key] = payload[key].trim(); });
    if (report) {
      payload.category = "학습문제 오류 신고";
      payload.location = "온라인 포털";
      payload.title = form.elements.title.value;
      try { payload.content = buildReportContent(); } catch (_) {
        feedback.textContent = "오류 유형과 신고 내용을 입력해주세요.";
        return;
      }
    }
    if (payload.content.length > config.LIMITS.content) {
      feedback.textContent = "신고 내용이 너무 깁니다. 내용을 조금 줄여주세요.";
      return;
    }
    if (!/^\d{4}$/.test(payload.pin)) {
      feedback.textContent = "PIN은 숫자 4자리로 입력해주세요.";
      form.elements.pin.focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = "등록 중...";
    try {
      let result;
      try {
        result = await window.BigDataHelpAPI.create(payload);
      } catch (error) {
        // The previous deployed Apps Script rejects the new category and location.
        // Until the backend is redeployed, retain reports using legacy valid values.
        if (!report || error.message !== "VALIDATION_ERROR") throw error;
        result = await window.BigDataHelpAPI.create({ ...payload, category: "수업 관련", location: "기타" });
      }
      form.hidden = true;
      success.hidden = false;
      document.querySelector("#created-request-id").textContent = result.requestId;
      success.focus();
    } catch (error) {
      feedback.textContent = error.message === "VALIDATION_ERROR"
        ? "입력 내용을 다시 확인해주세요."
        : "요청을 등록하지 못했습니다. 잠시 후 다시 시도해주세요.";
    } finally {
      submit.disabled = false;
      submit.textContent = "요청 등록하기";
    }
  });
})();
