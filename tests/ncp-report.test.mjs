import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const request=read("js/request.js"),admin=read("js/admin.js");
const requestHtml=read("request.html"),adminHtml=read("admin.html");

assert.match(request,/ncp: "ncp\.html"/,"The help form should permit NCP problem URLs");
assert.match(request,/source === "ncp" \? "NCP 기출문제"/);
assert.match(request,/ncp: \["문제 내용 오류", "선택지 오류", "복원 정답 오류"/);
assert.match(request,/problem\.origin !== "https:\/\/portal\.k-bigdata\.kr"/);
assert.match(request,/problem\.pathname !== "\/" \+ page/);
assert.match(request,/problem\.searchParams\.get\("id"\) !== id/);
assert.match(admin,/NCP 기출문제\)\$\/m/);
assert.match(admin,/type === "NCP 기출문제" \? "\/ncp\.html"/);
assert.match(admin,/type === "NCP 기출문제" \? "ncp"/);
assert.match(adminHtml,/<option value="ncp">NCP 기출문제 신고<\/option>/);
assert.match(requestHtml,/request\.js\?v=20261027-ncp-report-1/);
assert.match(adminHtml,/admin\.js\?v=20261027-ncp-report-1/);
console.log("PASS: NCP reports are validated, categorized, and linked in the help admin.");
