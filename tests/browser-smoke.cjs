const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=process.cwd(), output=path.resolve(process.env.TEST_OUTPUT_DIR || '../browser-results');fs.mkdirSync(output,{recursive:true});
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://local').pathname==='/'?'index.html':new URL(req.url,'http://local').pathname);if(!file.startsWith(root)){res.writeHead(403).end();return;}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'image/svg+xml');res.end(data);});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r)); const base=`http://127.0.0.1:${server.address().port}`;
 let browser;const log=[];
 const fixture={requestId:'REQ-20261008-0001',createdAt:'2026-10-08T00:00:00Z',title:'테스트 요청 <script>',category:'기타',location:'기타',status:'RECEIVED',content:'요청 내용',studentId:'00123',studentName:'학생',adminReply:'',isDeleted:false};
 try {
 browser=await chromium.launch({headless:true,channel:"msedge"});
 for(const width of [320,390,768,1440]){
  const ctx=await browser.newContext({viewport:{width,height:900}}),page=await ctx.newPage(),calls=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('https://script.google.com/**',async route=>{
   const req=route.request(),p=new URLSearchParams(req.method()==='GET'?new URL(req.url()).search:req.postData());const action=p.get('action');calls.push(action);
   let data=action==='list'?{counts:{RECEIVED:1},requests:[fixture]}:action==='adminList'||action==='myRequests'?[fixture]:action==='update'?{requestId:fixture.requestId,status:p.get('status'),adminReply:p.get('adminReply')}:action==='delete'?{requestId:fixture.requestId,deleted:true}:{requestId:fixture.requestId,status:'CHECKING'};
   await route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,data})});
  });
  for(const file of ['index.html','request.html','my.html','admin.html']){
   await page.goto(base+'/'+file);
   if(file==='index.html')await page.locator('.ticket-card').waitFor();
   if(file==='request.html'){
    await page.locator('[name=studentId]').fill('00123');await page.locator('[name=studentName]').fill('학생');await page.locator('[name=pin]').fill('1234');await page.locator('[name=category]').selectOption('기타');await page.locator('[name=location]').selectOption('기타');await page.locator('[name=title]').fill('테스트');await page.locator('[name=content]').fill('내용');await page.locator('#submit-request').click();await page.locator('#request-success').waitFor();
   }
   if(file==='my.html'){
    await page.locator('[name=studentId]').fill('00123');await page.locator('[name=pin]').fill('1234');await page.locator('#lookup-form button').click();await page.locator('.delete-request').waitFor();await page.locator('.delete-request').click();await page.getByText('요청이 삭제되었습니다.',{exact:true}).waitFor();assert.equal(calls.filter(x=>x==='myRequests').length,1);
   }
   if(file==='admin.html'){
    await page.locator('[name=adminKey]').fill('fixture-key');await page.locator('#admin-auth button').click();await page.locator('.admin-ticket').waitFor();await page.locator('.admin-ticket summary').click();await page.locator('[name=status]').selectOption('COMPLETED');await page.locator('[name=adminReply]').fill('답변');await page.locator('.admin-update-form button').click();await page.getByText('저장되었습니다.',{exact:true}).waitFor();assert.equal(calls.filter(x=>x==='adminList').length,1);assert.equal(await page.locator('.badge').textContent(),'완료');
   }
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,`${width} ${file} overflows`);
   if(width===390)await page.screenshot({path:path.join(output,file.replace('.html','')+'-mobile.png'),fullPage:true});
   log.push({width,page:file,overflow});
  }
  assert.deepEqual(errors,[]);await ctx.close();
 }
 fs.writeFileSync(path.join(output,'browser-tests.json'),JSON.stringify({checks:log.length,results:log},null,2));console.log(JSON.stringify({checks:log.length,result:'passed',widths:[320,390,768,1440]}));
 }finally{if(browser)await browser.close();server.closeAllConnections();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

