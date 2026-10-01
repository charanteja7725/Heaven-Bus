import { MongoClient, type Db, type ClientSession } from 'mongodb';
export type Store = { client: MongoClient; db: Db; holdMs: number };
export class AppError extends Error { constructor(public status: number, message: string, public code='REQUEST_FAILED') { super(message); } }
export const col = (s: Store, name: string) => s.db.collection<any>(name);
export async function initialize(s: Store) {
  await Promise.all([
    col(s,'users').createIndex({email:1},{unique:true}),
    col(s,'seats').createIndex({tripId:1,seatId:1},{unique:true}),
    col(s,'seats').createIndex({state:1,expiresAt:1}),
    col(s,'holds').createIndex({userId:1},{unique:true,partialFilterExpression:{active:true}}),
    col(s,'holds').createIndex({active:1,expiresAt:1}),
    col(s,'bookings').createIndex({holdId:1},{unique:true}),
    col(s,'bookings').createIndex({userId:1,createdAt:-1}),
    col(s,'payments').createIndex({providerId:1},{unique:true}),
    col(s,'inbox').createIndex({eventId:1},{unique:true}),
    col(s,'outbox').createIndex({sentAt:1,createdAt:1}),
    col(s,'trips').createIndex({from:1,to:1,date:1})
  ]);
}
export async function transaction<T>(s: Store, work:(session:ClientSession)=>Promise<T>):Promise<T> {
  return s.client.withSession(session => session.withTransaction(()=>work(session),{readConcern:{level:'snapshot'},writeConcern:{w:'majority'},maxCommitTimeMS:5000,timeoutMS:10000}));
}
export async function now(s:Store, session?:ClientSession):Promise<Date> {
  const r=await col(s,'trips').aggregate([{$limit:1},{$project:{_id:0,now:'$$NOW'}}],{session}).next();
  return r?.now ?? new Date();
}
