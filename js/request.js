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
    select.innerHTML = `<option value="">${placeholder}</option>` + values
      .map((value) => `<option value="${value}">${value}</option>`).join("");
  }

  fillOptions(category, config.REQUEST_CATEGORIES, "요청 유형을 선택하세요");
  fillOptions(locationSelect, config.LOCATIONS, "장소를 선택하세요");
  form.elements.title.maxLength = config.LIMITS.title;
  form.elements.content.maxLength = config.LIMITS.content;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    feedback.textContent = "";
    if (!window.BigDataHelpAPI.isConfigured()) {
      feedback.textContent = "API가 아직 설정되지 않았습니다. 운영자에게 문의해주세요.";
      return;
    }

    const payload = Object.fromEntries(new FormData(form).entries());
    Object.keys(payload).forEach((key) => { payload[key] = payload[key].trim(); });
    if (!/^\d{4}$/.test(payload.pin)) {
      feedback.textContent = "PIN은 숫자 4자리로 입력해주세요.";
      form.pin.focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = "등록 중...";
    try {
      const result = await window.BigDataHelpAPI.create(payload);
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
