import { database } from '../lib/database.mjs';
import { syncSheets } from '../lib/sheets-sync.mjs';
export default async () => {
 if(process.env.CONTEXT!=='production')return new Response(null,{status:204});
 const result=await syncSheets(database());
 return Response.json(result);
};
export const config={schedule:'*/5 * * * *'};
