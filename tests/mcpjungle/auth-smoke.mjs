#!/usr/bin/env node
import assert from "node:assert/strict";

const endpoint = process.env.MCPJUNGLE_URL ?? "http://127.0.0.1:8080/mcp";
const allowedToken = process.env.MCPJUNGLE_ALLOWED_CLIENT_TOKEN;
const restrictedToken = process.env.MCPJUNGLE_RESTRICTED_CLIENT_TOKEN;
assert.ok(allowedToken, "MCPJUNGLE_ALLOWED_CLIENT_TOKEN is required");
assert.ok(restrictedToken, "MCPJUNGLE_RESTRICTED_CLIENT_TOKEN is required");

async function post(method, id, token, sessionId) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-03-26",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: method === "initialize"
        ? {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "ryanai-ci-auth-test", version: "1.0.0" },
          }
        : {},
    }),
    signal: AbortSignal.timeout(15000),
  });
  const session = response.headers.get("mcp-session-id");
  const raw = await response.text();
  let payload = null;
  if (raw.trim()) {
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      const data = raw.split(/\\r?\\n/).filter((line) => line.startsWith("data:"));
      if (data.length) payload = JSON.parse(data.map((line) => line.slice(5).trim()).join("\\n"));
    } else {
      try { payload = JSON.parse(raw); } catch { /* preserve status for assertion */ }
    }
  }
  return { response, payload, session: session ?? sessionId };
}

const unauthenticated = await post("initialize", 1, null, null);
assert.ok(
  unauthenticated.response.status === 401 || unauthenticated.response.status === 403,
  `Unauthenticated MCP initialize must be rejected with 401/403; received ${unauthenticated.response.status}`,
);
console.log("PASS: unauthenticated MCP access rejected");

async function listTools(token) {
  const init = await post("initialize", 1, token, null);
  assert.equal(init.response.status, 200, `Authenticated initialize failed: HTTP ${init.response.status}`);
  assert.ok(init.payload?.result, "Authenticated initialize did not return a JSON-RPC result");

  const session = init.session;
  const notificationHeaders = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-03-26",
    authorization: `Bearer ${token}`,
  };
  if (session) notificationHeaders["mcp-session-id"] = session;
  const notification = await fetch(endpoint, {
    method: "POST",
    headers: notificationHeaders,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    signal: AbortSignal.timeout(15000),
  });
  assert.ok(
    notification.status === 200 || notification.status === 202,
    `MCP initialized notification failed: HTTP ${notification.status}`,
  );

  const listed = await post("tools/list", 2, token, session);
  assert.equal(listed.response.status, 200, `tools/list failed: HTTP ${listed.response.status}`);
  assert.ok(Array.isArray(listed.payload?.result?.tools), "tools/list did not return a tools array");
  return listed.payload.result.tools;
}

const allowedTools = await listTools(allowedToken);
const toolNames = allowedTools.map((tool) => tool.name);
assert.ok(
  toolNames.some((name) => name.endsWith("__platform_health")),
  `Authorized client did not receive the permitted platform_health tool; received: ${toolNames.join(", ")}`,
);
console.log("PASS: authorized client discovers the explicitly allowed RyanAI health tool");

const restrictedTools = await listTools(restrictedToken);
assert.equal(
  restrictedTools.length,
  0,
  `Client with an empty server allowlist must see no tools; received: ${restrictedTools.map((tool) => tool.name).join(", ")}`,
);
console.log("PASS: authenticated client with an empty allowlist receives no tools");
