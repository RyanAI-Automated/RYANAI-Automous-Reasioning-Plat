// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  addMemoryEntry,
  createConversation,
  createMessage,
  uid,
  deleteMemoryEntry,
  loadConversations,
  loadMemory,
  saveConversations,
  saveMemory,
} from './storage';
import { DEFAULT_MODEL } from './models';
beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  vi.restoreAllMocks();
});
it('isolates local conversations and memories by account without exposing legacy anonymous data', () => {
  localStorage.setItem(
    'ryanai_memory',
    JSON.stringify([{ content: 'legacy data' }]),
  );
  const memory = addMemoryEntry('Alice secret', 'alice');
  const conversation = createConversation(DEFAULT_MODEL);
  saveConversations([conversation], 'alice');
  expect(loadMemory('alice')[0].content).toBe('Alice secret');
  expect(loadConversations('alice')).toEqual([conversation]);
  expect(loadMemory('bob')).toEqual([]);
  expect(loadConversations('bob')).toEqual([]);
  deleteMemoryEntry(memory.id, 'bob');
  expect(loadMemory('alice')).toHaveLength(1);
});

it('deletes only the requested account entry even when two accounts share an entry ID', () => {
  const entry = {
    id: 'shared-id',
    content: 'Alice',
    type: 'note' as const,
    timestamp: 1,
  };
  saveMemory([entry, { ...entry, id: 'keep' }], 'alice');
  saveMemory([{ ...entry, content: 'Bob' }], 'bob');
  deleteMemoryEntry('shared-id', 'alice');
  expect(loadMemory('alice')).toEqual([{ ...entry, id: 'keep' }]);
  expect(loadMemory('bob')).toEqual([{ ...entry, content: 'Bob' }]);
  deleteMemoryEntry('missing', 'bob');
  expect(loadMemory('bob')).toHaveLength(1);
});

it('appends memories with their requested type and preserves existing entries', () => {
  const first = addMemoryEntry('first', 'alice');
  const second = addMemoryEntry('second', 'alice', 'insight');
  expect(first.type).toBe('note');
  expect(second.type).toBe('insight');
  expect(loadMemory('alice')).toEqual([first, second]);
  expect(loadMemory('bob')).toEqual([]);
});

it.each([
  ['ryanai_memory', loadMemory],
  ['ryanai_conversations', loadConversations],
] as const)('isolates malformed and legacy %s data', (key, load) => {
  localStorage.setItem(
    key,
    JSON.stringify([{ content: 'legacy private data' }]),
  );
  localStorage.setItem(`${key}:alice`, '{malformed');
  expect(load('alice')).toEqual([]);
  expect(load('bob')).toEqual([]);
});

it('handles unavailable account storage and quota failures without throwing', () => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => {
      throw new Error('blocked');
    }),
    setItem: vi.fn(() => {
      throw new Error('quota');
    }),
  });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(loadMemory('alice')).toEqual([]);
  expect(loadConversations('alice')).toEqual([]);
  expect(() => saveMemory([], 'alice')).not.toThrow();
  expect(() => saveConversations([], 'alice')).not.toThrow();
  expect(log).toHaveBeenCalledTimes(2);
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

it('generates cryptographic UUIDs for local record and message identifiers', () => {
  const first = uid();
  const second = uid();
  const message = createMessage('user', 'Secure identifier test');

  expect(first).toMatch(UUID_PATTERN);
  expect(second).toMatch(UUID_PATTERN);
  expect(second).not.toBe(first);
  expect(message.id).toMatch(UUID_PATTERN);
});
