// File path: ./src/database/db.ts
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import pkg from 'pg';

const { Pool } = pkg;

// 1. Explicit PostgreSQL Connection Pool Export
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ryanai';
export const pool = new Pool({ connectionString });

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

// 2. Prisma Client Export
export const db = new PrismaClient();
export default db;

// 3. Local JSON User Store Fallback
const DB_PATH = path.resolve(process.cwd(), 'data');
const USERS_FILE = path.join(DB_PATH, 'users.json');

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
  return crypto.createHash('sha256').update(password).digest('hex');
}