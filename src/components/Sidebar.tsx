import { motion } from 'framer-motion';
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
  githubConnected: boolean;
}

/** Render thread selection and workspace actions, including GitHub connection status. */
export default function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onAbout,
  onMemory,
  onConsole,
  onGithub,
  githubConnected,
}: SidebarProps) {

  return (
    <div className="h-full flex flex-col glass rounded-lg border border-cyan-500/20 overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-cyan-500/10">
        <button
          onClick={onNew}
          className="w-full px-3 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 rounded text-sm font-semibold text-cyan-300 transition-colors"
        >
          + New Thread
        </button>
      </div>

      {/* Conversations */}
      <div className="flex-1 overflow-y-auto space-y-1 p-2">
        {conversations.length === 0 ? (
          <div className="text-xs text-ink-600 text-center py-8">No conversations yet</div>
        ) : (
          conversations.map((conv) => (
            <motion.div
              key={conv.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className={`p-2 rounded cursor-pointer text-xs transition-colors ${
                activeId === conv.id
                  ? 'bg-cyan-500/30 text-cyan-200'
                  : 'bg-ink-800/30 text-ink-400 hover:bg-ink-800/50'
              }`}
              onClick={() => onSelect(conv.id)}
            >
              <div className="truncate font-semibold">{conv.title}</div>
              <div className="text-[10px] text-ink-600">{conv.messages.length} messages</div>
            </motion.div>
          ))
        )}
      </div>

      {/* Footer Menu */}
      <div className="border-t border-cyan-500/10 p-2 space-y-1">
        <button
          onClick={onMemory}
          className="w-full px-2 py-1 text-xs rounded hover:bg-cyan-500/10 text-ink-400 hover:text-cyan-300 transition-colors"
        >
          🧠 Memory
        </button>
        <button
          onClick={onAbout}
          className="w-full px-2 py-1 text-xs rounded hover:bg-cyan-500/10 text-ink-400 hover:text-cyan-300 transition-colors"
        >
          ℹ️ About
        </button>
        <button
          onClick={onConsole}
          className="w-full px-2 py-1 text-xs rounded hover:bg-cyan-500/10 text-ink-400 hover:text-cyan-300 transition-colors"
        >
          {'>'} Console
        </button>
        <button
          onClick={onGithub}
          className={`w-full px-2 py-1 text-xs rounded transition-colors ${
            githubConnected
              ? 'bg-green-500/10 text-green-400'
              : 'hover:bg-cyan-500/10 text-ink-400 hover:text-cyan-300'
          }`}
        >
          {githubConnected ? '✓ GitHub' : '⚙️ GitHub'}
        </button>
      </div>
    </div>
  );
}
