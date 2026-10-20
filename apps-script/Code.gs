const MELLU_SHEET_ID="1t2EiHO_OeP34lyCnm2PtC3u_biiH_sEOeET2rx0z6Tg";
function doGet(){return melluResponse({ok:true,version:"contagens-separadas-2026-10-20"});}
function melluInput(ss){
 var headers=["Data e Hora","Código EAN","Nome do Produto","Quantidade","Validade"];
 var sheet=ss.getSheetByName("Página1");
 if(sheet&&sheet.getLastRow()>0){
  var current=sheet.getRange(1,1,1,5).getDisplayValues()[0];
  if(current.join("|")!==headers.join("|")){
   var rows=sheet.getDataRange().getValues();
   var backupName="Página1 - anterior 20-10";
   var suffix=1;while(ss.getSheetByName(backupName))backupName="Página1 - anterior 20-10 ("+(suffix++)+")";
   sheet.setName(backupName);
   sheet=ss.insertSheet("Página1");
   sheet.getRange(1,1,1,5).setValues([headers]);
   var migrated=rows.slice(1).filter(function(r){return r[1]||r[2];}).map(function(r){
    var qty=r[3]!==""&&r[3]!=null?r[3]:r[8]!==""&&r[8]!=null?r[8]:r[6];
    return [r[0],String(r[1]||""),melluText(r[2]),qty==null?"":qty,r[9]||""];
   });
   if(migrated.length){sheet.getRange(2,2,migrated.length,1).setNumberFormat("@");sheet.getRange(2,1,migrated.length,5).setValues(migrated);}
  }
 }
 if(!sheet)sheet=ss.insertSheet("Página1");
 if(!sheet.getLastRow())sheet.getRange(1,1,1,5).setValues([headers]);
 sheet.setFrozenRows(1);
 return sheet;
}
function doPost(e){
 var lock=LockService.getScriptLock();
 try{
  var d=JSON.parse(e.postData.contents);
  var code=String(d.codigo||"").trim(),name=String(d.nome||"").trim(),qty=Number(d.estoque_real);
  if(!code||!name||d.estoque_real===""||!Number.isInteger(qty)||qty<0)throw Error("Produto ou quantidade inválida.");
  lock.waitLock(25000);
  var ss=SpreadsheetApp.openById(MELLU_SHEET_ID),sheet=melluInput(ss);
  var history=ss.getSheetByName("Histórico de Correções App");
  if(!history){history=ss.insertSheet("Histórico de Correções App");history.appendRow(["Data e Hora","EAN","Produto","Quantidade anterior","Quantidade atualizada","Estoque Sistema","Validade","ID do envio"]);history.setFrozenRows(1);}
  var hh=history.getRange(1,1,1,Math.max(8,history.getLastColumn())).getDisplayValues()[0];
  var idCol=hh.indexOf("ID do envio")+1;
  if(!idCol){idCol=history.getLastColumn()+1;history.getRange(1,idCol).setValue("ID do envio");}
  var requestId=String(d.request_id||Utilities.getUuid()).slice(0,120);
  var journal=ss.getSheetByName("Controle de Envios App");
  if(!journal){journal=ss.insertSheet("Controle de Envios App");journal.appendRow(["ID","Linha Página1","Linha Histórico","Estado","Confirmado em"]);journal.hideSheet();}
  var found=journal.getLastRow()>1?journal.getRange(2,1,journal.getLastRow()-1,1).createTextFinder(requestId).matchEntireCell(true).findNext():null;
  var jr,mainRow,historyRow;
  if(found){
   jr=found.getRow();var reserved=journal.getRange(jr,2,1,3).getValues()[0];mainRow=Number(reserved[0]);historyRow=Number(reserved[1]);
   if(reserved[2]==="confirmed"){
    if(String(history.getRange(historyRow,idCol).getValue())!==requestId)throw Error("O histórico foi alterado. Confira este registro.");
    return melluResponse({ok:true,status:"success",request_id:requestId,duplicate:true,linha:mainRow,historico_linha:historyRow,pagina1:true,historico:true});
   }
  }else{
   if(history.getLastRow()>1){
    var old=history.getRange(2,idCol,history.getLastRow()-1,1).createTextFinder(requestId).matchEntireCell(true).findNext();
    if(old)return melluResponse({ok:true,status:"success",request_id:requestId,duplicate:true,historico_linha:old.getRow(),legacy:true});
   }
   mainRow=sheet.getLastRow()+1;historyRow=history.getLastRow()+1;
   if(journal.getLastRow()>1)journal.getRange(2,2,journal.getLastRow()-1,2).getValues().forEach(function(r){mainRow=Math.max(mainRow,Number(r[0])+1);historyRow=Math.max(historyRow,Number(r[1])+1);});
   jr=journal.getLastRow()+1;journal.getRange(jr,1,1,4).setValues([[requestId,mainRow,historyRow,"pending"]]);SpreadsheetApp.flush();
  }
  var now=new Date(),validity=melluText(d.validade||"");
  var previous=Number.isFinite(Number(d.estoque_sistema))&&d.estoque_sistema!==""&&d.estoque_sistema!=null?Number(d.estoque_sistema):"";
  sheet.getRange(mainRow,2).setNumberFormat("@");
  sheet.getRange(mainRow,1,1,5).setValues([[now,code,melluText(name),qty,validity]]);
  history.getRange(historyRow,2).setNumberFormat("@");
  history.getRange(historyRow,1,1,7).setValues([[now,code,melluText(name),previous,qty,previous,validity]]);
  history.getRange(historyRow,idCol).setValue(requestId);
  SpreadsheetApp.flush();
  var readMain=sheet.getRange(mainRow,2,1,3).getValues()[0];
  if(String(readMain[0])!==code||Number(readMain[2])!==qty||String(history.getRange(historyRow,idCol).getValue())!==requestId||Number(history.getRange(historyRow,5).getValue())!==qty)throw Error("Não foi possível confirmar as duas abas. O envio será tentado novamente.");
  journal.getRange(jr,4,1,2).setValues([["confirmed",new Date()]]);SpreadsheetApp.flush();
  return melluResponse({ok:true,status:"success",request_id:requestId,linha:mainRow,historico_linha:historyRow,quantidade:qty,pagina1:true,historico:true});
 }catch(err){return melluResponse({ok:false,status:"error",message:String(err.message||err)});}
 finally{try{lock.releaseLock();}catch(ignore){}}
}
function melluText(v){var s=String(v==null?"":v).slice(0,500);return /^[=+@-]/.test(s)?"'"+s:s;}
function melluResponse(v){return ContentService.createTextOutput(JSON.stringify(v)).setMimeType(ContentService.MimeType.JSON);}
