import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as AuditPrismaClient } from '@prisma/audit-client';
import twilio from 'twilio';
import Redis from 'ioredis';

const prisma = new PrismaClient();
const auditDb = new AuditPrismaClient();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const JWT_SECRET = process.env.JWT_SECRET || 'SUPER_SECRET_RYAN_KEY_2026';

/**
 * Register domain, Google, WhatsApp OTP, and administrator sign-in routes.
 * Handlers issue JWTs, write login audits, and may create users; the OTP flow also
 * writes Redis state and sends WhatsApp messages.
 */
export async function authGatewayRoutes(fastify: FastifyInstance) {
  
  // 1. Register / Login with Enterprise @ryanai Domain
  fastify.post('/api/v1/auth/ryan-domain', async (req: FastifyRequest, reply: FastifyReply) => {
    const { username, password, isRegistration } = req.body as { username: string; password: string; isRegistration?: boolean };
    const email = `${username.toLowerCase()}@ryanai.dev`;
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'] || 'unknown';

    try {
      if (isRegistration) {
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) return reply.status(400).send({ error: 'Username already taken.' });

        const passwordHash = await bcrypt.hash(password, 12);
        const user = await prisma.user.create({
          data: {
            email,
            username,
            passwordHash,
            provider: 'RYAN_DOMAIN',
            role: username === 'administrator' ? 'ADMIN' : 'USER',
          },
        });

        await auditDb.systemLoginLog.create({
          data: { userId: user.id, identifier: email, authType: 'RYAN_DOMAIN_REGISTER', ipAddress, userAgent, success: true }
        });

        const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        return reply.send({ success: true, token, user: { id: user.id, email: user.email, role: user.role } });
      } else {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.passwordHash) {
          await auditDb.systemLoginLog.create({
            data: { userId: 'N/A', identifier: email, authType: 'RYAN_DOMAIN_LOGIN', ipAddress, userAgent, success: false }
          });
          return reply.status(401).send({ error: 'Invalid credentials.' });
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          await auditDb.systemLoginLog.create({
            data: { userId: user.id, identifier: email, authType: 'RYAN_DOMAIN_LOGIN', ipAddress, userAgent, success: false }
          });
          return reply.status(401).send({ error: 'Invalid credentials.' });
        }

        await auditDb.systemLoginLog.create({
          data: { userId: user.id, identifier: email, authType: 'RYAN_DOMAIN_LOGIN', ipAddress, userAgent, success: true }
        });

        const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        return reply.send({ success: true, token, user: { id: user.id, email: user.email, role: user.role } });
      }
    } catch (err: unknown) {
      return reply.status(500).send({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  // 2. Google OAuth2 / Gmail Sign In
  fastify.post('/api/v1/auth/gmail', async (req: FastifyRequest, reply: FastifyReply) => {
    const { idToken, googleTokens } = req.body as { idToken: string; googleTokens?: Record<string, string> };
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'] || 'unknown';

    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.email) throw new Error('Invalid Gmail token payload');

      let user = await prisma.user.findUnique({ where: { email: payload.email } });

      if (!user) {
        user = await prisma.user.create({
          data: {
            email: payload.email,
            provider: 'GMAIL',
            googleTokens: googleTokens || {},
            role: 'USER',
          },
        });
      } else {
        await prisma.user.update({
          where: { id: user.id },
          data: { googleTokens: googleTokens || user.googleTokens },
        });
      }

      await auditDb.systemLoginLog.create({
        data: { userId: user.id, identifier: user.email, authType: 'GMAIL', ipAddress, userAgent, success: true }
      });

      const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
      return reply.send({ success: true, token, user });
    } catch (err: unknown) {
      return reply.status(401).send({ error: 'Gmail Authentication Failed', details: (err instanceof Error ? err.message : String(err)) });
    }
  });

  // 3. WhatsApp OTP Auth Engine (Saves OTP securely to Redis with 5 min TTL)
  fastify.post('/api/v1/auth/whatsapp/send-otp', async (req: FastifyRequest, reply: FastifyReply) => {
    const { phoneNumber } = req.body as { phoneNumber: string };
    if (!phoneNumber) return reply.status(400).send({ error: 'Phone number is required.' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const redisKey = `otp:${phoneNumber.replace(/\D/g, '')}`;

    await redis.set(redisKey, otp, 'EX', 300);

    fastify.log.info(`OTP dispatched for ${phoneNumber}`);

    await twilioClient.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:${phoneNumber}`,
      body: `🔐 Your RyanAI Access Verification Code is: *${otp}*. Expires in 5 minutes.`,
    });

    return reply.send({ success: true, message: 'OTP dispatched via WhatsApp.' });
  });

  // 3b. WhatsApp OTP Verification & Login Engine (Validates against Redis)
  fastify.post('/api/v1/auth/whatsapp/verify-otp', async (req: FastifyRequest, reply: FastifyReply) => {
    const { phoneNumber, enteredOtp } = req.body as { phoneNumber: string; enteredOtp: string };
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'] || 'unknown';

    if (!phoneNumber || !enteredOtp) {
      return reply.status(400).send({ error: 'Phone number and verification code are required.' });
    }

    const cleanPhone = phoneNumber.replace(/\D/g, '');
    const redisKey = `otp:${cleanPhone}`;
    const storedOtp = await redis.get(redisKey);

    if (!storedOtp || enteredOtp !== storedOtp) {
      await auditDb.systemLoginLog.create({
        data: { userId: 'N/A', identifier: phoneNumber, authType: 'WHATSAPP_OTP', ipAddress, userAgent, success: false }
      });
      return reply.status(401).send({ error: 'Invalid or expired verification code.' });
    }

    await redis.del(redisKey);

    try {
      const email = `${cleanPhone}@whatsapp.ryanai.dev`;
      let user = await prisma.user.findUnique({ where: { email } });

      if (!user) {
        user = await prisma.user.create({
          data: {
            email,
            username: `wa_${cleanPhone}`,
            provider: 'WHATSAPP',
            role: 'USER',
          },
        });
      }

      await auditDb.systemLoginLog.create({
        data: { userId: user.id, identifier: phoneNumber, authType: 'WHATSAPP_OTP', ipAddress, userAgent, success: true }
      });

      const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
      return reply.send({ success: true, token, user: { id: user.id, email: user.email, role: user.role } });
    } catch (err: unknown) {
      return reply.status(500).send({ error: (err instanceof Error ? err.message : String(err)) });
    }
  });

  // 4. Master Administrator Sign In
  fastify.post('/api/v1/auth/master-admin', async (req: FastifyRequest, reply: FastifyReply) => {
    const { username, password } = req.body as { username: string; password: string };
    const adminUser = process.env.MASTER_ADMIN_USER || 'administrator';
    const adminPass = process.env.MASTER_ADMIN_PASS || 'RyanAI_Master_2026!#';

    if (username === adminUser && password === adminPass) {
      await auditDb.systemLoginLog.create({
        data: { userId: 'MASTER_ADMIN', identifier: username, authType: 'MASTER_ADMIN', ipAddress: req.ip, userAgent: req.headers['user-agent'] || '', success: true }
      });

      const token = jwt.sign({ userId: 'MASTER_ADMIN_01', role: 'ADMIN' }, JWT_SECRET, { expiresIn: '24h' });
      return reply.send({ success: true, token, role: 'ADMIN' });
    }

    await auditDb.systemLoginLog.create({
      data: { userId: 'UNKNOWN', identifier: username, authType: 'MASTER_ADMIN', ipAddress: req.ip, userAgent: req.headers['user-agent'] || '', success: false }
    });

    return reply.status(403).send({ error: 'Access Denied: Invalid Master Credentials.' });
  });
}