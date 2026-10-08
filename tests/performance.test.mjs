import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const source = readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8');
const headers = ['request_id','created_at','student_id','student_name','pin','category','location','title','content','status','admin_reply','updated_at','is_deleted','deleted_at','email_sent_at'];
function server(code=source) {
 const data=[headers.slice()], cache=new Map(), props=new Map([['SPREADSHEET_ID','fixture'],['ADMIN_ACCESS_KEY','test-key']]);
 const metrics={opens:0,reads:0,cells:0,writes:0,mails:0,locks:0}; let locked=false, serial=0, failMail=false;
 const range=(r,c,h=1,w=1)=>({getValues(){metrics.reads++;metrics.cells+=h*w;return Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>data[r+i-1]?.[c+j-1]??''));},getDisplayValues(){return this.getValues().map(row=>row.map(String));},setValues(rows){metrics.writes++;rows.forEach((row,i)=>row.forEach((v,j)=>{data[r+i-1]??=[];data[r+i-1][c+j-1]=typeof v==='string'&&v.startsWith("'")?v.slice(1):v;}));return this;},setValue(v){return this.setValues([[v]]);},createTextFinder(value){return {matchEntireCell(){return this;},useRegularExpression(){return this;},findNext(){for(let i=r-1;i<r+h-1;i++)if(data[i]?.[c-1]===value)return {getRow:()=>i+1};return null;}};}});
 const sheet={getLastRow:()=>data.length,getRange:range,appendRow(row){range(data.length+1,1,1,row.length).setValues([row]);}};
 const c=vm.createContext({console,Date,encodeURIComponent,PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v)})},SpreadsheetApp:{openById(){metrics.opens++;return {getSheetByName:()=>sheet};},flush(){}},LockService:{getScriptLock:()=>({waitLock(){assert.equal(locked,false,'nested lock');locked=true;metrics.locks++;},releaseLock(){locked=false;}})},CacheService:{getScriptCache:()=>({get:k=>cache.get(k)??null,put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)})},Utilities:{getUuid:()=>String(++serial).padStart(64,'0'),formatDate:()=> '20261008',computeDigest:(_,s)=>[...createHash('sha256').update(s).digest()],DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1}},MailApp:{sendEmail(){assert.equal(locked,true,'mail must be serialized with summary');if(failMail)throw Error('quota');metrics.mails++;}}});
 vm.runInContext(code,c);
 const seed=(count=1)=>{for(let i=1;i<=count;i++){const id=`REQ-20261008-${String(i).padStart(4,'0')}`;data.push([id,new Date(2026,9,8,0,0,i),'00123','학생',c.hashPin_(id,'1234'),'기타','기타',`title ${i}`,'content','RECEIVED','',new Date(),false,'','']);}};
 return {c,data,cache,props,metrics,seed,setFailMail:v=>failMail=v,sheet};
}
test('public projection is cached without private fields and invalidated by update/delete/create',()=>{
 const f=server();f.seed();const id=f.data[1][0];
 assert.equal(f.c.listPublic_().counts.RECEIVED,1);const opens=f.metrics.opens;
 const cached=JSON.stringify(f.c.listPublic_());assert.equal(f.metrics.opens,opens);assert.doesNotMatch(cached,/student|pin|content|adminReply/);
 f.c.updateRequest_({requestId:id,status:'COMPLETED',adminReply:'=IMPORTXML("x")'});
 assert.equal(f.c.listPublic_().counts.COMPLETED,1);assert.equal(f.data[1][10],'=IMPORTXML("x")');
 f.c.deleteRequest_({requestId:id,studentId:'00123',pin:'1234'});assert.equal(f.c.listPublic_().requests.length,0);
 const r=f.c.createRequest_({studentId:'00123',studentName:'학생',pin:'1234',category:'기타',location:'기타',title:'=1+1',content:'내용'});
 assert.equal(r.status,'CHECKING');assert.equal(f.data[2][2],'00123');assert.equal(f.c.listPublic_().counts.CHECKING,1);
 assert.equal(f.metrics.mails,1);assert.equal(f.c.getMyRequests_({studentId:'00123',pin:'1234'}).length,1);
});
test('targeted writes use one sheet open, one row read and one batch write',()=>{
 const f=server();f.seed(1000);const id=f.data[500][0];f.c.updateRequest_({requestId:id,status:'PROCESSING',adminReply:'답변'});
 assert.equal(f.metrics.opens,1);assert.equal(f.metrics.cells,30);assert.equal(f.metrics.writes,1);
 assert.equal(f.data[500][9],'PROCESSING');assert.equal(f.data[499][9],'RECEIVED');
 assert.throws(()=>f.c.deleteRequest_({requestId:id,studentId:'00123',pin:'9999'}),/UNAUTHORIZED/);
 assert.equal(f.data[500][12],false);
});
test('mail failures preserve pending status; immediate and summary do not send twice',()=>{
 const f=server();f.seed();const id=f.data[1][0],r={requestId:id,title:'test',content:'test',createdAt:new Date()};
 f.setFailMail(true);assert.throws(()=>f.c.sendImmediateRequestNotification_(r),/quota/);assert.equal(f.data[1][9],'RECEIVED');assert.equal(f.data[1][14],'');
 f.setFailMail(false);f.c.sendDailyRequestSummary();f.c.sendImmediateRequestNotification_(r);assert.equal(f.metrics.mails,1);assert.equal(f.data[1][9],'CHECKING');
});
test('notification preserves administrator progress and ignores deleted requests',()=>{
 const f=server();f.seed(2);f.data[1][9]='COMPLETED';f.data[1][10]='답변';f.data[2][12]=true;
 assert.equal(f.c.sendImmediateRequestNotification_({requestId:f.data[1][0],title:'test',content:'test',createdAt:new Date()}),false);
 assert.equal(f.data[1][9],'COMPLETED');assert.equal(f.data[1][10],'답변');assert.ok(f.data[1][14]);
 f.c.sendImmediateRequestNotification_({requestId:f.data[2][0]});assert.equal(f.metrics.mails,1);
});
test('old-generation cache populated during a mutation is never selected again',()=>{
 const f=server();f.seed();f.c.listPublic_();const old=[...f.cache.keys()][0];
 f.c.deleteRequest_({requestId:f.data[1][0],studentId:'00123',pin:'1234'});
 f.cache.set(old,JSON.stringify({counts:{RECEIVED:999},requests:[]}));assert.equal(f.c.listPublic_().counts.RECEIVED,0);
});
test('concurrent private reads share one fetch, failures clear pending, writes are never coalesced',async()=>{
 const calls=[];let resolve;
 const c=vm.createContext({window:{APP_CONFIG:{API_URL:'https://test/exec'}},URLSearchParams,fetch:(url,options)=>{calls.push(options);return new Promise(r=>resolve=r);}});
 vm.runInContext(readFileSync(new URL('../js/api.js',import.meta.url),'utf8'),c);const api=c.window.BigDataHelpAPI;
 const a=api.myRequests('student','1234'),b=api.myRequests('student','1234');assert.equal(calls.length,1);
 resolve({ok:false,status:500});await assert.rejects(a,/HTTP_500/);await assert.rejects(b,/HTTP_500/);
 const d=api.myRequests('student','1234');assert.equal(calls.length,2);resolve({ok:true,json:async()=>({success:true,data:[]})});await d;
 const e=api.create({title:'a'});const r1=resolve;const g=api.create({title:'a'});assert.equal(calls.length,4);
 r1({ok:true,json:async()=>({success:true,data:{}})});resolve({ok:true,json:async()=>({success:true,data:{}})});await Promise.all([e,g]);
});
if(process.env.BASELINE_GAS) {
 test('baseline comparison: sheet operation counts on 1000 rows',()=>{
  const before=server(readFileSync(process.env.BASELINE_GAS,'utf8')),after=server();before.seed(1000);after.seed(1000);
  for(const f of [before,after]){f.c.listPublic_();f.c.listPublic_();}
  console.log('MEASURE public two loads',JSON.stringify({before:before.metrics,after:after.metrics}));
  for(const f of [before,after]){Object.keys(f.metrics).forEach(k=>f.metrics[k]=0);f.c.updateRequest_({requestId:f.data[500][0],status:'PROCESSING',adminReply:'답변'});}
  console.log('MEASURE update',JSON.stringify({before:before.metrics,after:after.metrics}));
 });
}
