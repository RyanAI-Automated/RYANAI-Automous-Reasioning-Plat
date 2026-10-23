export interface DiagnosticContext {
  error: Error;
  module: string;
  timestamp: number;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface DiagnosticReport {
  diagnosticId: string;
  module: string;
  message: string;
  stack?: string;
  timestamp: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'PENDING_HEALING_AGENT' | 'IN_PROGRESS' | 'RESOLVED' | 'FAILED';
}

/**
 * Generates a structured diagnostic report for consumption by AgentPA self-healing workflows.
 */
export function generateDiagnosticReport(context: DiagnosticContext): DiagnosticReport {
  // Use crypto.randomUUID() when available, falling back safely for restricted environments
  const diagnosticId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? `diag_${crypto.randomUUID().slice(0, 8)}`
      : `diag_${Math.random().toString(36).substring(2, 9)}`;

  return {
    diagnosticId,
    module: context.module,
    message: context.error?.message || 'Unknown exception',
    stack: context.error?.stack,
    timestamp: context.timestamp || Date.now(),
    severity: context.severity || 'HIGH',
    status: 'PENDING_HEALING_AGENT',
  };
}
