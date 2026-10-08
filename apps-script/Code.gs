/** BigData Help - Google Apps Script Web App (V8 runtime) */
const CONFIG = Object.freeze({
  SHEET_NAME: "requests",
  ADMIN_EMAIL: "hglee67@kopo.ac.kr",
  TIMEZONE: "Asia/Seoul",
  SERVICE_NAME: "BigData Help",
  SERVICE_URL: "https://help.k-bigdata.kr/",
  MAX_TITLE_LENGTH: 80,
  MAX_CONTENT_LENGTH: 2000,
  ADMIN_MAGIC_TTL_SECONDS: 1800,
  ADMIN_SESSION_TTL_SECONDS: 21600
});

const HEADERS = Object.freeze([
  "request_id", "created_at", "student_id", "student_name", "pin", "category",
  "location", "title", "content", "status", "admin_reply", "updated_at",
  "is_deleted", "deleted_at", "email_sent_at"
]);
const STATUSES = Object.freeze(["RECEIVED", "CHECKING", "PROCESSING", "COMPLETED"]);
const CATEGORIES = Object.freeze([
  "PC·실습실 장애", "소프트웨어 설치·오류", "네트워크·인터넷", "시설·비품", "수업 관련",
  "프로젝트 지원", "취업·진로 문의", "학과 운영 건의", "기타"
]);
const LOCATIONS = Object.freeze(["8311호", "8318호", "8319호", "기타"]);

function scriptProperty_(key) {
  return String(PropertiesService.getScriptProperties().getProperty(key) || "").trim();
}

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  if (params.adminKey || params.adminSessionToken || params.magicToken || clean_(params.action) !== "list") {
    return json_(false, null, "METHOD_NOT_ALLOWED");
  }
  return routeRequest_(params);
}

function doPost(e) {
  if (e && /(?:^|&)(?:adminKey|adminSessionToken|magicToken)(?:=|&|$)/i.test(String(e.queryString || ""))) {
    return json_(false, null, "KEY_IN_URL_NOT_ALLOWED");
  }
  let params = {};
  if (e && e.postData && e.postData.type && e.postData.type.indexOf("application/json") > -1) {
    try { params = JSON.parse(e.postData.contents || "{}"); } catch (error) { return json_(false, null, "INVALID_JSON"); }
  } else if (e && e.postData) {
    try {
      String(e.postData.contents || "").split("&").forEach(pair => {
        const separator = pair.indexOf("=");
        const decode = value => decodeURIComponent(value.replace(/\+/g, " "));
        const key = decode(separator < 0 ? pair : pair.slice(0, separator));
        if (key) params[key] = decode(separator < 0 ? "" : pair.slice(separator + 1));
      });
    } catch (error) { return json_(false, null, "INVALID_FORM"); }
  }
  return routeRequest_(params);
}

function routeRequest_(params) {
  try {
    validateConfiguration_(false);
    const action = clean_(params.action);
    let data;
    switch (action) {
      case "list": data = listPublic_(); break;
      case "create": data = createRequest_(params); break;
      case "myRequests": data = getMyRequests_(params); break;
      case "delete": data = deleteRequest_(params); break;
      case "redeemAdminMagic": data = redeemAdminMagic_(params); break;
      case "adminList": assertAdmin_(params); data = listAdmin_(params); break;
      case "update": assertAdmin_(params); data = updateRequest_(params); break;
      default: return json_(false, null, "UNKNOWN_ACTION");
    }
    return json_(true, data, "");
  } catch (error) {
    console.error("BigData Help API error: " + String(error && error.stack ? error.stack : error));
    return json_(false, null, safeErrorMessage_(error));
  }
}

function initializeSheet() {
  validateConfiguration_(false);
  const sheet = getSheet_(true);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold").setBackground("#173b68").setFontColor("#ffffff");
  sheet.autoResizeColumns(1, HEADERS.length);
  return "requests 시트 준비 완료";
}

