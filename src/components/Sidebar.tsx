import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Trash2, X } from 'lucide-react';
import type { Conversation } from '@/lib/types';

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onAbout: () => void;
  onMemory: () => void;
  onConsole: () => void;
  onGithub: () => void;
}

/** Render account-scoped conversation history and workspace actions. */
export default function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onAbout,
  onMemory,
  onConsole,
  onGithub,
}: SidebarProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  return (
    <aside aria-label="Conversation workspace" className="glass flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-white/10">
      <div className="shrink-0 border-b border-white/10 p-3">
        <button
          type="button"
          onClick={onNew}
          className="w-full rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-2.5 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-300/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
        >
          + New conversation
        </button>
      </div>

      <div role="list" aria-label="Saved conversations" className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <div className="flex h-full min-h-36 flex-col items-center justify-center gap-2 px-4 py-8 text-center" role="status">
            <span aria-hidden="true" className="text-2xl">✦</span>
            <p className="text-sm font-medium text-slate-300">Your workspace is ready</p>
            <p className="text-xs leading-5 text-slate-500">Start a conversation to create your first thread.</p>
            <button
              type="button"
              onClick={onNew}
              className="mt-2 rounded-lg px-3 py-2 text-xs font-semibold text-cyan-200 transition-colors hover:bg-cyan-300/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
            >
              Start a conversation
            </button>
          </div>
        ) : (
          conversations.map((conversation) => (
            <motion.div
              key={conversation.id}
              role="listitem"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="group flex items-center gap-1 rounded-lg"
            >
              <button
                type="button"
                aria-pressed={activeId === conversation.id}
                onClick={() => onSelect(conversation.id)}
                className={`min-w-0 flex-1 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${
                  activeId === conversation.id
                    ? 'bg-cyan-300/12 text-cyan-100'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span className="block truncate text-xs font-semibold">
                  {conversation.title || 'Untitled conversation'}
                </span>
                <span className="mt-1 block text-[10px] text-slate-500">
                  {conversation.messages.length} {conversation.messages.length === 1 ? 'message' : 'messages'}
                </span>
              </button>

              {confirmDeleteId === conversation.id ? (
                <div className="flex shrink-0 items-center gap-1 pr-1" aria-label={`Confirm deletion of ${conversation.title}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(conversation.id);
                      setConfirmDeleteId(null);
                    }}
                    className="rounded-md p-2 text-rose-300 transition-colors hover:bg-rose-400/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-300"
                    aria-label={`Confirm delete ${conversation.title}`}
                    title="Confirm delete"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    className="rounded-md p-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
                    aria-label={`Cancel deleting ${conversation.title}`}
                    title="Cancel"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(conversation.id)}
                  className="mr-1 shrink-0 rounded-md p-2 text-slate-500 opacity-100 transition-colors hover:bg-rose-400/10 hover:text-rose-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-300 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                  aria-label={`Delete conversation ${conversation.title}`}
                  title="Delete conversation"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </motion.div>
          ))
        )}
      </div>

      <nav aria-label="Workspace tools" className="shrink-0 space-y-1 border-t border-white/10 p-2">
        <button type="button" onClick={onMemory} className="w-full rounded-lg px-3 py-2 text-left text-xs text-slate-400 transition-colors hover:bg-cyan-300/10 hover:text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
          <span aria-hidden="true">🧠 </span>Memory
        </button>
        <button type="button" onClick={onAbout} className="w-full rounded-lg px-3 py-2 text-left text-xs text-slate-400 transition-colors hover:bg-cyan-300/10 hover:text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
          <span aria-hidden="true">ℹ️ </span>About
        </button>
        <button type="button" onClick={onConsole} className="w-full rounded-lg px-3 py-2 text-left text-xs text-slate-400 transition-colors hover:bg-cyan-300/10 hover:text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
          <span aria-hidden="true">&gt; </span>Inference console
        </button>
        <button type="button" onClick={onGithub} className="w-full rounded-lg px-3 py-2 text-left text-xs text-slate-400 transition-colors hover:bg-cyan-300/10 hover:text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
          <span aria-hidden="true">⚙️ </span>GitHub setup
        </button>
      </nav>
    </aside>
  );
}
