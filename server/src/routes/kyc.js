import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { db, tx } from '../db.js';
import { config } from '../config.js';
import { authenticate, requireRole } from '../auth.js';
import { wrap, bad, forbidden, notFound, conflict, parseId, audit, notify, HttpError } from '../util.js';

export const router = Router();
router.use(authenticate);

const MIME = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + (MIME[file.mimetype] ?? '')),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => (MIME[file.mimetype] ? cb(null, true) : cb(new HttpError(400, 'Only PDF, JPG or PNG files are allowed'))),
});

const DOC_TYPES = ['Identity document', 'Address proof', 'Bank / UPI proof', 'Other'];

function syncWorkerStatus(workerId) {
  const docs = db.prepare('SELECT status FROM kyc_documents WHERE worker_id=?').all(workerId).map(d => d.status);
  const status = !docs.length ? 'Not submitted' : docs.includes('Rejected') ? 'Rejected' : docs.every(s => s === 'Verified') ? 'Verified' : 'Pending';
  db.prepare('UPDATE workers SET kyc_status=? WHERE user_id=?').run(status, workerId);
  return status;
}

router.get('/mine', requireRole('worker'), (req, res) => {
  res.json({
    types: DOC_TYPES,
    status: db.prepare('SELECT kyc_status FROM workers WHERE user_id=?').get(req.user.id).kyc_status,
    documents: db.prepare('SELECT id, doc_type, original_name, mime, size, status, review_note, uploaded_at FROM kyc_documents WHERE worker_id=? ORDER BY id DESC').all(req.user.id),
  });
});

router.post('/', requireRole('worker'), upload.single('file'), wrap((req, res) => {
  const cleanup = () => req.file && fs.rm(req.file.path, () => {});
  try {
    if (!req.file) throw bad('Please choose a file to upload');
    const { doc_type } = z.object({ doc_type: z.enum(DOC_TYPES) }).parse(req.body);
    // Check magic bytes so a renamed file can't masquerade as a PDF/image.
    const head = Buffer.alloc(8); const fd = fs.openSync(req.file.path, 'r'); fs.readSync(fd, head, 0, 8, 0); fs.closeSync(fd);
    const okSig = (req.file.mimetype === 'application/pdf' && head.subarray(0, 4).toString() === '%PDF')
      || (req.file.mimetype === 'image/png' && head.subarray(1, 4).toString() === 'PNG')
      || (req.file.mimetype === 'image/jpeg' && head[0] === 0xff && head[1] === 0xd8);
    if (!okSig) throw bad('File content does not match its type');
    const r = tx(() => {
      const ins = db.prepare('INSERT INTO kyc_documents (worker_id, doc_type, original_name, stored_name, mime, size) VALUES (?,?,?,?,?,?)')
        .run(req.user.id, doc_type, path.basename(req.file.originalname).slice(0, 120), req.file.filename, req.file.mimetype, req.file.size);
      syncWorkerStatus(req.user.id);
      return ins.lastInsertRowid;
    })();
    audit(req, 'kyc.upload', 'kyc_document', r, doc_type);
    for (const a of db.prepare("SELECT id FROM users WHERE role='admin'").all()) notify(a.id, `${req.user.name} submitted a KYC document for review.`);
    res.status(201).json({ ok: true, id: r });
  } catch (e) { cleanup(); throw e; }
}));

// Download: owner or admin only. Sent as an attachment so the browser never renders uploaded content inline.
router.get('/:id/file', wrap((req, res) => {
  const d = db.prepare('SELECT * FROM kyc_documents WHERE id=?').get(parseId(req.params.id));
  if (!d) throw notFound('Document not found');
  if (!(req.user.role === 'admin' || (req.user.role === 'worker' && d.worker_id === req.user.id))) throw forbidden();
  audit(req, 'kyc.view', 'kyc_document', d.id);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.download(path.join(config.uploadDir, d.stored_name), d.original_name);
}));

router.delete('/:id', requireRole('worker'), wrap((req, res) => {
  const d = db.prepare('SELECT * FROM kyc_documents WHERE id=? AND worker_id=?').get(parseId(req.params.id), req.user.id);
  if (!d) throw notFound('Document not found');
  if (d.status === 'Verified') throw conflict('Verified documents cannot be removed. Contact support.');
  tx(() => { db.prepare('DELETE FROM kyc_documents WHERE id=?').run(d.id); syncWorkerStatus(req.user.id); })();
  fs.rm(path.join(config.uploadDir, d.stored_name), () => {});
  audit(req, 'kyc.delete', 'kyc_document', d.id);
  res.json({ ok: true });
}));

// ---- admin review ----
router.get('/', requireRole('admin'), (_req, res) => {
  res.json({
    documents: db.prepare(`SELECT k.id, k.doc_type, k.original_name, k.mime, k.size, k.status, k.review_note, k.uploaded_at, k.worker_id, u.name worker_name
      FROM kyc_documents k JOIN users u ON u.id=k.worker_id ORDER BY (k.status='Pending') DESC, k.uploaded_at DESC`).all(),
  });
});

router.post('/:id/review', requireRole('admin'), wrap((req, res) => {
  const d = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(300).optional() })
    .refine(v => v.decision === 'approve' || v.note, { message: 'A reason is required when rejecting', path: ['note'] }).parse(req.body);
  const doc = db.prepare('SELECT * FROM kyc_documents WHERE id=?').get(parseId(req.params.id));
  if (!doc) throw notFound('Document not found');
  const status = tx(() => {
    db.prepare('UPDATE kyc_documents SET status=?, review_note=?, reviewed_by=?, reviewed_at=datetime(\'now\') WHERE id=?')
      .run(d.decision === 'approve' ? 'Verified' : 'Rejected', d.note ?? null, req.user.id, doc.id);
    const s = syncWorkerStatus(doc.worker_id);
    notify(doc.worker_id, d.decision === 'approve' ? `Your ${doc.doc_type.toLowerCase()} was verified.` : `Your ${doc.doc_type.toLowerCase()} was rejected: ${d.note}`);
    return s;
  })();
  audit(req, `kyc.${d.decision}`, 'kyc_document', doc.id, d.note);
  res.json({ ok: true, worker_kyc_status: status });
}));
