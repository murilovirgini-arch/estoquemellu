function doGet() { return melluResponse({ok:true,version:"confirmacao-2026-10-20"}); }
function doPost(e) {
 var lock=LockService.getScriptLock();
 try {
  var d=JSON.parse(e.postData.contents);
  var code=String(d.codigo||"").trim();
  var qty=Number(d.estoque_real);
  if(!code||!String(d.nome||"").trim()||d.estoque_real===""||!Number.isInteger(qty)||qty<0)throw Error("Produto ou quantidade invalida");
  lock.waitLock(20000);
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var sheet=ss.getSheetByName("Página1");
  if(!sheet)throw Error("Aba Página1 nao encontrada");
  var norm=function(v){return String(v).replace(/[^0-9]/g,"")};
  var last=sheet.getLastRow(),row=0;
  if(last>1){
   var codes=sheet.getRange(2,2,last-1,1).getDisplayValues();
   for(var i=codes.length-1;i>=0;i--)if(norm(codes[i][0])===norm(code)&&norm(code)){row=i+2;break;}
  }
  var history=ss.getSheetByName("Histórico de Correções App");
  if(!history){history=ss.insertSheet("Histórico de Correções App");history.appendRow(["Data e Hora","EAN","Produto","Quantidade anterior","Quantidade atualizada","Estoque Sistema","Validade","ID do envio"]);history.setFrozenRows(1);}
  history.getRange(1,8).setValue("ID do envio");
  var requestId=String(d.request_id||"").slice(0,120);
  if(requestId&&history.getLastRow()>1){
    var duplicate=history.getRange(2,8,history.getLastRow()-1,1).createTextFinder(requestId).matchEntireCell(true).findNext();
    if(duplicate)return melluResponse({ok:true,status:"success",request_id:requestId,duplicate:true});
  }
  var original="",previous="";
  if(row){original=sheet.getRange(row,8).getValue();previous=sheet.getRange(row,9).getValue();}
  else {row=last+1;sheet.getRange(row,2).setNumberFormat("@");sheet.getRange(row,2).setValue(code);sheet.getRange(row,3).setValue(melluText(d.nome));}
  if(d.recovery&&row<=last){
    var savedDate=sheet.getRange(row,1).getValue();
    if(savedDate instanceof Date&&savedDate.getTime()>new Date(d.data).getTime()&&Number(sheet.getRange(row,9).getValue())!==qty)
      return melluResponse({ok:false,status:"conflict",message:"A planilha tem uma alteração mais recente. Confira a quantidade antes de reenviar."});
  }
  sheet.getRange(row,1).setValue(new Date());
  sheet.getRange(row,4).setValue(qty);
  sheet.getRange(row,9).setValue(qty);
  if(d.validade)sheet.getRange(row,10).setValue(melluText(d.validade));

  var nr=history.getLastRow()+1;
  history.getRange(nr,2).setNumberFormat("@");
  history.getRange(nr,1,1,8).setValues([[new Date(),code,melluText(d.nome),previous,qty,original,melluText(d.validade||""),requestId]]);
  SpreadsheetApp.flush();
  return melluResponse({status:"success",ok:true,request_id:requestId,linha:row,quantidade:qty});
 }catch(err){return melluResponse({status:"error",ok:false,message:String(err.message||err)});}
 finally{try{lock.releaseLock()}catch(ignore){}}
}
function melluText(v){var s=String(v||"").slice(0,500);return /^[=+@-]/.test(s)?"'"+s:s;}
function melluResponse(v){return ContentService.createTextOutput(JSON.stringify(v)).setMimeType(ContentService.MimeType.JSON);}
