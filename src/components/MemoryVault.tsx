import Modal from './Modal';
import { Brain } from 'lucide-react';
import { useState } from 'react';
import type { MemoryEntry } from '@/lib/types';
import { loadMemory, addMemoryEntry, deleteMemoryEntry } from '@/lib/storage';

interface MemoryVaultProps {
  open: boolean;
  userId: string;
  onClose: () => void;
}

/**
 * Render editable memory entries stored under userId.
 * Entries load on mount; remount the component when changing accounts.
 */
export default function MemoryVault({
  open,
  onClose,
  userId,
}: MemoryVaultProps) {
  const [entries, setEntries] = useState<MemoryEntry[]>(() =>
    loadMemory(userId),
  );
  const [input, setInput] = useState('');

  const handleAdd = () => {
    if (input.trim()) {
      const entry = addMemoryEntry(input, userId);
      setEntries([entry, ...entries]);
      setInput('');
    }
  };

  const handleDelete = (id: string) => {
    deleteMemoryEntry(id, userId);
    setEntries(entries.filter((e) => e.id !== id));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Memory Vault"
      icon={<Brain size={20} />}
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Add a memory..."
            className="flex-1 px-2 py-1 text-sm bg-ink-800/50 border border-cyan-500/20 rounded text-ink-100"
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <button
            onClick={handleAdd}
            className="px-3 py-1 text-sm bg-cyan-500/20 hover:bg-cyan-500/30 rounded text-cyan-300"
          >
            Add
          </button>
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="text-xs p-2 bg-ink-800/30 rounded border border-cyan-500/10"
            >
              <div className="flex justify-between gap-2">
                <div className="flex-1">{entry.content}</div>
                <button
                  onClick={() => handleDelete(entry.id)}
                  className="text-rose-400 hover:text-rose-300"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
