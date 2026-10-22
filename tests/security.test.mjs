import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

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
  assert.equal(c.doGet({parameter:{action:'adminLogin',adminUsername:'demo',adminPassword:'wrong'}}).message, 'METHOD_NOT_ALLOWED');
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
  assert.equal(c.doPost({queryString:'action=adminLogin&adminPassword=url-password',postData:form}).message,'KEY_IN_URL_NOT_ALLOWED');
  assert.equal(c.doPost({queryString:'action=adminLogin&adminUsername=url-user',postData:form}).message,'KEY_IN_URL_NOT_ALLOWED');
  assert.equal(c.doPost({parameter:{action:'adminList',adminKey:'query-only'}}).params.adminKey,undefined);
  assert.equal(c.doPost({postData:{type:'application/json',contents:'{"action":"adminList","adminKey":"body-key"}'}}).params.adminKey,'body-key');
  assert.equal(c.doPost({postData:{type:'application/json',contents:'broken'}}).message,'INVALID_JSON');
});
test('frontend administrator login exchanges password for a session via POST', async () => {
  const calls = [];
  const context = vm.createContext({window:{APP_CONFIG:{API_URL:'https://example.test/exec'}},URLSearchParams,
    fetch:async (url,options) => {calls.push({url,options});return {ok:true,json:async()=>({success:true,data:{}})};}});
  vm.runInContext(readFileSync(new URL('../js/api.js',import.meta.url),'utf8'),context);
  await context.window.BigDataHelpAPI.adminLogin('demo-admin','test-only-password');
  await context.window.BigDataHelpAPI.adminList(true,'session-token');
  assert.equal(calls[0].url,'https://example.test/exec');
  assert.equal(calls[0].options.method,'POST');
  assert.equal(new URLSearchParams(calls[0].options.body).get('adminPassword'),'test-only-password');
  assert.equal(new URLSearchParams(calls[0].options.body).get('adminUsername'),'demo-admin');
  assert.equal(new URLSearchParams(calls[1].options.body).get('adminSessionToken'),'session-token');
  assert.equal(new URLSearchParams(calls[1].options.body).has('adminPassword'), false);
  assert.equal(new URLSearchParams(calls[1].options.body).has('adminKey'), false);
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
  await context.window.BigDataHelpAPI.adminList(false,'session-value');
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

test('administrator password bootstrap migrates to salted server-only digest and issues sessions', () => {
  const properties = new Map([['ADMIN_LOGIN_PASSWORD','test-only-password']]);
  const cache = new Map();
  let counter = 0;
  const context = vm.createContext({
    console,
    LockService: { getScriptLock: () => ({waitLock: () => {},releaseLock: () => {}}) },
    CacheService: { getScriptCache: () => ({
      get: key => cache.get(key) ?? null,
      put: (key,value) => cache.set(key,String(value)),
      remove: key => cache.delete(key)
    })},
    PropertiesService: {getScriptProperties: () => ({
      getProperty: key => properties.get(key) ?? null,
      setProperties: values => Object.entries(values).forEach(([key,value])=>properties.set(key,String(value))),
      deleteProperty: key => properties.delete(key)
    })},
    Utilities: {
      getUuid: () => String(++counter).padStart(32,'a'),
      DigestAlgorithm: {SHA_256:'SHA256'},
      Charset: {UTF_8:'UTF8'},
      computeDigest: (_algorithm,data) => Array.from(createHash('sha256').update(data).digest()).map(x=>x>127?x-256:x)
    }
  });
  vm.runInContext(source,context);
  assert.throws(() => context.adminLogin_({adminUsername:'nope',adminPassword:'test-only-password'}),/ADMIN_UNAUTHORIZED/);
  assert.throws(() => context.adminLogin_({adminUsername:'poly',adminPassword:'wrong'}),/ADMIN_UNAUTHORIZED/);
  const loggedIn = context.adminLogin_({adminUsername:'poly',adminPassword:'test-only-password'});
  assert.equal(context.isAdminSessionValid_(loggedIn.adminSessionToken),true);
  assert.equal(properties.has('ADMIN_LOGIN_PASSWORD'),false,'bootstrap password removed');
  assert.equal(properties.get('ADMIN_PASSWORD_HASH').length,64,'digest stored');
  assert.notEqual(properties.get('ADMIN_PASSWORD_HASH'),'test-only-password');
  assert.ok(properties.get('ADMIN_PASSWORD_SALT'));
  assert.ok(properties.get('ADMIN_PASSWORD_PEPPER'));
  assert.doesNotThrow(() => context.assertAdmin_({adminSessionToken:loggedIn.adminSessionToken}));
  assert.throws(() => context.assertAdmin_({adminKey:'legacy-only'}),/ADMIN_UNAUTHORIZED/);
  assert.throws(() => context.adminLogin_({adminUsername:'poly',adminPassword:'wrong'}),/ADMIN_UNAUTHORIZED/);
  const second = context.adminLogin_({adminUsername:'poly',adminPassword:'test-only-password'});
  assert.ok(second.adminSessionToken);
  context.adminLogout_({adminSessionToken:second.adminSessionToken});
  assert.equal(context.isAdminSessionValid_(second.adminSessionToken),false);
});

test('administrator password brute-force protection blocks repeated failures', () => {
  const cache=new Map();
  const context=vm.createContext({
    console,
    LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
    CacheService:{getScriptCache:()=>({
      get:key=>cache.get(key)??null,
      put:(key,value)=>cache.set(key,String(value)),
      remove:key=>cache.delete(key)
    })},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='ADMIN_LOGIN_PASSWORD'?'test-only-password':null})}
  });
  vm.runInContext(source,context);
  for(let i=0;i<5;i++)assert.throws(()=>context.adminLogin_({adminUsername:'poly',adminPassword:'wrong'}),/ADMIN_UNAUTHORIZED/);
  assert.throws(()=>context.adminLogin_({adminUsername:'poly',adminPassword:'test-only-password'}),/ADMIN_RATE_LIMITED/);
});

