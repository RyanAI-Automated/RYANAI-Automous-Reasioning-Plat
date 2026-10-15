import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getUsers, saveUser, UserRecord, hashPassword } from '../database/db.js';
import crypto from 'crypto';

interface SignupBody {
  fullName?: string;
  email?: string;
  password?: string;
}

interface SigninBody {
  email?: string;
  password?: string;
}

export async function registerAuthRoutes(fastify: FastifyInstance) {
  // Signup Endpoint
  fastify.post('/api/auth/signup', async (request: FastifyRequest<{ Body: SignupBody }>, reply: FastifyReply) => {
    const { fullName, email, password } = request.body || {};

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password are required' });
    }

    const users = getUsers();
    const normalizedEmail = email.trim().toLowerCase();
    const existing = users.find((u) => u.email === normalizedEmail);

    if (existing) {
      return reply.status(400).send({ error: 'User already exists' });
    }

    const newUser: UserRecord = {
      id: crypto.randomUUID(),
      fullName: fullName?.trim(),
      email: normalizedEmail,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
    };

    saveUser(newUser);

    return reply.status(201).send({
      success: true,
      user: {
        id: newUser.id,
        email: newUser.email,
        fullName: newUser.fullName,
      },
    });
  });

  // Signin Endpoint
  fastify.post('/api/auth/signin', async (request: FastifyRequest<{ Body: SigninBody }>, reply: FastifyReply) => {
    const { email, password } = request.body || {};

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password are required' });
    }

    const users = getUsers();
    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = hashPassword(password);

    const user = users.find(
      (u) => u.email === normalizedEmail && u.passwordHash === passwordHash
    );

    if (!user) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    return reply.send({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
    });
  });
}
