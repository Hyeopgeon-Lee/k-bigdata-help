/** BigData Help - Google Apps Script Web App (V8 runtime) */
const CONFIG = Object.freeze({
  SPREADSHEET_ID: "1B7iS7AQqKORuNivoala5xcFyPEKlZ9bJKMwuJJkd-Kw",
  SHEET_NAME: "requests",
  ADMIN_EMAIL: "hglee67@kopo.ac.kr",
  ADMIN_ACCESS_KEY: "CHANGE_TO_A_LONG_RANDOM_KEY",
  TIMEZONE: "Asia/Seoul",
  SERVICE_NAME: "BigData Help",
  SERVICE_URL: "https://help.k-bigdata.kr/",
  MAX_TITLE_LENGTH: 80,
  MAX_CONTENT_LENGTH: 2000
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

function doGet(e) {
  return routeRequest_(e && e.parameter ? e.parameter : {});
}

function doPost(e) {
  let params = e && e.parameter ? e.parameter : {};
  if (e && e.postData && e.postData.type && e.postData.type.indexOf("application/json") > -1) {
    try { params = JSON.parse(e.postData.contents || "{}"); } catch (error) { return json_(false, null, "INVALID_JSON"); }
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
  try {
    const sheet = getSheet_(true);
    const now = new Date();
    const requestId = nextRequestId_(sheet, now);
    const pinHash = hashPin_(requestId, input.pin);
    sheet.appendRow([
      requestId, now, input.studentId, input.studentName, pinHash, input.category, input.location,
      input.title, input.content, "RECEIVED", "", now, false, "", ""
    ]);
    return { requestId: requestId, status: "RECEIVED", createdAt: now.toISOString() };
  } finally {
    lock.releaseLock();
  }
}

function listPublic_() {
  const rows = readRows_().filter(row => !isTrue_(row.is_deleted));
  const counts = { RECEIVED: 0, CHECKING: 0, PROCESSING: 0, COMPLETED: 0 };
  rows.forEach(row => { if (Object.prototype.hasOwnProperty.call(counts, row.status)) counts[row.status]++; });
  rows.sort((a, b) => dateValue_(b.created_at) - dateValue_(a.created_at));
  return {
    counts: counts,
    requests: rows.slice(0, 10).map(row => ({
      requestId: row.request_id, category: row.category, location: row.location, title: row.title,
      status: row.status, createdAt: iso_(row.created_at)
    }))
  };
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
  const requestId = clean_(params.requestId);
  const studentId = clean_(params.studentId);
  const pin = clean_(params.pin);
  if (!requestId || !studentId || !/^\d{4}$/.test(pin)) throw new Error("VALIDATION_ERROR");
  const sheet = getSheet_(false);
  const rows = readRows_();
  const row = rows.find(item => item.request_id === requestId && !isTrue_(item.is_deleted));
  if (!row || String(row.student_id) !== studentId || !secureEqual_(String(row.pin), hashPin_(requestId, pin))) throw new Error("NOT_FOUND_OR_UNAUTHORIZED");
  const now = new Date();
  sheet.getRange(row._rowNumber, HEADERS.indexOf("is_deleted") + 1).setValue(true);
  sheet.getRange(row._rowNumber, HEADERS.indexOf("deleted_at") + 1).setValue(now);
  sheet.getRange(row._rowNumber, HEADERS.indexOf("updated_at") + 1).setValue(now);
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
  const requestId = clean_(params.requestId);
  const status = clean_(params.status);
  const adminReply = clean_(params.adminReply);
  if (!requestId || STATUSES.indexOf(status) === -1 || adminReply.length > 2000) throw new Error("VALIDATION_ERROR");
  const sheet = getSheet_(false);
  const row = readRows_().find(item => item.request_id === requestId && !isTrue_(item.is_deleted));
  if (!row) throw new Error("REQUEST_NOT_FOUND");
  sheet.getRange(row._rowNumber, HEADERS.indexOf("status") + 1).setValue(status);
  sheet.getRange(row._rowNumber, HEADERS.indexOf("admin_reply") + 1).setValue(adminReply);
  sheet.getRange(row._rowNumber, HEADERS.indexOf("updated_at") + 1).setValue(new Date());
  return { requestId: requestId, status: status, adminReply: adminReply };
}

function sendDailyRequestSummary() {
  validateConfiguration_(true);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet_(false);
    const pending = readRows_().filter(row =>
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
      sheet.getRange(row._rowNumber, HEADERS.indexOf("status") + 1).setValue("CHECKING");
      sheet.getRange(row._rowNumber, HEADERS.indexOf("updated_at") + 1).setValue(now);
      sheet.getRange(row._rowNumber, HEADERS.indexOf("email_sent_at") + 1).setValue(now);
    });
    SpreadsheetApp.flush();
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
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet && createIfMissing) sheet = spreadsheet.insertSheet(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error("SHEET_NOT_FOUND");
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  const current = sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0];
  if (HEADERS.some((header, index) => current[index] !== header)) throw new Error("INVALID_SHEET_HEADERS");
  return sheet;
}

function readRows_() {
  const sheet = getSheet_(true);
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues().map((values, index) => {
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
  if (!CONFIG.ADMIN_ACCESS_KEY || CONFIG.ADMIN_ACCESS_KEY === "CHANGE_TO_A_LONG_RANDOM_KEY" || !secureEqual_(clean_(params.adminKey), CONFIG.ADMIN_ACCESS_KEY)) {
    throw new Error("ADMIN_UNAUTHORIZED");
  }
}
function validateConfiguration_(requireEmail) {
  if (!CONFIG.SPREADSHEET_ID || CONFIG.SPREADSHEET_ID === "YOUR_SPREADSHEET_ID") throw new Error("SPREADSHEET_ID_NOT_CONFIGURED");
  if (requireEmail && (!CONFIG.ADMIN_EMAIL || CONFIG.ADMIN_EMAIL === "YOUR_ADMIN_EMAIL")) throw new Error("ADMIN_EMAIL_NOT_CONFIGURED");
}
function hashPin_(requestId, pin) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, `${CONFIG.SPREADSHEET_ID}:${requestId}:${pin}`, Utilities.Charset.UTF_8);
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
  const allowed = ["VALIDATION_ERROR", "NOT_FOUND_OR_UNAUTHORIZED", "REQUEST_NOT_FOUND", "ADMIN_UNAUTHORIZED", "SPREADSHEET_ID_NOT_CONFIGURED", "ADMIN_EMAIL_NOT_CONFIGURED", "SHEET_NOT_FOUND", "INVALID_SHEET_HEADERS"];
  const message = error && error.message ? error.message : "SERVER_ERROR";
  return allowed.indexOf(message) > -1 ? message : "SERVER_ERROR";
}
function json_(success, data, message) {
  return ContentService.createTextOutput(JSON.stringify({ success: success, data: data, message: message })).setMimeType(ContentService.MimeType.JSON);
}
