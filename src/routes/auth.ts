// File path: ./src/routes/auth.ts

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma.js";

// Strict validation schemas using Zod
const SignupSchema = z.object({
  email: z.string().email("Invalid email format").trim().toLowerCase(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
  name: z.string().min(2, "Name is required").trim(),
});

const SigninSchema = z.object({
  email: z.string().email("Invalid email format").trim().toLowerCase(),
  password: z.string().min(1, "Password is required"),
});

export async function registerAuthRoutes(fastify: FastifyInstance) {
  
  /**
   * POST /api/auth/signup
   * Registers a new user account with strict validation, secure hashing, and JWT token generation.
   */
  fastify.post("/api/auth/signup", async (request: FastifyRequest, reply: FastifyReply) => {
    const validationResult = SignupSchema.safeParse(request.body);

    if (!validationResult.success) {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: validationResult.error.format(),
      });
    }

    const { email, password, name } = validationResult.data;

    try {
      // 1. Check if user already exists in the database
      const existingUser = await prisma.user.findUnique({ where: { email } });

      if (existingUser) {
        return reply.status(409).send({
          success: false,
          error: "An account with this email address already exists.",
        });
      }

      // 2. Hash password securely (Cost factor: 12)
      const passwordHash = await bcrypt.hash(password, 12);

      // 3. Create user record in database
      const newUser = await prisma.user.create({
        data: { email, passwordHash, name },
      });

      // 4. Generate JWT session token
      const token = fastify.jwt.sign({ id: newUser.id, email: newUser.email });

      request.log.info({ email }, "New user account created successfully with JWT session");

      return reply.status(201).send({
        success: true,
        message: "Account created successfully.",
        token,
        user: { id: newUser.id, email: newUser.email, name: newUser.name },
      });
    } catch (error: unknown) {
      request.log.error(error, "Failed to process user registration");
      return reply.status(500).send({
        success: false,
        error: "Internal server error during registration.",
      });
    }
  });

  /**
   * POST /api/auth/signin
   * Authenticates user credentials and returns session JWT tokens.
   */
  fastify.post("/api/auth/signin", async (request: FastifyRequest, reply: FastifyReply) => {
    const validationResult = SigninSchema.safeParse(request.body);

    if (!validationResult.success) {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: validationResult.error.format(),
      });
    }

    const { email, password } = validationResult.data;

    try {
      // 1. Lookup user by email
      const user = await prisma.user.findUnique({ where: { email } });

      // 2. Secure lookup & generic error response to mitigate user enumeration
      if (!user) {
        return reply.status(401).send({
          success: false,
          error: "Invalid email or password.",
        });
      }

      // 3. Verify password against stored hash
      const isValidPassword = await bcrypt.compare(password, user.passwordHash);

      if (!isValidPassword) {
        return reply.status(401).send({
          success: false,
          error: "Invalid email or password.",
        });
      }

      // 4. Generate JWT session token
      const token = fastify.jwt.sign({ id: user.id, email: user.email });

      request.log.info({ email }, "User authenticated successfully");

      return reply.status(200).send({
        success: true,
        message: "Authentication successful.",
        token,
        user: { id: user.id, email: user.email, name: user.name },
      });
    } catch (error: unknown) {
      request.log.error(error, "Failed to process user authentication");
      return reply.status(500).send({
        success: false,
        error: "Internal server error during authentication.",
      });
    }
  });

  /**
   * GET /api/auth/me
   * Protected profile endpoint requiring valid JWT authorization header.
   */
  fastify.get("/api/auth/me", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const payload = request.user as { id: string; email: string };

      // Lookup user in database
      const user = await prisma.user.findUnique({ where: { id: payload.id } });

      if (!user) {
        return reply.status(404).send({
          success: false,
          error: "User not found.",
        });
      }

      return reply.status(200).send({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          createdAt: user.createdAt,
        },
      });
    } catch (err) {
      return reply.status(401).send({
        success: false,
        error: "Unauthorized: Invalid or missing token.",
      });
    }
  });

}
