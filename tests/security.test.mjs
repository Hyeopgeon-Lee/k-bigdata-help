import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
function server() {
  const context = vm.createContext({ console });
  vm.runInContext(source, context);
  vm.runInContext(`json_ = (success, data, message) => ({success, data, message});
    routeRequest_ = params => ({success:true, params});`, context);
  return context;
}
test('GET exposes only public list and never accepts an administrator key', () => {
  const c = server();
  assert.equal(c.doGet({parameter:{action:'list'}}).success, true);
  for (const action of ['adminList','update','create','myRequests','delete']) {
    assert.equal(c.doGet({parameter:{action,adminKey:'test-only-key'}}).message, 'METHOD_NOT_ALLOWED');
  }
  assert.equal(c.doGet({parameter:{action:'list',adminKey:'test-only-key'}}).success, false);
  assert.equal(c.doGet({parameter:{action:'list',adminSessionToken:'session-token'}}).message, 'METHOD_NOT_ALLOWED');
  assert.equal(c.doGet({parameter:{action:'list',magicToken:'magic-token'}}).message, 'METHOD_NOT_ALLOWED');
});
test('POST uses body only and rejects administrator keys in URL', () => {
  const c = server();
  const form = {type:'application/x-www-form-urlencoded', contents:'action=adminList&adminKey=test%2Bkey&adminReply=%ED%85%8C%EC%8A%A4%ED%8A%B8+%EB%8B%B5%EB%B3%80'};
  const r = c.doPost({parameter:{adminKey:'ignored-query'}, postData:form});
  assert.equal(r.params.adminKey, 'test+key');
  assert.equal(r.params.adminReply, '테스트 답변');
  assert.equal(c.doPost({queryString:'action=adminList&adminKey=url-key',postData:form}).message,'KEY_IN_URL_NOT_ALLOWED');
  assert.equal(c.doPost({queryString:'action=adminList&adminSessionToken=url-session',postData:form}).message,'KEY_IN_URL_NOT_ALLOWED');
  assert.equal(c.doPost({queryString:'action=redeemAdminMagic&magicToken=url-magic',postData:form}).message,'KEY_IN_URL_NOT_ALLOWED');
  assert.equal(c.doPost({parameter:{action:'adminList',adminKey:'query-only'}}).params.adminKey,undefined);
  assert.equal(c.doPost({postData:{type:'application/json',contents:'{"action":"adminList","adminKey":"body-key"}'}}).params.adminKey,'body-key');
  assert.equal(c.doPost({postData:{type:'application/json',contents:'broken'}}).message,'INVALID_JSON');
});
test('frontend administrator list transmits credentials in POST body only', async () => {
  const calls = [];
  const context = vm.createContext({window:{APP_CONFIG:{API_URL:'https://example.test/exec'}},URLSearchParams,
    fetch:async (url,options) => {calls.push({url,options});return {ok:true,json:async()=>({success:true,data:{}})};}});
  vm.runInContext(readFileSync(new URL('../js/api.js',import.meta.url),'utf8'),context);
  await context.window.BigDataHelpAPI.adminList(true,'test-only-key');
  assert.equal(calls[0].url,'https://example.test/exec');
  assert.equal(calls[0].options.method,'POST');
  assert.equal(new URLSearchParams(calls[0].options.body).get('adminKey'),'test-only-key');
});


