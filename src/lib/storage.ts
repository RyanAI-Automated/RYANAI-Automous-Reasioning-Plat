// src/lib/storage.ts
// LocalStorage and persistence utilities

import type {
  Conversation,
  Message,
  ModelId,
  MemoryEntry,
  ToolStep,
} from './types.js';

const STORAGE_KEY = 'ryanai_conversations';
const MEMORY_KEY = 'ryanai_memory';

export function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/** Create an unsaved message with a generated ID and a timestamp in epoch milliseconds. */
export function createMessage(
  role: 'user' | 'assistant',
  content: string,
  model?: ModelId,
  steps?: ToolStep[],
): Message {
  return {
    id: uid(),
    role,
    content,
    model,
    steps,
    timestamp: Date.now(),
  };
}

export function createConversation(model: ModelId): Conversation {
  const now = Date.now();
  return {
    id: uid(),
    title: 'New Conversation',
    model,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function generateTitle(text: string): string {
  const words = text.split(' ').slice(0, 6);
  return words.join(' ').substring(0, 50) + (text.length > 50 ? '...' : '');
}

/**
 * Load conversations from the localStorage namespace for userId.
 * Returns an empty array for missing data, read failures, or invalid JSON; parsed
 * values are not schema-validated. Legacy unscoped data is not read.
 */
export function loadConversations(userId: string): Conversation[] {
  try {
    const data = localStorage.getItem(`${STORAGE_KEY}:${userId}`);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * Replace the stored conversations in the localStorage namespace for userId.
 * Serialization and storage failures are caught; completion does not confirm a write.
 */
export function saveConversations(
  conversations: Conversation[],
  userId: string,
): void {
  try {
    localStorage.setItem(
      `${STORAGE_KEY}:${userId}`,
      JSON.stringify(conversations),
    );
  } catch (err) {
    console.error('Failed to save conversations:', err);
  }
}

/**
 * Load memory entries from the localStorage namespace for userId.
 * Returns an empty array for missing data, read failures, or invalid JSON; parsed
 * values are not schema-validated. Legacy unscoped data is not read.
 */
export function loadMemory(userId: string): MemoryEntry[] {
  try {
    const data = localStorage.getItem(`${MEMORY_KEY}:${userId}`);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * Replace the stored memory entries in the localStorage namespace for userId.
 * Serialization and storage failures are caught; completion does not confirm a write.
 */
export function saveMemory(entries: MemoryEntry[], userId: string): void {
  try {
    localStorage.setItem(`${MEMORY_KEY}:${userId}`, JSON.stringify(entries));
  } catch (err) {
    console.error('Failed to save memory:', err);
  }
}

/**
 * Append a timestamped memory entry for userId and return it even if saving fails.
 * Previously stored JSON with a non-array shape can cause this call to throw.
 */
export function addMemoryEntry(
  content: string,
  userId: string,
  type: 'note' | 'thought' | 'insight' = 'note',
): MemoryEntry {
  const entry: MemoryEntry = {
    id: uid(),
    content,
    type,
    timestamp: Date.now(),
  };

  const entries = loadMemory(userId);
  entries.push(entry);
  saveMemory(entries, userId);

  return entry;
}

/**
 * Remove matching entries from userId's stored memory; storage failures are caught.
 * Previously stored JSON with a non-array shape can cause this call to throw.
 */
export function deleteMemoryEntry(id: string, userId: string): void {
  const entries = loadMemory(userId);
  const filtered = entries.filter((e) => e.id !== id);
  saveMemory(filtered, userId);
}
