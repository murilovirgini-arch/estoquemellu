/** Add this file to the EXISTING project only after reviewing its current doPost.
 * Route doPost(e) to melluHandleSignedPost(e) during coordinated cutover.
 * Script Properties (never source): MELLU_SPREADSHEET_ID, MELLU_SYNC_SECRET.
 * Existing sheets are not modified. Test and production have separate new tabs.
 */
function melluHandleSignedPost(e) {
 try {
  var props=PropertiesService.getScriptProperties();
  var secret=props.getProperty('MELLU_SYNC_SECRET');
  var spreadsheetId=props.getProperty('MELLU_SPREADSHEET_ID');
  if(!secret||secret.length<32||!spreadsheetId)throw Error('Not configured');
  var envelope=JSON.parse(e.postData.contents);
  if(typeof envelope.payload!=='string'||envelope.payload.length>40000||!Number.isFinite(envelope.timestamp)||Math.abs(Date.now()-envelope.timestamp)>300000)throw Error('Expired');
  var expected=Utilities.computeHmacSha256Signature(String(envelope.timestamp)+'.'+envelope.payload,secret).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2)}).join('');
  if(!melluEqualSignature_(expected,envelope.signature))throw Error('Invalid signature');
  var payload=JSON.parse(Utilities.newBlob(Utilities.base64Decode(envelope.payload)).getDataAsString('UTF-8'));
  if(!/^[0-9a-f-]{36}$/i.test(payload.eventId)||['test','production'].indexOf(payload.target)<0)throw Error('Invalid event');
  var lock=LockService.getScriptLock();lock.waitLock(20000);
  try{
   var ss=SpreadsheetApp.openById(spreadsheetId);
   var title=payload.target==='test'?'Teste de Integração v2':'Histórico de Inventário v2';
   var headers=['Data e Hora','Código EAN','Código Interno','Nome do Produto','Fabricante / Marca','Conteúdo da Embalagem','Quantidade Contada','Localização','Estoque Original','Total Acumulado','Data de Validade','Tipo de Registro','Responsável','Variação','Contagem Corrigida','ID do Evento','ID da Contagem'];
   var sheet=ss.getSheetByName(title);
   if(!sheet){sheet=ss.insertSheet(title);sheet.getRange(1,1,1,headers.length).setValues([headers]);sheet.setFrozenRows(1);}
   var actual=sheet.getRange(1,1,1,headers.length).getValues()[0];
   if(JSON.stringify(actual)!==JSON.stringify(headers))throw Error('Unexpected headers');
   var last=sheet.getLastRow();
   var found=last>1?sheet.getRange(2,16,last-1,1).createTextFinder(payload.eventId).matchEntireCell(true).findNext():null;
   if(!found){
    var row=[payload.createdAt,payload.ean||'',payload.code,payload.name,payload.manufacturer||'',payload.packageSize||'',payload.quantity,payload.location,payload.baseline,payload.physicalTotal,payload.expiry||'',payload.kind,payload.operator,payload.delta,payload.correctedCountId||'',payload.eventId,payload.countId];
    // Keep EANs and identifiers as text, including leading zeroes.
    [2,3,11,15,16,17].forEach(function(col){sheet.getRange(last+1,col).setNumberFormat('@')});
    sheet.getRange(last+1,1,1,row.length).setValues([row.map(melluSafeCell_)]);
    SpreadsheetApp.flush();
   }
   return melluJson_({ok:true,eventId:payload.eventId,target:payload.target,duplicate:!!found});
  }finally{lock.releaseLock()}
 }catch(error){return melluJson_({ok:false,error:'Request rejected'});}
}
function melluEqualSignature_(a,b){if(typeof b!=='string'||b.length!==a.length)return false;var diff=0;for(var i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function melluSafeCell_(value){return typeof value==='string'&&/^[\s]*[=+@-]/.test(value)?"'"+value:value;}
function melluJson_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
