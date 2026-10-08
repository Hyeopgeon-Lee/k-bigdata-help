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
    LockService: { getScriptLock: () => ({waitLock() {}, releaseLock() {}}) },
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