function createRequest_(params) {
  const input = {
    studentId: clean_(params.studentId), studentName: clean_(params.studentName), pin: clean_(params.pin),
    category: clean_(params.category), location: clean_(params.location), title: clean_(params.title), content: clean_(params.content)
  };
  if (!input.studentId || !input.studentName || !input.category || !input.location || !input.title || !input.content || !/^\d{4}$/.test(input.pin)) {
    throw new Error("VALIDATION_ERROR");
  }
  if (input.title.length > CONFIG.MAX_TITLE_LENGTH || input.content.length > CONFIG.MAX_CONTENT_LENGTH ||
      input.studentName.length > 30 || input.studentId.length > 20 || CATEGORIES.indexOf(input.category) === -1 || LOCATIONS.indexOf(input.location) === -1) {
    throw new Error("VALIDATION_ERROR");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let created;
  try {
    const sheet = getSheet_(true);
    const now = new Date();
    const requestId = nextRequestId_(sheet, now);
    const pinHash = hashPin_(requestId, input.pin);
    sheet.appendRow([
      requestId, now, sheetText_(input.studentId), sheetText_(input.studentName), pinHash, input.category, input.location,
      sheetText_(input.title), sheetText_(input.content), "RECEIVED", "", now, false, "", ""
    ]);
    created = {
      requestId: requestId,
      createdAt: now,
      rowNumber: sheet.getLastRow(),
      studentId: input.studentId,
      studentName: input.studentName,
      category: input.category,
      location: input.location,
      title: input.title,
      content: input.content
    };
    invalidatePublic_();
  } finally {
    lock.releaseLock();
  }

  let status = "RECEIVED";
  try {
    if (sendImmediateRequestNotification_(created)) status = "CHECKING";
  } catch (error) {
    console.error("즉시 요청 알림 메일 발송 실패: " + String(error && error.stack ? error.stack : error));
  }
  return { requestId: created.requestId, status: status, createdAt: created.createdAt.toISOString() };
}

function listPublic_() {
  const key = "PUBLIC_LIST_" + (scriptProperty_("PUBLIC_REVISION") || "initial");
  const cache = CacheService.getScriptCache();
  const cached = cache.get(key);
  if (cached) {
    try { return JSON.parse(cached); } catch (_) { cache.remove(key); }
  }
  const rows = readRows_().filter(row => !isTrue_(row.is_deleted));
  const counts = { RECEIVED: 0, CHECKING: 0, PROCESSING: 0, COMPLETED: 0 };
  rows.forEach(row => { if (Object.prototype.hasOwnProperty.call(counts, row.status)) counts[row.status]++; });
  rows.sort((a, b) => dateValue_(b.created_at) - dateValue_(a.created_at));
  const result = {
    counts: counts,
    requests: rows.slice(0, 10).map(row => ({
      requestId: row.request_id, category: row.category, location: row.location, title: row.title,
      status: row.status, createdAt: iso_(row.created_at)
    }))
  };
  // Cache only the public projection. A concurrent mutation changes the key.
  try { cache.put(key, JSON.stringify(result), 30); } catch (_) {}
  return result;
}

function getMyRequests_(params) {
  const studentId = clean_(params.studentId);
  const pin = clean_(params.pin);
  if (!studentId || !/^\d{4}$/.test(pin)) throw new Error("VALIDATION_ERROR");
  return readRows_()
    .filter(row => !isTrue_(row.is_deleted) && String(row.student_id) === studentId && secureEqual_(String(row.pin), hashPin_(row.request_id, pin)))
    .sort((a, b) => dateValue_(b.created_at) - dateValue_(a.created_at))
    .map(studentView_);
}

function deleteRequest_(params) {
  return withMutation_(() => deleteRequestUnlocked_(params));
}

function deleteRequestUnlocked_(params) {
  const requestId = clean_(params.requestId);
  const studentId = clean_(params.studentId);
  const pin = clean_(params.pin);
  if (!requestId || !studentId || !/^\d{4}$/.test(pin)) throw new Error("VALIDATION_ERROR");
  const sheet = getSheet_(false);
  const row = findRequest_(sheet, requestId);
  if (row && isTrue_(row.is_deleted)) throw new Error("NOT_FOUND_OR_UNAUTHORIZED");
  if (!row || String(row.student_id) !== studentId || !secureEqual_(String(row.pin), hashPin_(requestId, pin))) throw new Error("NOT_FOUND_OR_UNAUTHORIZED");
  const now = new Date();
  sheet.getRange(row._rowNumber, 12, 1, 3).setValues([[now, true, now]]);
  return { requestId: requestId, deleted: true };
}

function listAdmin_(params) {
  const includeDeleted = String(params.includeDeleted).toLowerCase() === "true";
  return readRows_().filter(row => includeDeleted || !isTrue_(row.is_deleted))
    .sort((a, b) => dateValue_(b.created_at) - dateValue_(a.created_at))
    .map(row => ({
      requestId: row.request_id, createdAt: iso_(row.created_at), studentId: String(row.student_id || ""),
      studentName: row.student_name, category: row.category, location: row.location, title: row.title,
      content: row.content, status: row.status, adminReply: row.admin_reply || "", updatedAt: iso_(row.updated_at),
      isDeleted: isTrue_(row.is_deleted), deletedAt: iso_(row.deleted_at), emailSentAt: iso_(row.email_sent_at)
    }));
}

function updateRequest_(params) {
  return withMutation_(() => updateRequestUnlocked_(params));
}

function updateRequestUnlocked_(params) {
  const requestId = clean_(params.requestId);
  const status = clean_(params.status);
  const adminReply = clean_(params.adminReply);
  if (!requestId || STATUSES.indexOf(status) === -1 || adminReply.length > 2000) throw new Error("VALIDATION_ERROR");
  const sheet = getSheet_(false);
  const row = findRequest_(sheet, requestId);
  if (!row || isTrue_(row.is_deleted)) throw new Error("REQUEST_NOT_FOUND");
  sheet.getRange(row._rowNumber, 10, 1, 3).setValues([[status, sheetText_(adminReply), new Date()]]);
  return { requestId: requestId, status: status, adminReply: adminReply };
}

function randomToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
}

