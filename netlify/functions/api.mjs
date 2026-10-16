import { createHash } from 'node:crypto';
import { syncSheets } from '../lib/sheets-sync.mjs';
import { database } from '../lib/database.mjs';
const respond=(v,s=200)=>Response.json(v,{status:s,headers:{'cache-control':'no-store'}});
const bad=(s,n=400)=>respond({error:s},n);
const clean=(s,n=300)=>String(s??'').trim().slice(0,n);
const validQty=(v)=>v!==''&&v!==null&&v!==undefined&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=100000000?Number(v):null;
const gtinValid=(ean)=>{if(!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(ean))return false;let a=ean.split('').map(Number);let d=a.pop();let s=a.reverse().reduce((r,x,i)=>r+x*(i%2?1:3),0);return(10-s%10)%10===d};
const isRequestId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
async function beginRequest(client,body,action){
 const hash=createHash('sha256').update(JSON.stringify({action,...body})).digest('hex');
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[body.requestId]);
 const prior=await client.query('SELECT payload_hash,response FROM inventory_requests WHERE request_id=$1',[body.requestId]);
 if(prior.rowCount){if(prior.rows[0].payload_hash!==hash)throw Error('Request ID reused with different payload');return prior.rows[0].response}
 await client.query('INSERT INTO inventory_requests(request_id,payload_hash) VALUES($1,$2)',[body.requestId,hash]);return null;
}
async function finishRequest(client,body,response){await client.query('UPDATE inventory_requests SET response=$1 WHERE request_id=$2',[JSON.stringify(response),body.requestId])}
export default async function handler(req){
 try{
  const pin=process.env.INVENTORY_PIN;
  if(!pin||pin.length<6)return bad('Configure INVENTORY_PIN (mínimo 6 caracteres) na Netlify.',503);
  if(req.headers.get('x-inventory-pin')!==pin)return bad('Senha inválida.',401);
  const db=database(),url=new URL(req.url),action=url.searchParams.get('action')||'summary';
  if(req.method==='GET'){
   if(action==='sync-status'){const [s]=await db.sql`SELECT COUNT(*) FILTER(WHERE delivered_at IS NULL)::int AS pending,COUNT(*) FILTER(WHERE delivered_at IS NOT NULL)::int AS delivered FROM inventory_sheets_outbox`;return respond(s)}
   if(action==='summary'){
    const [r]=await db.sql`SELECT COUNT(*)::int AS products,COUNT(*) FILTER(WHERE ean IS NOT NULL)::int AS mapped, COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM inventory_counts c WHERE c.product_code=p.code))::int AS counted FROM inventory_products p`;
    const [h]=await db.sql`SELECT COUNT(*)::int AS events FROM inventory_counts`;
    return respond({...r,...h});
   }
   if(action==='search'){
    const q=clean(url.searchParams.get('q'),120);if(!q)return respond({products:[]});
    const like='%'+q.toLowerCase()+'%';
    const rows=await db.sql`SELECT p.code,p.name,p.unit,p.ean,p.baseline_qty::float8,p.current_qty::float8,p.sale_price::float8,p.manufacturer,p.package_size,p.expiry_date,p.source, EXISTS(SELECT 1 FROM inventory_counts c WHERE c.product_code=p.code) AS counted FROM inventory_products p WHERE p.ean=${q} OR p.code=${q} OR LOWER(p.name) LIKE ${like} ORDER BY CASE WHEN p.ean=${q} THEN 0 WHEN p.code=${q} THEN 1 ELSE 2 END,p.name LIMIT 50`;
    return respond({products:rows});
   }
   if(action==='product'){
    const code=clean(url.searchParams.get('code'),80);
    const p=await db.sql`SELECT code,name,unit,ean,baseline_qty::float8,current_qty::float8,sale_price::float8,manufacturer,package_size,expiry_date,source FROM inventory_products WHERE code=${code}`;
    if(!p.length)return bad('Produto não encontrado.',404);
    const history=await db.sql`SELECT id,location,quantity::float8,delta::float8,kind,corrected_count_id,previous_entry_qty::float8,operator_name,created_at FROM inventory_counts WHERE product_code=${code} ORDER BY id ASC`;
    return respond({product:p[0],history,physicalTotal:history.reduce((a,h)=>a+Number(h.delta),0),counted:history.length>0});
   }
   if(action==='history'){
    const rows=await db.sql`SELECT c.id,c.product_code,p.name AS product_name,p.ean,p.manufacturer,p.package_size,p.expiry_date,c.location,c.quantity::float8,c.delta::float8,c.kind,c.corrected_count_id,c.previous_entry_qty::float8,c.operator_name,c.created_at FROM inventory_counts c JOIN inventory_products p ON p.code=c.product_code ORDER BY c.id DESC LIMIT 300`;
    return respond({rows});
   }
   if(action==='catalogue-history')return respond({rows:await db.sql`SELECT id,created_at,product_code,event_type,barcode,name,manufacturer,package_size,expiry_date,operator_name,details FROM inventory_catalog_events ORDER BY id`});
   if(action==='export'){
    const kind=url.searchParams.get('kind');
    if(kind==='history')return respond({rows:await db.sql`SELECT c.id,c.created_at,c.operator_name,c.product_code,p.ean,p.name AS product_name,p.manufacturer,p.package_size,p.expiry_date,c.location,c.kind,c.previous_entry_qty::float8,c.quantity::float8,c.delta::float8,c.corrected_count_id FROM inventory_counts c JOIN inventory_products p ON p.code=c.product_code ORDER BY c.id`});
    if(kind==='products')return respond({rows:await db.sql`SELECT p.code,p.ean,p.name,p.manufacturer,p.package_size,p.expiry_date,p.source,p.unit,p.sale_price::float8,p.baseline_qty::float8,COALESCE(SUM(c.delta),0)::float8 AS physical_total,COUNT(c.id)::int AS events, CASE WHEN COUNT(c.id)>0 THEN COALESCE(SUM(c.delta),0)-p.baseline_qty ELSE NULL END::float8 AS difference FROM inventory_products p LEFT JOIN inventory_counts c ON c.product_code=p.code GROUP BY p.code ORDER BY p.code`});
    return bad('Exportação inválida');
   }
   return bad('Ação desconhecida.',404);
  }
  if(req.method!=='POST')return bad('Método não aceito.',405);
  let body;try{body=await req.json()}catch{return bad('JSON inválido.')}
  if(['count','create'].includes(action)&&!isRequestId(body.requestId))return bad('Identificador da gravação ausente ou inválido.');
  if(action==='sync'){const result=await syncSheets(db);return respond(result)}
  if(action==='import'){
   const rows=body.products;
   if(!Array.isArray(rows)||rows.length<1||rows.length>200)return bad('Envie lotes de 1 a 200 produtos.');
   let client=await db.pool.connect();let inserted=0;
   try{await client.query('BEGIN');
    for(const p of rows){
     const code=clean(p.codigo,40),name=clean(p.nome),unit=clean(p.unidade,10)||'UN',qty=Number(p.estoque),price=Number(p.preco_venda),ean=clean(p.ean,20)||null;
     if(!code||!name||!Number.isFinite(qty)||!Number.isFinite(price))throw Error('Cadastro inválido no lote.');
     // Retém EAN inválido em branco; códigos conflitantes não são atribuídos incorretamente.
     const barcode=ean&&gtinValid(ean)?ean:null;
     try{
      const r=await client.query('INSERT INTO inventory_products(code,name,unit,baseline_qty,current_qty,sale_price,ean) VALUES($1,$2,$3,$4,$4,$5,$6) ON CONFLICT DO NOTHING',[code,name,unit,qty,price,barcode]);inserted+=r.rowCount;if(!r.rowCount&&barcode){const r2=await client.query('INSERT INTO inventory_products(code,name,unit,baseline_qty,current_qty,sale_price,ean) VALUES($1,$2,$3,$4,$4,$5,NULL) ON CONFLICT DO NOTHING',[code,name,unit,qty,price]);inserted+=r2.rowCount;}
     }catch(e){if(e.code==='23505'&&barcode){const r=await client.query('INSERT INTO inventory_products(code,name,unit,baseline_qty,current_qty,sale_price,ean) VALUES($1,$2,$3,$4,$4,$5,NULL) ON CONFLICT(code) DO NOTHING',[code,name,unit,qty,price]);inserted+=r.rowCount;}else throw e}
    }
    await client.query('COMMIT');return respond({inserted});
   }catch(e){if(client)await client.query('ROLLBACK');throw e}finally{if(client)client.release()}
  }
  if(action==='create'){
   const ean=clean(body.ean,20),name=clean(body.name,300),manufacturer=clean(body.manufacturer,200),size=clean(body.package_size,100),expiry=clean(body.expiry_date,10),operator=clean(body.operator,100),location=clean(body.location,80),qty=validQty(body.quantity);
   if(!gtinValid(ean))return bad('Confira o código EAN/GTIN. O dígito verificador é inválido ou o código está incompleto.');
   if(!name||!operator||!location||qty===null||!Number.isInteger(qty))return bad('Informe nome, responsável, local e quantidade inteira.');
   if(expiry&&!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(expiry))return bad('Data de validade inválida.');
   let client=await db.pool.connect();
   try{await client.query('BEGIN');
     const replay=await beginRequest(client,body,action);if(replay){await client.query('COMMIT');client.release();client=null;return respond({...replay,sheetsPending:(await syncSheets(db)).pending>0})}
     const exists=await client.query('SELECT code,name FROM inventory_products WHERE ean=$1 FOR UPDATE',[ean]);
     if(exists.rowCount){await client.query('ROLLBACK');return respond({error:'Este EAN já está cadastrado. Abra o produto existente em vez de duplicar.',existing:exists.rows[0]},409)}
     const id='NOVO-'+crypto.randomUUID();
     await client.query('INSERT INTO inventory_products(code,name,unit,baseline_qty,current_qty,sale_price,ean,manufacturer,package_size,expiry_date,source) VALUES($1,$2,$3,0,0,0,$4,$5,$6,$7,$8)',[id,name,'UN',ean,manufacturer,size,expiry||null,'foto/manual']);
     await client.query('INSERT INTO inventory_catalog_events(product_code,event_type,barcode,name,manufacturer,package_size,expiry_date,operator_name,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,'create',ean,name,manufacturer,size,expiry||null,operator,JSON.stringify({source:'photo_with_review'})]);
     const event=await client.query("INSERT INTO inventory_counts(product_code,location,quantity,delta,kind,operator_name) VALUES($1,$2,$3,$3,'count',$4) RETURNING id,created_at",[id,location,qty,operator]);
     await client.query('UPDATE inventory_products SET current_qty=$1 WHERE code=$2',[qty,id]);
     const response={saved:true,code:id,event:event.rows[0]};await finishRequest(client,body,response);await client.query('COMMIT');client.release();client=null;const sync=await syncSheets(db);return respond({...response,sheetsPending:sync.pending>0},201);
   }catch(e){if(client)await client.query('ROLLBACK');if(e.code==='23505')return bad('Este EAN já foi cadastrado. Consulte o produto pelo código.',409);throw e}finally{if(client)client.release()}
  }
  if(action==='catalogue-history'){
    return bad('Use GET para o histórico de cadastros.',405);
  }
  if(action==='map'){
   const code=clean(body.code,80),ean=clean(body.ean,20);
   if(!gtinValid(ean))return bad('EAN/GTIN inválido.');
   try{const r=await db.sql`UPDATE inventory_products SET ean=${ean},updated_at=NOW() WHERE code=${code} RETURNING code,ean`;return r.length?respond({product:r[0]}):bad('Produto não encontrado.',404)}catch(e){if(e.code==='23505')return bad('EAN já está associado a outro produto.',409);throw e}
  }
  if(action==='count'){
   const code=clean(body.code,80),location=clean(body.location,80),operator=clean(body.operator,100),qty=validQty(body.quantity),correctId=body.correctId===null||body.correctId===undefined?null:Number(body.correctId);
   if(!code||!location||!operator||qty===null||!Number.isInteger(qty)||qty<0)return bad('Informe operador, local e quantidade inteira válida.');
   if(correctId!==null&&(!Number.isInteger(correctId)||correctId<1))return bad('Contagem a corrigir inválida.');
   let client=await db.pool.connect();
   try{await client.query('BEGIN');
     const replay=await beginRequest(client,body,action);if(replay){await client.query('COMMIT');client.release();client=null;return respond({...replay,sheetsPending:(await syncSheets(db)).pending>0})}
    const p=await client.query('SELECT code,baseline_qty FROM inventory_products WHERE code=$1 FOR UPDATE',[code]);
    if(!p.rowCount){await client.query('ROLLBACK');return bad('Produto não encontrado.',404)}
    let delta=qty,previous=null,kind='count';
    if(correctId!==null){
     const existing=await client.query("SELECT id,quantity,kind,location FROM inventory_counts WHERE id=$1 AND product_code=$2 FOR UPDATE",[correctId,code]);
     if(!existing.rowCount||existing.rows[0].kind!=='count'){await client.query('ROLLBACK');return bad('Registro original não encontrado para corrigir.',404)}
     const entry=existing.rows[0];const changes=await client.query('SELECT COALESCE(SUM(delta),0) AS diff FROM inventory_counts WHERE corrected_count_id=$1',[correctId]);
     previous=Number(entry.quantity)+Number(changes.rows[0].diff);
     if(entry.location!==location){await client.query('ROLLBACK');return bad('Para corrigir uma contagem, mantenha o local original.',400)}
     delta=qty-previous;kind='correction';
    }
    const result=await client.query('INSERT INTO inventory_counts(product_code,location,quantity,delta,kind,corrected_count_id,previous_entry_qty,operator_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,created_at',[code,location,qty,delta,kind,correctId,previous,operator]);
    const total=await client.query('SELECT COALESCE(SUM(delta),0) AS total FROM inventory_counts WHERE product_code=$1',[code]);
    await client.query('UPDATE inventory_products SET current_qty=$1,updated_at=NOW() WHERE code=$2',[total.rows[0].total,code]);
    const response={saved:true,event:result.rows[0],physicalTotal:Number(total.rows[0].total),delta,kind};await finishRequest(client,body,response);await client.query('COMMIT');client.release();client=null;const sync=await syncSheets(db);return respond({...response,sheetsPending:sync.pending>0});
   }catch(e){if(client)await client.query('ROLLBACK');throw e}finally{if(client)client.release()}
  }
  return bad('Ação desconhecida.',404);
 }catch(e){console.error(e);return bad('Erro no servidor. Verifique os registros da função.',500)}
}
export const config={path:'/api/inventory'};
