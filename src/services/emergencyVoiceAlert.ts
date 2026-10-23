import twilio from 'twilio';

export interface SigkillAlertContext {
  pid: number;
  command: string;
  violations: string[];
  user?: string;
  timestamp: string;
}

export class EmergencyVoiceAlertService {
  private defaultRecipient = process.env.DEFAULT_RECIPIENT_PHONE || '+27820000000';
  private baseUrl = process.env.BASE_URL || 'https://your-domain.ngrok-free.app';

  /**
   * Dispatches an immediate outbound voice call when eBPF kernel sends SIGKILL
   */
  async dispatchKernelKillCall(context: SigkillAlertContext): Promise<string> {
    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    const reason = `CRITICAL_SECURITY_EVENT: eBPF Kernel SIGKILL on PID ${context.pid}`;
    const primaryViolation = context.violations[0] || 'Unauthorized kernel execution attempt';
    
    const speechMessage = `Security override engaged. I have executed an immediate hardware kernel SIGKILL on process ID ${context.pid}. Attempted command: ${context.command}. Violation reason: ${primaryViolation}. Host system remains secure.`;

    const twimlUrl = `${this.baseUrl}/api/v1/voice/emergency-twiml?pid=${context.pid}&reason=${encodeURIComponent(
      reason
    )}&message=${encodeURIComponent(speechMessage)}`;

    try {
      console.warn(`[EMERGENCY_DISPATCH] Initiating phone call to ${this.defaultRecipient}...`);

      const call = await twilioClient.calls.create({
        to: this.defaultRecipient,
        from: process.env.TWILIO_PHONE_NUMBER!,
        url: twimlUrl,
        statusCallback: `${this.baseUrl}/api/v1/voice/status`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
        timeLimit: 180,
      });

      console.log(`[EMERGENCY_DISPATCH_SUCCESS] Call dispatched. SID: ${call.sid}`);
      return call.sid;
    } catch (error) {
      console.error('[EMERGENCY_DISPATCH_FAILED] Failed to place Twilio call:', error);
      throw error;
    }
  }
}