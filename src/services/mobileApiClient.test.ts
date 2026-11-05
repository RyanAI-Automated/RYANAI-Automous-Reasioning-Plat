import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  executeAuthenticatedMobileObjective,
  MobileApiClient,
  type MobileSessionReader,
} from "./mobileApiClient";

const defaultResponse = {
  success: true,
  objective: "inspect the service",
  output: "Reasoning completed.",
};

beforeEach(() => {
  vi.stubEnv("EXPO_PUBLIC_RYAN_API_URL", "https://api.example.test");
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("MobileApiClient authenticated reasoning", () => {
  it("posts to the protected reasoning endpoint with the current bearer token", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(defaultResponse));

    await expect(
      MobileApiClient.executeObjective("  inspect the service  ", "mobile-session-token"),
    ).resolves.toEqual({
      status: "completed",
      objective: "inspect the service",
      result: "Reasoning completed.",
    });

    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "https://api.example.test/api/reason",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer mobile-session-token",
          Accept: "application/json",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ prompt: "inspect the service" }),
      }),
    );
  });

  it("rejects missing credentials before making a request", async () => {
    await expect(MobileApiClient.executeObjective("inspect the service", " ")).rejects.toThrow(
      "Sign in to continue.",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects empty objectives before making a request", async () => {
    await expect(MobileApiClient.executeObjective(" ", "mobile-session-token")).rejects.toThrow(
      "A non-empty reasoning objective is required.",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires HTTPS for remote API origins", async () => {
    vi.stubEnv("EXPO_PUBLIC_RYAN_API_URL", "http://api.example.test");

    await expect(
      MobileApiClient.executeObjective("inspect the service", "mobile-session-token"),
    ).rejects.toThrow("RyanAI API URL must use HTTPS outside loopback development.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows HTTP only for a loopback development API", async () => {
    vi.stubEnv("EXPO_PUBLIC_RYAN_API_URL", "http://127.0.0.1:3002");
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(defaultResponse));

    await MobileApiClient.executeObjective("inspect the service", "mobile-session-token");

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3002/api/reason",
      expect.any(Object),
    );
  });

  it("surfaces the server authentication error without hiding its status", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Invalid or expired session. Please sign in again." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      MobileApiClient.executeObjective("inspect the service", "expired-token"),
    ).rejects.toThrow("Invalid or expired session. Please sign in again.");
  });

  it("rejects a success-shaped response without successful reasoning output", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ success: true, output: " " }));

    await expect(
      MobileApiClient.executeObjective("inspect the service", "mobile-session-token"),
    ).rejects.toThrow("RyanAI returned no reasoning output.");
  });
});

describe("executeAuthenticatedMobileObjective", () => {
  it("reads the current session at submission time and rejects anonymous sessions", async () => {
    const readSession = vi.fn<MobileSessionReader>().mockResolvedValue({
      accessToken: "anonymous-token",
      isAnonymous: true,
    });

    await expect(
      executeAuthenticatedMobileObjective("inspect the service", readSession),
    ).rejects.toThrow("Sign in with your RyanAI account to continue.");
    expect(readSession).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not call the API when the mobile host has no session", async () => {
    const readSession = vi.fn<MobileSessionReader>().mockResolvedValue(null);

    await expect(
      executeAuthenticatedMobileObjective("inspect the service", readSession),
    ).rejects.toThrow("Sign in with your RyanAI account to continue.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the live access token returned by the host session provider", async () => {
    const readSession = vi.fn<MobileSessionReader>().mockResolvedValue({
      accessToken: "verified-mobile-token",
      isAnonymous: false,
    });
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(defaultResponse));

    await executeAuthenticatedMobileObjective("inspect the service", readSession);

    expect(readSession).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.test/api/reason",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer verified-mobile-token",
        }),
      }),
    );
  });
});
