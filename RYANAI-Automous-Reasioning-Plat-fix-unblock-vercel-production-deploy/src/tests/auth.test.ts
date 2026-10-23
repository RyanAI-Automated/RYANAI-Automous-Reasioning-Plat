// File path: ./src/tests/auth.test.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { FastifyInstance } from "fastify";

describe("Authentication Routes Integration Tests", () => {
  let app: FastifyInstance;
  const testUser = {
    email: `test_${Date.now()}@example.com`,
    password: "SecurePassword123!",
    name: "Test User",
  };
  let authToken: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    // Clean up test database records
    await prisma.user.deleteMany({
      where: { email: { contains: "test_" } },
    });
    await app.close();
  });

  it("should fail signup with invalid password format (400)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: {
        email: "badpassword@example.com",
        password: "weak",
        name: "Bad Password User",
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Validation failed");
  });

  it("should successfully register a new user (201)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: testUser,
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);
    expect(body.token).toBeDefined();
    expect(body.user.email).toBe(testUser.email);
  });

  it("should fail duplicate signup with conflict status (409)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: testUser,
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(false);
  });

  it("should successfully sign in with valid credentials (200)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/signin",
      payload: {
        email: testUser.email,
        password: testUser.password,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);
    expect(body.token).toBeDefined();
    
    // Save token for protected route tests
    authToken = body.token;
  });

  it("should fail signin with incorrect password (401)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/signin",
      payload: {
        email: testUser.email,
        password: "WrongPassword999!",
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Invalid email or password.");
  });

  it("should access protected profile route /api/auth/me with valid JWT (200)", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);
    expect(body.user.email).toBe(testUser.email);
  });

  it("should reject protected profile route /api/auth/me without token (401)", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(false);
  });
});