function createAdminMagicLink_(requestId) {
  const token = randomToken_();
  CacheService.getScriptCache().put("ADMIN_MAGIC_" + token, String(requestId || ""), CONFIG.ADMIN_MAGIC_TTL_SECONDS);
  return CONFIG.SERVICE_URL.replace(/\/$/, "") + "/admin.html#magic=" + encodeURIComponent(token);
}

function redeemAdminMagic_(params) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return redeemAdminMagicUnlocked_(params); } finally { lock.releaseLock(); }
}

function redeemAdminMagicUnlocked_(params) {
  const token = clean_(params.magicToken);
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) throw new Error("ADMIN_MAGIC_INVALID");
  const cache = CacheService.getScriptCache();
  const key = "ADMIN_MAGIC_" + token;
  const requestId = cache.get(key);
  if (requestId == null) throw new Error("ADMIN_MAGIC_EXPIRED");
  cache.remove(key);

  const sessionToken = randomToken_();
  cache.put("ADMIN_SESSION_" + sessionToken, "1", CONFIG.ADMIN_SESSION_TTL_SECONDS);
  return {
    adminSessionToken: sessionToken,
    expiresInSeconds: CONFIG.ADMIN_SESSION_TTL_SECONDS,
    requestId: requestId
  };
}

function isAdminSessionValid_(token) {
  token = clean_(token);
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return false;
  return CacheService.getScriptCache().get("ADMIN_SESSION_" + token) === "1";
}

function sendImmediateRequestNotification_(request) {
  return withMutation_(() => sendImmediateRequestNotificationUnlocked_(request));
}

