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

  // Coalesce concurrent reads only; never store credentials or completed private data.
  const pendingReads = new Map();
  let revision = 0;
  function read(action, data = {}, method = "GET") {
    const key = JSON.stringify([revision, action, data]);
    if (!pendingReads.has(key)) {
      const pending = request(action, data, method).finally(() => pendingReads.delete(key));
      pendingReads.set(key, pending);
    }
    return pendingReads.get(key);
  }
  async function mutate(action, data) {
    const result = await request(action, data, "POST");
    revision++;
    return result;
  }

  window.BigDataHelpAPI = Object.freeze({
    isConfigured,
    list: () => read("list"),
    create: (payload) => mutate("create", payload),
    myRequests: (studentId, pin) => read("myRequests", { studentId, pin }, "POST"),
    deleteRequest: (requestId, studentId, pin) =>
      mutate("delete", { requestId, studentId, pin }),
    redeemAdminMagic: (magicToken) =>
      request("redeemAdminMagic", { magicToken }, "POST"),
    adminList: (includeDeleted = false, adminKey = "", adminSessionToken = "") =>
      read("adminList", { includeDeleted: String(includeDeleted), adminKey, adminSessionToken }, "POST"),
    update: (requestId, status, adminReply, adminKey = "", adminSessionToken = "") =>
      mutate("update", { requestId, status, adminReply, adminKey, adminSessionToken })
  });
})();
