import { createHmac } from 'node:crypto';

export function signEnvelope(payload, secret, timestamp = Date.now()) {
 const encoded = Buffer.from(JSON.stringify(payload),'utf8').toString('base64');
 return { timestamp, payload: encoded, signature: createHmac('sha256',secret).update(`${timestamp}.${encoded}`).digest('hex') };
}

export async function syncSheets(db, {fetcher=fetch, env=process.env}={}) {
 let client,locked=false;const started=Date.now();
 try {
  const url=env.SHEETS_WEB_APP_URL,secret=env.SHEETS_SYNC_SECRET,target=env.SHEETS_TARGET;
  if(!url||!secret||secret.length<32||!['test','production'].includes(target))return {pending:1,configured:false};
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url))return {pending:1,configured:false};
  // Previews must never write to the production sheet, even if env values are copied.
  if(target==='production'&&env.CONTEXT!=='production')return {pending:1,configured:false};
  client=await db.pool.connect();
  const lock=await client.query('SELECT pg_try_advisory_lock(672061610) AS locked');
  locked=lock.rows[0].locked;
  if(!locked)return {pending:1};
  const {rows}=await client.query('SELECT event_id,payload FROM inventory_sheets_outbox WHERE delivered_at IS NULL ORDER BY count_id LIMIT 10');
  for(const row of rows){
   if(Date.now()-started>12000)break;
   try{
    const envelope=signEnvelope({...row.payload,eventId:row.event_id,target},secret);
    const response=await fetcher(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(envelope),signal:AbortSignal.timeout(8000)});
    const ack=await response.json();
    if(!response.ok||ack.ok!==true||ack.eventId!==row.event_id||ack.target!==target)throw Error('Invalid acknowledgement');
    await client.query('UPDATE inventory_sheets_outbox SET delivered_at=NOW(),attempts=attempts+1,last_error=NULL WHERE event_id=$1',[row.event_id]);
   }catch{
    await client.query("UPDATE inventory_sheets_outbox SET attempts=attempts+1,last_error='Delivery not confirmed' WHERE event_id=$1",[row.event_id]);
    break;
   }
  }
  const count=await client.query('SELECT COUNT(*)::int AS pending FROM inventory_sheets_outbox WHERE delivered_at IS NULL');
  return {pending:count.rows[0].pending,configured:true};
 }catch{return {pending:1,configured:false};}
 finally {if(client){try{if(locked)await client.query('SELECT pg_advisory_unlock(672061610)')}finally{client.release()}}}
}
