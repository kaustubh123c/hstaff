import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { db, tx } from '../db.js';
import { authenticate, requireRole } from '../auth.js';
import { wrap, bad, forbidden, notFound, conflict, parseId, audit, notify } from '../util.js';

export const router = Router();
router.use(authenticate);
const point = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });
const distance = (a,b,c,d) => { const r=x=>x*Math.PI/180, x=r(c-a), y=r(d-b); return 6371000*2*Math.asin(Math.sqrt(Math.sin(x/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(y/2)**2)); };
const otpHash = (id, value) => crypto.createHash('sha256').update(`${id}:${value}`).digest('hex');
const safeEqual = (a,b) => { const x=Buffer.from(a), y=Buffer.from(b); return x.length===y.length && crypto.timingSafeEqual(x,y); };

router.post('/jobs', requireRole('business'), wrap((req,res)=>{
  const d=z.object({title:z.string().trim().min(2).max(80),description:z.string().max(1000).optional().default(''),skills:z.array(z.string()).max(10).optional().default([]),location:z.string().trim().min(2).max(160),...point.shape,date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),start_time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),end_time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),rate:z.coerce.number().int().min(1).max(100000),radius_m:z.coerce.number().int().min(25).max(5000).optional().default(300)}).parse(req.body);
  if(d.start_time===d.end_time) throw bad('Start and end time must differ');
  const result=db.prepare("INSERT INTO shifts(business_id,title,description,skills,location,lat,lng,radius_m,date,start_time,end_time,workers_needed,rate,status,job_type) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,'Open','ondemand')")
    .run(req.user.id,d.title,d.description,d.skills.join(','),d.location,d.lat,d.lng,d.radius_m,d.date,d.start_time,d.end_time,d.rate);
  const jobId = Number(result.lastInsertRowid);
  // Queue a nearby-task alert for available, verified workers. The worker web
  // portal is intentionally removed; these records are the dispatch event
  // consumed by the configured notification delivery adapter.
  const nearbyWorkers = db.prepare(`SELECT w.user_id,w.lat,w.lng,u.name
    FROM workers w JOIN users u ON u.id=w.user_id
    WHERE u.status='Active' AND w.available=1 AND w.kyc_status='Verified'
      AND w.lat IS NOT NULL AND w.lng IS NOT NULL`).all();
  let notified = 0;
  for (const worker of nearbyWorkers) {
    const distanceM = Math.round(distance(d.lat,d.lng,worker.lat,worker.lng));
    if (distanceM <= d.radius_m) {
      notify(worker.user_id, JSON.stringify({
        type: 'nearby_task', job_id: jobId, title: d.title, service: d.skills.join(', '),
        location: d.location, distance_m: distanceM, date: d.date, start_time: d.start_time,
        rate: d.rate, message: `Nearby task: ${d.title} · ${distanceM} m away · ₹${d.rate}/hr`
      }));
      notified++;
    }
  }
  audit(req,'ondemand.job_create','shift',jobId,`nearby_worker_alerts=${notified}`);
  res.status(201).json({job_id:jobId,notified_workers:notified,ok:true});
}));

// Worker availability and live GPS are explicitly worker controlled.
router.post('/workers/location', requireRole('worker'), wrap((req,res)=>{
  const p=point.extend({ available:z.boolean().optional() }).parse(req.body);
  db.prepare('UPDATE workers SET lat=?,lng=?,available=COALESCE(?,available) WHERE user_id=?').run(p.lat,p.lng,p.available == null ? null : Number(p.available),req.user.id);
  res.json({ok:true});
}));
router.get('/workers/nearby', requireRole('business','admin'), wrap((req,res)=>{
  const p=point.parse(req.query), radius=Math.min(50000,Math.max(100,Number(req.query.radius)||10000));
  const rows=db.prepare(`SELECT u.id,u.name,w.skills,w.rating,w.kyc_status,w.lat,w.lng FROM workers w JOIN users u ON u.id=w.user_id WHERE u.status='Active' AND w.available=1 AND w.lat IS NOT NULL`).all()
    .map(w=>({...w,distance_m:Math.round(distance(p.lat,p.lng,w.lat,w.lng))})).filter(w=>w.distance_m<=radius).sort((a,b)=>a.distance_m-b.distance_m).slice(0,50);
  res.json({workers:rows});
}));
router.get('/jobs/nearby', requireRole('worker'), wrap((req,res)=>{
  const p=point.parse(req.query), radius=Math.min(50000,Math.max(100,Number(req.query.radius)||15000));
  const rows=db.prepare("SELECT s.id,s.title,s.description,s.skills,s.location,s.lat,s.lng,s.date,s.start_time,s.end_time,s.rate,b.company FROM shifts s JOIN businesses b ON b.user_id=s.business_id WHERE s.job_type='ondemand' AND s.status='Open' AND s.lat IS NOT NULL").all()
    .map(j=>({...j,distance_m:Math.round(distance(p.lat,p.lng,j.lat,j.lng))})).filter(j=>j.distance_m<=radius).sort((a,b)=>a.distance_m-b.distance_m).slice(0,50);
  res.json({jobs:rows});
}));