function sendImmediateRequestNotificationUnlocked_(request) {
  const sheet = getSheet_(false);
  const row = findRequest_(sheet, request.requestId);
  if (!row || isTrue_(row.is_deleted)) return false;
  if (row.email_sent_at) return row.status === "CHECKING";
  validateConfiguration_(true);
  const adminUrl = createAdminMagicLink_(request.requestId);
  const contentHtml = escapeHtml_(request.content).replace(/\r?\n/g, "<br>");
  const subject = `[${CONFIG.SERVICE_NAME}] 새 요청: ${request.title}`;
  const htmlBody = `<!doctype html><html><body style="margin:0;padding:0;background:#f2f5f8;font-family:Arial,'Apple SD Gothic Neo',sans-serif;color:#172333;">
    <div style="max-width:680px;margin:0 auto;padding:24px 12px;">
      <div style="padding:28px 24px;border-radius:18px 18px 0 0;background:#173b68;color:#ffffff;">
        <div style="font-size:24px;font-weight:800;">BigData Help</div>
        <div style="margin-top:5px;color:#cfe0f2;font-size:14px;">새 학과 요청이 접수되었습니다.</div>
      </div>
      <div style="padding:24px;background:#ffffff;">
        <div style="margin:0 0 18px;padding:18px;border:1px solid #dfe5ec;border-radius:14px;background:#ffffff;">
          <div style="margin-bottom:8px;color:#2875c7;font-size:13px;font-weight:700;">${escapeHtml_(request.category)}</div>
          <h1 style="margin:0 0 16px;color:#172333;font-size:21px;line-height:1.45;">${escapeHtml_(request.title)}</h1>
          <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;color:#344255;">
            <tr><td style="width:82px;padding:5px 0;color:#788495;">장소</td><td style="padding:5px 0;">${escapeHtml_(request.location)}</td></tr>
            <tr><td style="padding:5px 0;color:#788495;">요청자</td><td style="padding:5px 0;">${escapeHtml_(request.studentName)} / ${escapeHtml_(request.studentId)}</td></tr>
            <tr><td style="padding:5px 0;color:#788495;vertical-align:top;">요청 내용</td><td style="padding:5px 0;line-height:1.7;">${contentHtml}</td></tr>
            <tr><td style="padding:5px 0;color:#788495;">등록</td><td style="padding:5px 0;">${formatDateTime_(request.createdAt)}</td></tr>
            <tr><td style="padding:5px 0;color:#788495;">요청번호</td><td style="padding:5px 0;font-family:monospace;">${escapeHtml_(request.requestId)}</td></tr>
          </table>
        </div>
        <div style="padding:8px 0 2px;text-align:center;">
          <a href="${adminUrl}" style="display:inline-block;padding:14px 24px;border-radius:10px;background:#2875c7;color:#ffffff;text-decoration:none;font-weight:700;">관리자 화면에서 확인하기</a>
        </div>
        <p style="margin:18px 0 0;color:#7b8795;font-size:12px;line-height:1.65;text-align:center;">
          버튼을 누르면 관리자 화면으로 이동해 자동 인증됩니다.<br>
          자동 로그인 링크는 30분 동안 유효하며 한 번만 사용할 수 있습니다. 만료된 경우 기존 관리자 접근 키로 로그인할 수 있습니다.
        </p>
      </div>
    </div></body></html>`;
  const textBody = `${CONFIG.SERVICE_NAME} 새 요청\n\n[${request.category}] ${request.title}\n장소: ${request.location}\n요청자: ${request.studentName} / ${request.studentId}\n요청 내용: ${request.content}\n등록: ${formatDateTime_(request.createdAt)}\n요청번호: ${request.requestId}\n\n관리자 자동 로그인: ${adminUrl}`;

  MailApp.sendEmail({
    to: CONFIG.ADMIN_EMAIL,
    subject: subject,
    htmlBody: htmlBody,
    body: textBody,
    name: CONFIG.SERVICE_NAME
  });

  {
    const now = new Date();
    // Preserve a concurrent administrator update or student deletion.
    const checking = row.status === "RECEIVED" && !isTrue_(row.is_deleted);
    sheet.getRange(row._rowNumber, 10, 1, 6).setValues([[
      checking ? "CHECKING" : row.status, sheetText_(row.admin_reply), now,
      row.is_deleted, row.deleted_at, now
    ]]);
    return checking;
  }
}

