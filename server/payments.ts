import { createHmac,timingSafeEqual } from 'node:crypto';
import { AppError,col,type Store } from './db.js';
import { finalize } from './booking.js';
export type PaymentConfig={mode:string;keyId?:string;keySecret?:string;webhookSecret?:string};
export function validSignature(payload:string,signature:string,secret:string) {
 const expected=createHmac('sha256',secret).update(payload).digest('hex');
 return /^[a-f0-9]{64}$/i.test(signature)&&timingSafeEqual(Buffer.from(expected),Buffer.from(signature));
}
async function provider(c:PaymentConfig,path:string,method='GET',body?:any) {
 if(!c.keyId||!c.keySecret)throw new AppError(503,'Payment provider is not configured');
 const r=await fetch(`https://api.razorpay.com/v1/${path}`,{method,headers:{Authorization:`Basic ${Buffer.from(`${c.keyId}:${c.keySecret}`).toString('base64')}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});
 const data:any=await r.json();if(!r.ok)throw new AppError(502,'Payment provider request failed. Your payment status will be checked.');return data;
}
export async function createOrder(s:Store,c:PaymentConfig,order:any) {
 if(order.mode==='sandbox'||order.providerOrderId)return order;
 // A durable single-writer claim prevents repeated clicks from creating duplicate orders.
 const claim=await col(s,'orders').findOneAndUpdate({_id:order._id,status:'CREATING'},{$set:{status:'CREATION_IN_PROGRESS',startedAt:new Date()}},{returnDocument:'after'});
 if(!claim)return col(s,'orders').findOne({_id:order._id});
 try{
  const result=await provider(c,'orders','POST',{amount:order.amount,currency:'INR',receipt:order._id,notes:{holdId:order._id}});
  await col(s,'orders').updateOne({_id:order._id},{$set:{providerOrderId:result.id,status:'READY'}});
 }catch{
  await col(s,'orders').updateOne({_id:order._id},{$set:{status:'CREATION_UNKNOWN'}});
 }
 return col(s,'orders').findOne({_id:order._id});
}
export async function verifyPayment(s:Store,c:PaymentConfig,holdId:string,paymentId:string,signature:string) {
 const o=await col(s,'orders').findOne({_id:holdId});if(!o||o.mode!=='razorpay')throw new AppError(404,'Payment order not found');
 if(!validSignature(`${o.providerOrderId}|${paymentId}`,signature,c.keySecret??''))throw new AppError(400,'Payment signature is invalid');
 return checkPayment(s,c,o,paymentId);
}
async function checkPayment(s:Store,c:PaymentConfig,o:any,paymentId:string) {
 const p=await provider(c,`payments/${encodeURIComponent(paymentId)}`);
 if(p.order_id!==o.providerOrderId||p.amount!==o.amount||p.currency!=='INR')throw new AppError(400,'Payment does not match this reservation');
 if(p.status!=='captured')return {status:'VERIFYING',booking:null};
 return finalize(s,o._id,p.id,p.amount,p.currency);
}
export async function reconcile(s:Store,c:PaymentConfig) {
 const inbox=await col(s,'inbox').find({processedAt:null}).limit(30).toArray();
 for(const i of inbox){
  try{
   const p=i.payload?.payload?.payment?.entity;
   if(p?.id&&p?.order_id){const o=await col(s,'orders').findOne({providerOrderId:p.order_id});if(o)await checkPayment(s,c,o,p.id);}
   await col(s,'inbox').updateOne({_id:i._id},{$set:{processedAt:new Date()}});
  }catch { await col(s,'inbox').updateOne({_id:i._id},{$inc:{attempts:1}}); }
 }
 const orders=await col(s,'orders').find({mode:'razorpay',status:{$ne:'CAPTURED'},createdAt:{$gt:new Date(Date.now()-7*86400000)}}).limit(100).toArray();
 for(const o of orders)try{
  let orderId=o.providerOrderId;
  if(!orderId&&['CREATION_UNKNOWN','CREATION_IN_PROGRESS'].includes(o.status)){
   const result=await provider(c,`orders?receipt=${encodeURIComponent(o._id)}&count=100`);
   const found=result.items?.find((x:any)=>x.receipt===o._id&&x.amount===o.amount);
   if(found){orderId=found.id;await col(s,'orders').updateOne({_id:o._id},{$set:{providerOrderId:orderId,status:'READY'}});}
  }
  if(orderId){const result=await provider(c,`orders/${orderId}/payments`);for(const p of result.items??[])if(p.status==='captured')await checkPayment(s,c,{...o,providerOrderId:orderId},p.id);}
 }catch { /* Keep durable records for the next pass; admin exposes age and state. */ }
 const refunds=await col(s,'refunds').find({status:{$in:['PENDING','UNKNOWN','SUBMITTED']},nextAttemptAt:{$lte:new Date()}}).limit(30).toArray();
 for(const r of refunds){
  const claim=await col(s,'refunds').findOneAndUpdate({_id:r._id,$or:[{leaseUntil:{$exists:false}},{leaseUntil:{$lt:new Date()}}]},{$set:{leaseUntil:new Date(Date.now()+60000)},$inc:{attempts:1}},{returnDocument:'after'});
  if(!claim)continue;
  try{
   let done=r.mode==='sandbox',refundId=r.providerRefundId;
   if(!done){
    const existing=await provider(c,`payments/${encodeURIComponent(r._id)}/refunds`);
    let remote=existing.items?.find((x:any)=>x.notes?.obligationId===r._id);
    // Only PENDING has never submitted. UNKNOWN never blindly resubmits money movement.
    if(!remote&&r.status==='PENDING'){
     await col(s,'refunds').updateOne({_id:r._id},{$set:{status:'UNKNOWN'}});
     remote=await provider(c,`payments/${encodeURIComponent(r._id)}/refund`,'POST',{amount:r.amount,notes:{obligationId:r._id}});
    }
    refundId=remote?.id;done=remote?.status==='processed';
   }
   await col(s,'refunds').updateOne({_id:r._id},{$set:{status:done?'COMPLETED':refundId?'SUBMITTED':'UNKNOWN',providerRefundId:refundId??null,nextAttemptAt:new Date(Date.now()+60000),leaseUntil:new Date(0)}});
   if(done)await col(s,'payments').updateOne({providerId:r._id},{$set:{outcome:'REFUNDED'}});
  }catch{await col(s,'refunds').updateOne({_id:r._id},{$set:{leaseUntil:new Date(0),nextAttemptAt:new Date(Date.now()+60000)}});}
 }
}
