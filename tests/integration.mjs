import assert from 'node:assert/strict';
import { randomUUID,createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { NetlifyDB } from '@netlify/database-dev';
import { database } from '../netlify/lib/database.mjs';
import handler from '../netlify/functions/api.mjs';
import { signEnvelope,syncSheets } from '../netlify/lib/sheets-sync.mjs';

const local=new NetlifyDB({logger:()=>{}});
process.env.INVENTORY_PIN='test-only-pin-123';
delete process.env.SHEETS_WEB_APP_URL;
delete process.env.SHEETS_SYNC_SECRET;
const secret='local-test-secret-only-01234567890123456789';
let checks=0;
function check(value,message){assert(value,message);checks++;}
async function call(action,body,pin=process.env.INVENTORY_PIN){
 const response=await handler(new Request('https://example.test/api/inventory?action='+action,{method:body?'POST':'GET',headers:{'x-inventory-pin':pin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}));
 return {status:response.status,...await response.json()};
}
try{
 process.env.NETLIFY_DB_URL=await local.start();
 const applied=await local.applyMigrations('./netlify/database/migrations');
 check(applied.length===4,'All four migrations apply');
 const db=database();
 check((await call('summary',null,'invalid')).status===401,'Unauthenticated access rejected');
 const sample={codigo:'fixture-1',nome:'Produto de teste',unidade:'UN',estoque:9,preco_venda:1,ean:'7898413331346'};
 check((await call('import',{products:[sample]})).inserted===1,'Catalogue import works');
 check((await call('import',{products:[sample]})).inserted===0,'Repeat import preserves existing catalogue');
 check((await call('search&q='+encodeURIComponent('Produto de teste'))).products.length===1,'Search parameters reach backend');
 const payload={requestId:randomUUID(),code:sample.codigo,quantity:3,operator:'Teste',location:'Estoque interno'};
 const first=await call('count',payload);
 check(first.status===200&&first.physicalTotal===3&&first.sheetsPending,'Committed write reports pending Sheets honestly');
 check((await call('count',payload)).event.id===first.event.id,'Retry does not duplicate count');
 const second=await call('count',{...payload,requestId:randomUUID(),location:'Mostruário'});
 check(second.physicalTotal===6,'Independent locations sum to six');
 const correction=await call('count',{...payload,requestId:randomUUID(),quantity:2,correctId:Number(first.event.id)});
 check(correction.physicalTotal===5&&correction.delta===-1,'Correction appends compensation');
 const detail=await call('product&code='+sample.codigo);
 check(detail.history.length===3&&detail.product.baseline_qty===9,'Original stock and append-only history preserved');
 const invalid=await call('count',{...payload,requestId:randomUUID(),quantity:-1});
 check(invalid.status===400,'Invalid quantity rejected');
 const createPayload={requestId:randomUUID(),ean:'7898413330578',name:'Novo teste',manufacturer:'Marca',package_size:'200 ml',expiry_date:'2027-09-01',operator:'Teste',location:'Mostruário',quantity:1};
 const created=await call('create',createPayload);
 check(created.status===201,'New product and first count commit together');
 check((await call('product&code='+created.code)).product.name==='Novo teste','Full generated product code remains searchable');
 check((await call('create',createPayload)).event.id===created.event.id,'Retry of create is idempotent');
 const env={SHEETS_WEB_APP_URL:'https://script.google.com/macros/s/test/exec',SHEETS_SYNC_SECRET:secret,SHEETS_TARGET:'test',CONTEXT:'deploy-preview'};
 const seen=new Set();let deliveries=0;
 const fetcher=async(url,request)=>{
  const envelope=JSON.parse(request.body);
  assert.equal(envelope.signature,createHmac('sha256',secret).update(`${envelope.timestamp}.${envelope.payload}`).digest('hex'));
  const payload=JSON.parse(Buffer.from(envelope.payload,'base64').toString());seen.add(payload.eventId);deliveries++;
  return Response.json({ok:true,eventId:payload.eventId,target:payload.target});
 };
 const failed=await syncSheets(db,{env,fetcher:async()=>{throw Error('offline')}});
 check(failed.pending===4,'Network failure retains all queued events');
 const synced=await syncSheets(db,{env,fetcher});
 check(synced.pending===0&&seen.size===4,'Acknowledged events marked delivered');
 await syncSheets(db,{env,fetcher});check(deliveries===4,'Delivered events are not resent');
 const blocked=await syncSheets(db,{env:{...env,SHEETS_TARGET:'production'},fetcher:()=>{throw Error('Must not call')}});
 check(blocked.configured===false,'Preview cannot write production sheet');
 const ack=await call('export&kind=history');check(ack.rows.length===4,'Full audit export available');

 // Execute actual Apps Script source against an in-memory Sheets API double.
 const sheets=new Map([['Página1',[['Dado existente']]]]);
 function range(rows,row,col,numRows=1,numCols=1){return {
  getValues:()=>Array.from({length:numRows},(_,r)=>Array.from({length:numCols},(_,c)=>rows[row-1+r]?.[col-1+c]??'')),
  setValues:values=>{values.forEach((v,r)=>{rows[row-1+r]??=[];v.forEach((cell,c)=>rows[row-1+r][col-1+c]=cell)});},
  setNumberFormat:()=>{},
  createTextFinder:value=>({matchEntireCell(){return this},findNext:()=>rows.slice(row-1,row-1+numRows).some(r=>r[col-1]===value)?{}:null})
 }}
 function sheet(rows){return {getRange:(...args)=>range(rows,...args),setFrozenRows:()=>{},getLastRow:()=>rows.length}}
 const context={PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='MELLU_SYNC_SECRET'?secret:'fixture-sheet'})},
 Utilities:{computeHmacSha256Signature:(value,key)=>[...createHmac('sha256',key).update(value).digest()].map(b=>b>127?b-256:b),base64Decode:s=>Buffer.from(s,'base64'),newBlob:b=>({getDataAsString:()=>b.toString('utf8')})},
 SpreadsheetApp:{openById:()=>({getSheetByName:name=>sheets.has(name)?sheet(sheets.get(name)):null,insertSheet:name=>{const rows=[];sheets.set(name,rows);return sheet(rows)}}),flush:()=>{}},
 LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
 ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})}};
 vm.createContext(context);vm.runInContext(await readFile(new URL('../apps-script/MelLuSync.gs',import.meta.url),'utf8'),context);
 const event={eventId:randomUUID(),target:'test',countId:'1',ean:'0123456789012',name:'=IMPORTXML("bad")',quantity:3,baseline:9,physicalTotal:3,delta:3};
 const envelope=signEnvelope(event,secret);
 const post=value=>context.melluHandleSignedPost({postData:{contents:JSON.stringify(value)}});
 check(post(envelope).ok,'Apps Script accepts signed event');
 check(post(envelope).duplicate,'Apps Script deduplicates retry');
 const rows=sheets.get('Teste de Integração v2');
 check(rows.length===2&&rows[1][1]===event.ean,'One data row; barcode leading zero retained');
 check(rows[1][3].startsWith("'="),'Sheet formula injection neutralized');
 check(!post({...envelope,signature:'0'.repeat(64)}).ok,'Invalid signature rejected');
 check(!post(signEnvelope(event,secret,Date.now()-600001)).ok,'Expired event rejected');
 check(sheets.get('Página1')[0][0]==='Dado existente'&&!sheets.has('Histórico de Inventário v2'),'Existing and production tabs untouched by tests');
 const lostEvent=await call('count',{...payload,requestId:randomUUID(),quantity:1});
 check(lostEvent.status===200,'Additional retry fixture committed');
 const lostFetcher=async(url,request)=>{const ack=post(JSON.parse(request.body));assert.equal(ack.ok,true);throw Error('Acknowledgement lost')};
 const pending=await syncSheets(db,{env,fetcher:lostFetcher});
 check(pending.pending===1,'Lost acknowledgement remains pending');
 const beforeRetry=sheets.get('Teste de Integração v2').length;
 const recovered=await syncSheets(db,{env,fetcher:async(url,request)=>Response.json(post(JSON.parse(request.body)))});
 check(recovered.pending===0&&sheets.get('Teste de Integração v2').length===beforeRetry,'Lost acknowledgement retry does not duplicate a sheet row');
 await db.pool.end();
 console.log(`PASS: ${checks} integration checks. Local DB and simulated Apps Script only; no hosted writes.`);
}finally{await local.stop()}