router.post('/jobs/:id/request', requireRole('worker'), wrap((req,res)=>{
  const id=parseId(req.params.id), shift=db.prepare("SELECT * FROM shifts WHERE id=? AND job_type='ondemand'").get(id);
  if(!shift) throw notFound('On-demand job not found');
  if(shift.status!=='Open') throw conflict('This job is no longer available');
  const worker=db.prepare('SELECT available,kyc_status FROM workers WHERE user_id=?').get(req.user.id);
  if(!worker.available) throw conflict('Turn on availability and share your location before requesting a job');
  if(worker.kyc_status!=='Verified') throw forbidden('Worker verification is required');
  if(db.prepare("SELECT 1 FROM applications WHERE shift_id=? AND worker_id=? AND status IN ('Applied','Accepted')").get(id,req.user.id)) throw conflict('You already requested this job');
  const app=tx(()=>{
    const result=db.prepare("INSERT INTO applications(shift_id,worker_id,status) VALUES(?,?,'Accepted')").run(id,req.user.id);
    const start=String(crypto.randomInt(100000,1000000)), finish=String(crypto.randomInt(100000,1000000));
    db.prepare("UPDATE shifts SET status='Filled',start_otp_hash=?,finish_otp_hash=? WHERE id=?").run(otpHash(id,start),otpHash(id,finish),id);
    db.prepare('UPDATE workers SET available=0 WHERE user_id=?').run(req.user.id);
    notify(shift.business_id,`${req.user.name} accepted your nearby job ${shift.title}.`);
    return {application_id:Number(result.lastInsertRowid),start,finish};
  })();
  audit(req,'ondemand.worker_accept','shift',id);
  // In production these codes must be delivered through a verified SMS/WhatsApp provider.
  res.status(201).json({ok:true,application_id:app.application_id,...(process.env.NODE_ENV!=='production'?{demo_otps:{start:app.start,finish:app.finish}}:{})});
}));

router.post('/jobs/:id/verify-start', requireRole('worker'), wrap((req,res)=>verify(req,res,'start')));
router.post('/jobs/:id/verify-finish', requireRole('worker'), wrap((req,res)=>verify(req,res,'finish')));
function verify(req,res,stage){
  const id=parseId(req.params.id), {otp}=z.object({otp:z.string().regex(/^\d{6}$/)}).parse(req.body);
  const s=db.prepare("SELECT * FROM shifts WHERE id=? AND job_type='ondemand'").get(id); if(!s) throw notFound('Job not found');
  if(s.status==='Completed') throw bad('This job has already been completed');
  if(!db.prepare("SELECT 1 FROM applications WHERE shift_id=? AND worker_id=? AND status='Accepted'").get(id,req.user.id)) throw forbidden();
  const column=stage==='start'?'start_otp_hash':'finish_otp_hash';
  if(!s[column]||!safeEqual(s[column],otpHash(id,otp))) throw bad('That verification code is incorrect');
  if(stage==='start'){
    if(s.otp_verified_at) throw conflict('Job start is already verified');
    db.prepare("UPDATE shifts SET otp_verified_at=datetime('now'),status='Ongoing' WHERE id=?").run(id);
    notify(s.business_id,`Worker start verified for ${s.title}.`);
  }else{
    if(!s.otp_verified_at) throw conflict('Verify the job start first');
    tx(()=>{ db.prepare("UPDATE shifts SET status='Completed',finish_otp_hash=NULL WHERE id=?").run(id); db.prepare('UPDATE workers SET available=1 WHERE user_id=?').run(req.user.id); notify(s.business_id,`Job ${s.title} marked complete.`); });
  }
  audit(req,`ondemand.${stage}_verified`,'shift',id); res.json({ok:true,status:stage==='start'?'Ongoing':'Completed'});
}

router.get('/jobs/:id/verification', requireRole('business','admin'), wrap((req,res)=>{
  const id=parseId(req.params.id), s=db.prepare("SELECT s.*,a.worker_id FROM shifts s LEFT JOIN applications a ON a.shift_id=s.id AND a.status='Accepted' WHERE s.id=? AND s.job_type='ondemand'").get(id);
  if(!s) throw notFound('Job not found'); if(req.user.role==='business'&&s.business_id!==req.user.id) throw forbidden();
  res.json({job_id:id,status:s.status,started:Boolean(s.otp_verified_at),worker_id:s.worker_id??null});
}));
