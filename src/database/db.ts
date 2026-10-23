import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = pool;
const DB_PATH = path.resolve(process.cwd(), 'data');
const USERS_FILE = path.join(DB_PATH, 'users.json');

// Ensure database directory and storage file exist
if (!fs.existsSync(DB_PATH)) {
  fs.mkdirSync(DB_PATH, { recursive: true });
}

if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
}

export interface UserRecord {
  id: string;
  fullName?: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export function getUsers(): UserRecord[] {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    const data = fs.readFileSync(USERS_FILE, 'utf-8');
    return JSON.parse(data) as UserRecord[];
  } catch (error) {
    console.error('Failed to read users file:', error);
    return [];
  }
}

export function saveUser(user: UserRecord): void {
  const users = getUsers();
  users.push(user);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

export function hashPassword(password: string): string {
  // Note: For high-security production apps, consider bcrypt or argon2. 
  // SHA-256 with crypto works well for lightweight local JSON stores.
  return crypto.createHash('sha256').update(password).digest('hex');
}