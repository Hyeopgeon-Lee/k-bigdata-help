(function () {
  "use strict";

  const config = window.APP_CONFIG || {};

  function isConfigured() {
    return Boolean(config.API_URL && !config.API_URL.includes("YOUR_GOOGLE_APPS_SCRIPT_URL"));
  }

  async function request(action, data = {}, method = "GET") {
    if (!isConfigured()) {
      throw new Error("API_NOT_CONFIGURED");
    }

    const params = new URLSearchParams({ action, ...data });
    let response;
    if (method === "POST") {
      response = await fetch(config.API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: params.toString(),
        redirect: "follow"
      });
    } else {
      const separator = config.API_URL.includes("?") ? "&" : "?";
      response = await fetch(`${config.API_URL}${separator}${params.toString()}`, {
        method: "GET",
        redirect: "follow",
        cache: "no-store"
      });
    }

    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const result = await response.json();
    if (!result.success) throw new Error(result.message || "API_ERROR");
    return result.data;
  }

  window.BigDataHelpAPI = Object.freeze({
    isConfigured,
    list: () => request("list"),
    create: (payload) => request("create", payload, "POST"),
    myRequests: (studentId, pin) => request("myRequests", { studentId, pin }, "POST"),
    deleteRequest: (requestId, studentId, pin) =>
      request("delete", { requestId, studentId, pin }, "POST"),
    adminList: (includeDeleted = false, adminKey = "") => request("adminList", { includeDeleted: String(includeDeleted), adminKey }),
    update: (requestId, status, adminReply, adminKey = "") =>
      request("update", { requestId, status, adminReply, adminKey }, "POST")
  });
})();
