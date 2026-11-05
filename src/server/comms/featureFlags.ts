/**
 * Production communications and attachment handling are opt-in.
 * Missing, empty, misspelled, or non-lowercase values remain disabled.
 * Attachment operations additionally require the malware scanner.
 */
export function isCommunicationsEnabled(): boolean {
  return process.env.COMMUNICATIONS_ENABLED === 'true';
}

export function areCommunicationAttachmentsEnabled(): boolean {
  return isCommunicationsEnabled()
    && process.env.COMMUNICATION_ATTACHMENTS_ENABLED === 'true'
    && process.env.ATTACHMENT_SCANNER_ENABLED === 'true';
}
