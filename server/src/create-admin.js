import readline from 'node:readline';
import { stdin, stdout } from 'node:process';
import { db } from './db.js';
import { createAdminAccount } from './admin-provision.js';

function question(prompt) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  return new Promise(resolve => rl.question(prompt, value => { rl.close(); resolve(value); }));
}

function secret(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') return Promise.reject(new Error('Admin creation requires an interactive terminal so the password can be entered without echo.'));
  stdout.write(prompt);
  stdin.setRawMode(true); stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error, result) => {
      stdin.off('data', onData); stdin.setRawMode(false); stdout.write('\n');
      error ? reject(error) : resolve(result);
    };
    const onData = chunk => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') return finish(new Error('Admin creation cancelled.'));
        if (char === '\r' || char === '\n') return finish(null, value);
        if (char === '\u007f' || char === '\b') { value = value.slice(0, -1); continue; }
        if (char >= ' ' && char <= '~') value += char;
      }
    };
    stdin.on('data', onData);
  });
}

try {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') throw new Error('Admin creation requires an interactive terminal so the password can be entered without echo.');
  console.log('Create an initial H-Staff administrator. Password input is hidden; the command never resets existing accounts.');
  const name = await question('Admin name: ');
  const email = await question('Admin email: ');
  const password = await secret('Password (12+ characters): ');
  const id = await createAdminAccount(db, { name, email, password });
  console.log(`Administrator created (user id ${id}). Sign in with the email and password you entered.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { db.close(); }
