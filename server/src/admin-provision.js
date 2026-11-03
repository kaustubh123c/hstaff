import bcrypt from 'bcryptjs';
import { z } from 'zod';

const adminSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(100),
});

export async function createAdminAccount(database, input, { source = 'private provisioning command' } = {}) {
  const { name, email, password } = adminSchema.parse(input);
  const passwordHash = await bcrypt.hash(password, 12);
  database.exec('BEGIN IMMEDIATE');
  try {
    if (database.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new Error('That email already belongs to an account. No records were changed.');
    const id = Number(database.prepare("INSERT INTO users(email,password_hash,role,name) VALUES(?,?,'admin',?)").run(email, passwordHash, name).lastInsertRowid);
    database.prepare('INSERT INTO audit_logs(action,entity,entity_id,detail) VALUES(?,?,?,?)').run('admin.provision', 'user', String(id), `Created by ${source}`);
    database.exec('COMMIT');
    return id;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