function sendDailyRequestSummary() {
  validateConfiguration_(true);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet_(false);
    const pending = readRows_(sheet).filter(row =>
      row.status === "RECEIVED" && !isTrue_(row.is_deleted) && !row.email_sent_at
    ).sort((a, b) => dateValue_(a.created_at) - dateValue_(b.created_at));
    if (!pending.length) {
      console.log("신규 RECEIVED 요청이 없어 메일을 발송하지 않았습니다.");
      return { sent: false, count: 0 };
    }

    const htmlBody = buildEmailHtml_(pending);
    const subject = `[${CONFIG.SERVICE_NAME}] 신규 학과 요청 ${pending.length}건이 접수되었습니다`;
    // sendEmail이 예외 없이 완료된 뒤에만 상태와 발송 시각을 변경한다.
    MailApp.sendEmail({ to: CONFIG.ADMIN_EMAIL, subject: subject, htmlBody: htmlBody, body: buildEmailText_(pending), name: CONFIG.SERVICE_NAME });

    const now = new Date();
    pending.forEach(row => {
      sheet.getRange(row._rowNumber, 10, 1, 6).setValues([["CHECKING", sheetText_(row.admin_reply), now, row.is_deleted, row.deleted_at, now]]);
    });
    invalidatePublic_();
    console.log(`${pending.length}건 메일 발송 및 CHECKING 전환 완료`);
    return { sent: true, count: pending.length };
  } catch (error) {
    console.error("일일 요약 메일 발송 실패: " + String(error && error.stack ? error.stack : error));
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function previewDailyRequestSummary() {
  validateConfiguration_(false);
  const pending = readRows_().filter(row => row.status === "RECEIVED" && !isTrue_(row.is_deleted) && !row.email_sent_at)
    .sort((a, b) => dateValue_(a.created_at) - dateValue_(b.created_at));
  if (!pending.length) { console.log("미리보기 대상 요청이 없습니다."); return ""; }
  const html = buildEmailHtml_(pending);
  console.log(html);
  return html;
}

function testDailyRequestSummary() {
  // 실제 메일을 발송하며, 성공한 대상은 CHECKING으로 변경된다.
  return sendDailyRequestSummary();
}

function createDailyTrigger() {
  validateConfiguration_(true);
  const functionName = "sendDailyRequestSummary";
  const existing = ScriptApp.getProjectTriggers().filter(trigger => trigger.getHandlerFunction() === functionName);
  if (existing.length) return `기존 트리거 ${existing.length}개를 유지했습니다.`;
  ScriptApp.newTrigger(functionName).timeBased().atHour(8).everyDays(1).inTimezone(CONFIG.TIMEZONE).create();
  return "매일 오전 8시대 트리거를 생성했습니다.";
}

function buildEmailHtml_(rows) {
  const today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy년 M월 d일");
  const cards = rows.map(row => {
    const content = escapeHtml_(row.content).replace(/\r?\n/g, "<br>");
    return `<div style="margin:0 0 16px;padding:20px;border:1px solid #dfe5ec;border-radius:14px;background:#ffffff;">
      <div style="margin-bottom:10px;color:#2875c7;font-size:13px;font-weight:700;">${escapeHtml_(row.category)}</div>
      <h2 style="margin:0 0 16px;color:#172333;font-size:19px;line-height:1.45;">${escapeHtml_(row.title)}</h2>
      <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;color:#344255;">
        <tr><td style="width:78px;padding:5px 0;color:#788495;">장소</td><td style="padding:5px 0;">${escapeHtml_(row.location)}</td></tr>
        <tr><td style="padding:5px 0;color:#788495;">요청자</td><td style="padding:5px 0;">${escapeHtml_(row.student_name)} / ${escapeHtml_(String(row.student_id))}</td></tr>
        <tr><td style="padding:5px 0;color:#788495;vertical-align:top;">요청 내용</td><td style="padding:5px 0;line-height:1.65;">${content}</td></tr>
        <tr><td style="padding:5px 0;color:#788495;">등록</td><td style="padding:5px 0;">${formatDateTime_(row.created_at)}</td></tr>
        <tr><td style="padding:5px 0;color:#788495;">요청번호</td><td style="padding:5px 0;font-family:monospace;">${escapeHtml_(row.request_id)}</td></tr>
      </table></div>`;
  }).join("");
  const adminUrl = CONFIG.SERVICE_URL.replace(/\/$/, "") + "/admin.html";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f2f5f8;font-family:Arial,'Apple SD Gothic Neo',sans-serif;color:#172333;">
    <div style="max-width:680px;margin:0 auto;padding:24px 12px;">
      <div style="padding:28px 24px;border-radius:18px 18px 0 0;background:#173b68;color:#ffffff;">
        <div style="font-size:24px;font-weight:800;">BigData Help</div><div style="margin-top:5px;color:#cfe0f2;font-size:14px;">학과 신규 요청 알림</div>
      </div>
      <div style="padding:24px;background:#ffffff;">
        <div style="color:#657285;font-size:13px;line-height:1.6;">한국폴리텍대학 서울강서캠퍼스<br>빅데이터소프트웨어공학과</div>
        <h1 style="margin:22px 0 8px;font-size:22px;">신규 요청 요약</h1>
        <p style="margin:0 0 22px;color:#516071;line-height:1.6;">${today}<br>오늘 확인이 필요한 새로운 요청이 <strong style="color:#173b68;">${rows.length}건</strong> 있습니다.</p>
        ${cards}
        <div style="padding:12px 0 8px;text-align:center;"><a href="${adminUrl}" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#2875c7;color:#ffffff;text-decoration:none;font-weight:700;">BigData Help 요청 확인하기</a></div>
        <p style="margin:22px 0 0;color:#7b8795;font-size:12px;line-height:1.65;text-align:center;">이 메일은 BigData Help에 새로 등록된 학과 요청을 자동으로 정리해 발송한 메일입니다.<br>메일 발송 후 해당 요청은 자동으로 '확인중' 상태로 변경됩니다.</p>
      </div></div></body></html>`;
}

function buildEmailText_(rows) {
  return `${CONFIG.SERVICE_NAME} 신규 요청 ${rows.length}건\n\n` + rows.map(row =>
    `[${row.category}] ${row.title}\n장소: ${row.location}\n요청자: ${row.student_name} / ${row.student_id}\n등록: ${formatDateTime_(row.created_at)}\n요청번호: ${row.request_id}`
  ).join("\n\n") + `\n\n관리자 페이지: ${CONFIG.SERVICE_URL.replace(/\/$/, "")}/admin.html`;
}

function getSheet_(createIfMissing) {
  const spreadsheetId = scriptProperty_("SPREADSHEET_ID");
  if (!spreadsheetId) throw new Error("SPREADSHEET_ID_NOT_CONFIGURED");
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  let sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet && createIfMissing) sheet = spreadsheet.insertSheet(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error("SHEET_NOT_FOUND");
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  const current = sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0];
  if (HEADERS.some((header, index) => current[index] !== header)) throw new Error("INVALID_SHEET_HEADERS");
  return sheet;
}

function readRows_(sheet) {
  sheet = sheet || getSheet_(true);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues().map((values, index) => {
    const row = { _rowNumber: index + 2 };
    HEADERS.forEach((header, column) => { row[header] = values[column]; });
    return row;
  });
}

function nextRequestId_(sheet, now) {
  const prefix = "REQ-" + Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyyMMdd") + "-";
  let max = 0;
  if (sheet.getLastRow() >= 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues().forEach(row => {
      if (row[0].indexOf(prefix) === 0) max = Math.max(max, Number(row[0].slice(prefix.length)) || 0);
    });
  }
  return prefix + String(max + 1).padStart(4, "0");
}

function studentView_(row) {
  return { requestId: row.request_id, createdAt: iso_(row.created_at), category: row.category, location: row.location,
    title: row.title, content: row.content, status: row.status, adminReply: row.admin_reply || "", updatedAt: iso_(row.updated_at) };
}
function assertAdmin_(params) {
  if (isAdminSessionValid_(params.adminSessionToken)) return;
  const accessKey = scriptProperty_("ADMIN_ACCESS_KEY");
  if (!accessKey || !secureEqual_(clean_(params.adminKey), accessKey)) {
    throw new Error("ADMIN_UNAUTHORIZED");
  }
}
function validateConfiguration_(requireEmail) {
  if (!scriptProperty_("SPREADSHEET_ID")) throw new Error("SPREADSHEET_ID_NOT_CONFIGURED");
  if (!scriptProperty_("ADMIN_ACCESS_KEY")) throw new Error("ADMIN_UNAUTHORIZED");
  if (requireEmail && (!CONFIG.ADMIN_EMAIL || CONFIG.ADMIN_EMAIL === "YOUR_ADMIN_EMAIL")) throw new Error("ADMIN_EMAIL_NOT_CONFIGURED");
}
function hashPin_(requestId, pin) {
  const spreadsheetId = scriptProperty_("SPREADSHEET_ID");
  if (!spreadsheetId) throw new Error("SPREADSHEET_ID_NOT_CONFIGURED");
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, `${spreadsheetId}:${requestId}:${pin}`, Utilities.Charset.UTF_8);
  return bytes.map(byte => (byte + 256) % 256).map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function secureEqual_(left, right) {
  left = String(left || ""); right = String(right || "");
  let result = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) result |= (left.charCodeAt(i % Math.max(1, left.length)) || 0) ^ (right.charCodeAt(i % Math.max(1, right.length)) || 0);
  return result === 0;
}
function isTrue_(value) { return value === true || String(value).toUpperCase() === "TRUE"; }
function clean_(value) { return String(value == null ? "" : value).trim(); }
function dateValue_(value) { const date = value instanceof Date ? value : new Date(value); return Number.isNaN(date.getTime()) ? 0 : date.getTime(); }
function iso_(value) { if (!value) return ""; const date = value instanceof Date ? value : new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toISOString(); }
function formatDateTime_(value) { const date = value instanceof Date ? value : new Date(value); return Utilities.formatDate(date, CONFIG.TIMEZONE, "yyyy.MM.dd HH:mm"); }
function escapeHtml_(value) { return String(value == null ? "" : value).replace(/[&<>\"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]); }
function safeErrorMessage_(error) {
  const allowed = ["VALIDATION_ERROR", "NOT_FOUND_OR_UNAUTHORIZED", "REQUEST_NOT_FOUND", "ADMIN_UNAUTHORIZED", "ADMIN_MAGIC_INVALID", "ADMIN_MAGIC_EXPIRED", "SPREADSHEET_ID_NOT_CONFIGURED", "ADMIN_EMAIL_NOT_CONFIGURED", "SHEET_NOT_FOUND", "INVALID_SHEET_HEADERS"];
  const message = error && error.message ? error.message : "SERVER_ERROR";
  return allowed.indexOf(message) > -1 ? message : "SERVER_ERROR";
}
function json_(success, data, message) {
  return ContentService.createTextOutput(JSON.stringify({ success: success, data: data, message: message })).setMimeType(ContentService.MimeType.JSON);
}

// A new generation prevents in-flight readers repopulating an invalidated key.
function invalidatePublic_() {
  SpreadsheetApp.flush();
  PropertiesService.getScriptProperties().setProperty("PUBLIC_REVISION", Utilities.getUuid());
}
function withMutation_(operation) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { const result = operation(); invalidatePublic_(); return result; }
  finally { lock.releaseLock(); }
}
function findRequest_(sheet, requestId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const cell = sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(requestId)
    .matchEntireCell(true).useRegularExpression(false).findNext();
  if (!cell) return null;
  const values = sheet.getRange(cell.getRow(), 1, 1, HEADERS.length).getValues()[0];
  const row = { _rowNumber: cell.getRow() };
  HEADERS.forEach((header, column) => { row[header] = values[column]; });
  return row;
}
function sheetText_(value) {
  // Sheets otherwise interprets a leading '=' as a formula.
  return /^[=+@-]/.test(value) || /^0\d+$/.test(value) ? "'" + value : value;
}
