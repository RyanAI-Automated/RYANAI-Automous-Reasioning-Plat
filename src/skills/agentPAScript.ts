import { EventEmitter } from "node:events";
import { evaluateGenXSecurityEvent } from "../security/genxPolicy.js";

export interface AgentPAHealthSnapshot {
  api: boolean;
  database: boolean;
  redis: boolean;
}

export interface AgentPASerializedStatus {
  active: boolean;
  operator: string;
  fastifyApiPort: number;
  lastHeartbeat: string;
  health: AgentPAHealthSnapshot;
  workState: "stopped" | "monitoring" | "degraded";
  lastReport: string;
  lastError: string | null;
  observationsCompleted: number;
  eBPFPolicyEnforced: false;
  genXPolicyEngineAvailable: boolean;
  retryAttempts: number;
}

export interface AgentPAScriptConfig {
  fastifyPort?: number;
  masterOperator?: string;
  heartbeatIntervalMs?: number;
  healthCheck?: () => Promise<AgentPAHealthSnapshot>;
}

export const AGENT_PA_SKILL = {
  name: "agent-pa",
  description: "Read-only Personal Assistant observer, runtime monitor and progress reporter",
};

export const SELF_HEALING_SKILL = {
  name: "self-healing",
  description: "Self-healing and auto-correction engine",
};

export const SOVEREIGN_FIREWALL_SKILL = {
  name: "sovereign-firewall",
  description: "Gen-X policy-based defensive access control; does not claim kernel/eBPF firewall enforcement",
};

export const GENX_HARDCORE_SECURITY_SKILL = {
  id: "genx-hardcore-security",
  name: "RyanAI Gen-X Hard Core Security Agent",
  version: "1.0.0",
  mode: "deterministic-policy-plus-ai-triage",
  defaultDecision: "DENY_UNTRUSTED",
};

export class AgentPAScript extends EventEmitter {
  private active = false;
  private readonly fastifyPort: number;
  private readonly masterOperator: string;
  private readonly heartbeatIntervalMs: number;
  private readonly healthCheck?: () => Promise<AgentPAHealthSnapshot>;
  private retryCount = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastHeartbeatISO = "";
  private lastReport = "PA observer has not completed its first health observation.";
  private lastError: string | null = null;
  private observationsCompleted = 0;
  private health: AgentPAHealthSnapshot = { api: false, database: false, redis: false };

  constructor(config: AgentPAScriptConfig = {}) {
    super();
    this.fastifyPort = config.fastifyPort ?? 3000;
    this.masterOperator = config.masterOperator ?? "RyanAI operator";
    const interval = config.heartbeatIntervalMs ?? 15000;
    this.heartbeatIntervalMs = Number.isFinite(interval) ? Math.max(1000, interval) : 15000;
    this.healthCheck = config.healthCheck;
  }

  public async start(): Promise<void> {
    if (this.active) return;
    if (!this.healthCheck) {
      throw new Error("AgentPA cannot start without real API, PostgreSQL and Redis health probes.");
    }
    this.active = true;
    this.retryCount = 0;
    this.emit("started", this.getStatus());
    await this.runObservation();
  }

  public async stop(): Promise<void> {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (!this.active) return;
    this.active = false;
    this.lastReport = "PA observer stopped.";
    this.emit("stopped", this.getStatus());
  }

  private scheduleNextObservation(): void {
    if (!this.active) return;
    this.heartbeatTimer = setTimeout(() => {
      void this.runObservation();
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  private async runObservation(): Promise<void> {
    if (!this.active || !this.healthCheck) return;
    try {
      this.health = await this.healthCheck();
      this.observationsCompleted += 1;
      this.lastHeartbeatISO = new Date().toISOString();
      const healthy = this.health.api && this.health.database && this.health.redis;
      if (healthy) {
        this.retryCount = 0;
        this.lastError = null;
        this.lastReport = "PA observer active: API, PostgreSQL and Redis health probes passed. No privileged actions were performed.";
        this.emit("report", this.getStatus());
        this.emit("heartbeat", this.getStatus());
      } else {
        this.retryCount += 1;
        this.lastError = "One or more runtime health probes reported unhealthy.";
        this.lastReport = `PA observer degraded: API=${this.health.api}, PostgreSQL=${this.health.database}, Redis=${this.health.redis}. Read-only monitoring continues.`;
        this.emit("healthCheckFailed", this.getStatus());
        this.emit("report", this.getStatus());
      }
    } catch {
      this.observationsCompleted += 1;
      this.lastHeartbeatISO = new Date().toISOString();
      this.retryCount += 1;
      this.lastError = "Runtime health observation failed; diagnostic details were withheld.";
      this.lastReport = "PA observer degraded: a runtime health probe failed. Read-only monitoring continues.";
      this.emit("healthCheckFailed", this.getStatus());
      this.emit("report", this.getStatus());
    } finally {
      this.scheduleNextObservation();
    }
  }

  public getStatus(): AgentPASerializedStatus {
    const healthy = this.health.api && this.health.database && this.health.redis;
    return {
      active: this.active,
      operator: this.masterOperator,
      fastifyApiPort: this.fastifyPort,
      lastHeartbeat: this.lastHeartbeatISO,
      health: { ...this.health },
      workState: !this.active ? "stopped" : this.lastError !== null || !healthy ? "degraded" : "monitoring",
      lastReport: this.lastReport,
      lastError: this.lastError,
      observationsCompleted: this.observationsCompleted,
      eBPFPolicyEnforced: false,
      genXPolicyEngineAvailable: typeof evaluateGenXSecurityEvent === "function",
      retryAttempts: this.retryCount,
    };
  }
}

let activeAgentPAObserver: AgentPAScript | null = null;

export function setAgentPAObserver(observer: AgentPAScript | null): void {
  activeAgentPAObserver = observer;
}

export function getAgentPAStatus(): AgentPASerializedStatus | null {
  return activeAgentPAObserver?.getStatus() ?? null;
}

export default AgentPAScript;
