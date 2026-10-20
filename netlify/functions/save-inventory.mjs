const SCRIPT_URL="https://script.google.com/macros/s/AKfycbyrXSDBiPYgHSfX7xSQBnOlVH2ChQNSvEieKJXE_Dzp_A87YThmrgax8852Q8HDE_3Z/exec";
const reply=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export default async function(req){
 if(req.method!=="POST")return reply({ok:false,error:"Método não permitido."},405);
 const origin=req.headers.get("origin");if(origin&&origin!==new URL(req.url).origin)return reply({ok:false,error:"Origem não permitida."},403);
 try{
  const raw=await req.text();if(raw.length>10000)return reply({ok:false,error:"Registro muito grande."},413);
  const d=JSON.parse(raw);
  if(!/^[a-zA-Z0-9_-]{8,120}$/.test(d.request_id||"")||!String(d.codigo||"").trim()||!String(d.nome||"").trim()||!Number.isInteger(d.estoque_real)||d.estoque_real<0)return reply({ok:false,error:"Confira código, nome e quantidade."},400);
  const upstream=await fetch(SCRIPT_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(d),redirect:"follow",signal:AbortSignal.timeout(45000)});
  const result=await upstream.json().catch(()=>null);
  if(!upstream.ok||!result)return reply({ok:false,error:"O Google não confirmou o recebimento. O registro continua pendente."},502);
  if(result.ok!==true)return reply({ok:false,error:result.message||"A planilha recusou o registro."},result.status==="conflict"?409:502);
  if(result.request_id!==d.request_id)return reply({ok:false,error:"A planilha ainda não confirmou o ID deste envio. O registro permanece pendente."},502);
  if(!result.legacy&&(result.pagina1!==true||result.historico!==true))return reply({ok:false,error:"A gravação nas duas abas ainda não foi confirmada. O envio permanece pendente."},502);
  return reply(result);
 }catch(e){return reply({ok:false,error:e.name==="TimeoutError"?"O Google demorou para responder. O registro continua pendente.":"Falha de conexão com a planilha. O registro continua pendente."},502);}
}
