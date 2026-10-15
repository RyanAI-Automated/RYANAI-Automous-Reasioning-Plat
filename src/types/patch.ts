export interface PatchApplyResult {
  success: boolean;  // Add this property
  message?: string;
  // ... other existing properties
}

export enum PatchStatus {
  PENDING = 'PENDING',
  APPLYING = 'APPLYING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  ROLLED_BACK = 'ROLLED_BACK',
}

export enum PatchTargetType {
  AGENT_INSTANCE = 'AGENT_INSTANCE',
  SYSTEM_CONFIG = 'SYSTEM_CONFIG',
  TELEMETRY_PIPELINE = 'TELEMETRY_PIPELINE',
}

export interface PatchOperation {
  op: 'add' | 'remove' | 'replace' | 'set';
  path: string;
  value?: any;
}

export interface PatchRequest {
  targetType: PatchTargetType;
  targetId?: string;
  version: string;
  operations: PatchOperation[];
  author?: string;
}

export interface PatchResult {
  id: string;
  targetType: PatchTargetType;
  targetId?: string;
  status: PatchStatus;
  version: string;
  appliedAt: string;
  error?: string;
  metadata?: Record<string, any>;
}