test('administrator magic link uses URL fragment, is one-time, and creates a temporary session', () => {
  const cache = new Map();
  let counter = 0;
  const context = vm.createContext({
    console,
    encodeURIComponent,
    CacheService: {
      getScriptCache: () => ({
        put: (key, value) => cache.set(key, String(value)),
        get: (key) => cache.has(key) ? cache.get(key) : null,
        remove: (key) => cache.delete(key)
      })
    },
    Utilities: {
      getUuid: () => {
        counter += 1;
        return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
      }
    }
  });
  vm.runInContext(source, context);
  const link = context.createAdminMagicLink_('REQ-20261008-0001');
  assert.match(link, /\/admin\.html#magic=/);
  assert.doesNotMatch(link, /[?&]magic=/);
  const token = decodeURIComponent(link.split('#magic=')[1]);
  const redeemed = context.redeemAdminMagic_({magicToken: token});
  assert.equal(redeemed.requestId, 'REQ-20261008-0001');
  assert.equal(context.isAdminSessionValid_(redeemed.adminSessionToken), true);
  assert.throws(() => context.redeemAdminMagic_({magicToken: token}), /ADMIN_MAGIC_EXPIRED/);
});

test('frontend transmits magic and administrator session tokens only in POST bodies', async () => {
  const calls = [];
  const context = vm.createContext({
    window:{APP_CONFIG:{API_URL:'https://example.test/exec'}},
    URLSearchParams,
    fetch:async (url,options) => {
      calls.push({url,options});
      return {ok:true,json:async()=>({success:true,data:{adminSessionToken:'session-result'}})};
    }
  });
  vm.runInContext(readFileSync(new URL('../js/api.js',import.meta.url),'utf8'),context);
  await context.window.BigDataHelpAPI.redeemAdminMagic('magic-value');
  await context.window.BigDataHelpAPI.adminList(false,'','session-value');
  assert.equal(calls[0].url,'https://example.test/exec');
  assert.equal(new URLSearchParams(calls[0].options.body).get('magicToken'),'magic-value');
  assert.equal(calls[1].url,'https://example.test/exec');
  assert.equal(new URLSearchParams(calls[1].options.body).get('adminSessionToken'),'session-value');
});


test('learning report has a supported server-side category and online location', () => {
  const c = vm.createContext({ console });
  vm.runInContext(source, c);
  assert.equal(vm.runInContext('CATEGORIES.includes("학습문제 오류 신고")', c), true);
  assert.equal(vm.runInContext('LOCATIONS.includes("온라인 포털")', c), true);
});

test('learning report records a ticket and deduplicates identical rapid resubmissions', () => {
  const rows = [];
  const sheet = { appendRow: row => rows.push(row), getLastRow: () => rows.length + 1 };
  const c = vm.createContext({
    console,
    LockService: { getScriptLock: () => ({waitLock: () => {}, releaseLock: () => {}}) }
  });
  vm.runInContext(source, c);
  c.getSheet_ = () => sheet;
  c.nextRequestId_ = () => 'REQ-20261009-0001';
  c.hashPin_ = () => 'hashed';
  c.sendImmediateRequestNotification_ = () => false;
  const report = [
    '문제 유형: 실기문제',
    '문제 ID: R-IND-JAVA-0006',
    '문제 코드: R-IND-JAVA-0006',
    '문제 제목: 배열 출력',
    '문제 화면: https://portal.k-bigdata.kr/practical.html?id=R-IND-JAVA-0006',
    '오류 구분: 정답 오류',
    '신고 내용:',
    '출력 값이 다릅니다.'
  ].join('\n');
  const input = {
    studentId:'20260001', studentName:'학생', pin:'1234',
    category:'학습문제 오류 신고', location:'온라인 포털',
    title:'[실기문제 오류] R-IND-JAVA-0006', content:report
  };
  c.readRows_ = () => [];
  const first = c.createRequest_(input);
  assert.equal(first.requestId, 'REQ-20261009-0001');
  assert.equal(rows.length, 1);
  assert.equal(rows[0][5], '학습문제 오류 신고');
  c.readRows_ = () => [{
    student_id:'20260001', category:'학습문제 오류 신고', content:report,
    created_at:new Date(), request_id:first.requestId, status:'RECEIVED', is_deleted:false
  }];
  const duplicate = c.createRequest_(input);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.requestId, first.requestId);
  assert.equal(rows.length, 1);
  assert.throws(() => c.createRequest_({...input, content:'신고 내용 없음'}), /VALIDATION_ERROR/);
  assert.throws(() => c.createRequest_({...input, location:'8315호'}), /VALIDATION_ERROR/);
});

test('learning report Help Desk browser code parses with no syntax errors', () => {
  for (const path of ['../js/request.js', '../js/admin.js', '../js/config.js']) {
    assert.doesNotThrow(() => new vm.Script(readFileSync(new URL(path, import.meta.url), 'utf8')));
  }
  const config = vm.createContext({ window:{} });
  vm.runInContext(readFileSync(new URL('../js/config.js', import.meta.url), 'utf8'), config);
  assert.ok(Array.from(config.window.APP_CONFIG.REQUEST_CATEGORIES).includes('학습문제 오류 신고'));
  assert.ok(Array.from(config.window.APP_CONFIG.LOCATIONS).includes('온라인 포털'));
});
