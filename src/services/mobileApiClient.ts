// Authenticated API boundary used by the React Native Agent Console.
const DEFAULT_BACKEND_URL = "https://api.ryanganyane.co.za";

export interface AgentReasoningResponse {
  status: "completed";
  objective: string;
  result: string;
}

export interface MobileAuthSession {
  accessToken: string;
  isAnonymous: boolean;
}

export type MobileSessionReader = () => Promise<MobileAuthSession | null>;

function getBackendOrigin(): URL {
  const configured = process.env.EXPO_PUBLIC_RYAN_API_URL?.trim();
  let backend: URL;

  try {
    backend = new URL(configured || DEFAULT_BACKEND_URL);
  } catch {
    throw new Error("RyanAI API URL is invalid.");
  }

  const hostname = backend.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isLoopback =
    hostname === "localhost" ||
    hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname);
  const allowsHttp = backend.protocol === "http:" && isLoopback;

  if (backend.protocol !== "https:" && !allowsHttp) {
    throw new Error("RyanAI API URL must use HTTPS outside loopback development.");
  }

  if (
    backend.username ||
    backend.password ||
    backend.search ||
    backend.hash
  ) {
    throw new Error("RyanAI API URL must not contain credentials, query parameters or fragments.");
  }

  return backend;
}

function getReasoningEndpoint(): string {
  return new URL("/api/reason", getBackendOrigin()).toString();
}

async function readErrorMessage(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as
    | { error?: unknown; message?: unknown }
    | null;
  if (typeof payload?.error === "string" && payload.error.trim()) {
    return payload.error;
  }
  if (typeof payload?.message === "string" && payload.message.trim()) {
    return payload.message;
  }
  return `RyanAI request failed with HTTP ${response.status}.`;
}

export class MobileApiClient {
  /**
   * Submit reasoning using a short-lived token obtained from the signed-in
   * mobile app session. The server verifies the token with Supabase Auth.
   */
  public static async executeObjective(
    objective: string,
    accessToken: string,
  ): Promise<AgentReasoningResponse> {
    const normalizedObjective = objective.trim();
    if (!normalizedObjective) {
      throw new Error("A non-empty reasoning objective is required.");
    }

    const bearerToken = accessToken.trim();
    if (!bearerToken) {
      throw new Error("Sign in to continue.");
    }

    const response = await fetch(getReasoningEndpoint(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({ prompt: normalizedObjective }),
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const payload = await response.json() as {
      success?: unknown;
      objective?: unknown;
      output?: unknown;
      response?: unknown;
      error?: unknown;
    };

    if (payload.success !== true) {
      throw new Error(
        typeof payload.error === "string" && payload.error.trim()
          ? payload.error
          : "RyanAI could not complete the reasoning request.",
      );
    }

    const result =
      typeof payload.output === "string"
        ? payload.output.trim()
        : typeof payload.response === "string"
          ? payload.response.trim()
          : "";

    if (!result) {
      throw new Error("RyanAI returned no reasoning output.");
    }

    return {
      status: "completed",
      objective:
        typeof payload.objective === "string" && payload.objective.trim()
          ? payload.objective
          : normalizedObjective,
      result,
    };
  }

  /** Return public health data without treating it as proof of authenticated readiness. */
  public static async checkHealth(): Promise<unknown> {
    try {
      const response = await fetch(new URL("/health", getBackendOrigin()).toString(), {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return { status: "offline", httpStatus: response.status };
      return await response.json();
    } catch {
      return { status: "offline" };
    }
  }
}

/**
 * Resolve the current session at the moment of submission; never cache or
 * persist a bearer token in this client. Supabase remains authoritative for
 * identity and rejects anonymous sessions at the API boundary as well.
 */
export async function executeAuthenticatedMobileObjective(
  objective: string,
  readSession: MobileSessionReader,
): Promise<AgentReasoningResponse> {
  const session = await readSession();
  if (
    !session ||
    session.isAnonymous ||
    typeof session.accessToken !== "string" ||
    !session.accessToken.trim()
  ) {
    throw new Error("Sign in with your RyanAI account to continue.");
  }

  return MobileApiClient.executeObjective(objective, session.accessToken);
}