test('public admin page contains separate account fields and never a hard-coded password', () => {
  const html=readFileSync(new URL('../admin.html',import.meta.url),'utf8');
  const browser=readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
  assert.match(html,/name="adminUsername"/);
  assert.match(html,/name="adminPassword"/);
  assert.doesNotMatch(browser,/sessionStorage\.setItem\("bigDataHelpAdminKey"/);
  assert.doesNotMatch(html,/name="adminKey"/);
});

test('public request list supports safe pagination and never exposes private fields', () => {
  const c = server();
  c.readRows_ = () => Array.from({length: 45}, (_, index) => ({
    request_id: 'REQ-' + String(index + 1).padStart(4, '0'),
    created_at: new Date(Date.UTC(2026, 9, 21, 0, index)),
    status: index % 2 ? 'COMPLETED' : 'CHECKING',
    is_deleted: index === 20,
    student_id: 'private-id', student_name: 'private-name', pin: 'private-pin',
    category: '기타', location: '기타', title: '요청 ' + index
  }));
  const first = c.listPublic_({});
  assert.equal(first.pageSize, 10);
  assert.equal(first.requests.length, 10);
  assert.equal(first.total, 44);
  assert.equal(first.totalPages, 5);
  const second = c.listPublic_({page: 2, pageSize: 20});
  assert.equal(second.page, 2);
  assert.equal(second.requests.length, 20);
  assert.equal(second.totalPages, 3);
  assert.equal(JSON.stringify(second.requests).includes('private-id'), false);
  assert.equal(second.requests.every(item => !Object.hasOwn(item, 'studentName')), true);
  const last = c.listPublic_({page: 999, pageSize: 200, status: 'COMPLETED'});
  assert.equal(last.pageSize, 20);
  assert.equal(last.page, last.totalPages);
  assert.equal(last.requests.every(item => item.status === 'COMPLETED'), true);
});
