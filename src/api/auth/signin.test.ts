import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import bcrypt from 'bcrypt';
import authSigninRoute from './signin.js';

// Mock bcrypt
vi.mock('bcrypt', () => ({
  default: {
    compare: vi.fn(),
  },
}));

describe('Auth Sign-In Route (/signin)', () => {
  let fastify: any;

  const mockPrisma = {
    user: {
      findUnique: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    fastify = Fastify();
    fastify.decorate('prisma', mockPrisma);
    fastify.jwt = {
      sign: vi.fn().mockReturnValue('mock-jwt-token'),
    };

    await fastify.register(authSigninRoute);
    await fastify.ready();
  });

  it('should return 400 if email or password is missing', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/signin',
      payload: { email: 'test@ryanai.local' }, // missing password
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'Bad Request',
      message: 'Both email and password are required.',
    });
  });

  it('should return 401 if user is not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const response = await fastify.inject({
      method: 'POST',
      url: '/signin',
      payload: { email: 'nonexistent@ryanai.local', password: 'password123' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: 'Unauthorized',
      message: 'Invalid email or password.',
    });
  });

  it('should return 401 if password verification fails', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'test@ryanai.local',
      password: '$2b$10$hashedpassword',
    });

    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

    const response = await fastify.inject({
      method: 'POST',
      url: '/signin',
      payload: { email: 'test@ryanai.local', password: 'wrongpassword' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: 'Unauthorized',
      message: 'Invalid email or password.',
    });
  });

  it('should return 200 and a JWT token on successful sign-in', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'test@ryanai.local',
      password: '$2b$10$hashedpassword',
    });

    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

    const response = await fastify.inject({
      method: 'POST',
      url: '/signin',
      payload: { email: 'test@ryanai.local', password: 'correctpassword' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      message: 'Signed in successfully.',
      token: 'mock-jwt-token',
    });
  });

  it('should return 500 if the database throws an unhandled error', async () => {
    mockPrisma.user.findUnique.mockRejectedValue(new Error('DB Connection Lost'));

    const response = await fastify.inject({
      method: 'POST',
      url: '/signin',
      payload: { email: 'test@ryanai.local', password: 'password123' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: 'Internal Server Error',
      message: 'Service temporarily unavailable. Please try again later.',
    });
  });
});
