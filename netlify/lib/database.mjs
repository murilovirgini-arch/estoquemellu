import { getDatabase } from '@netlify/database';
let cached;
export function database(){
 if(!cached){cached=getDatabase();cached.pool.on('error',()=>console.error('Database idle connection error'));}
 return cached;
}
