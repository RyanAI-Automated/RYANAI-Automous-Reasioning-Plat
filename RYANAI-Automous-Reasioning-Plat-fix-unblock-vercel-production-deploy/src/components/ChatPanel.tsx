import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Send, Download, Mic, Square, MoreVertical } from 'lucide-react';
import type { Message, ModelId } from '@/lib/types';
import { getAvailableModels, modelMeta } from '@/lib/models';

interface ChatPanelProps {
  messages: Message[];
  model: ModelId;
  onModelChange: (model: ModelId) => void;
  sending: boolean;
  liveText: string;
  liveModel: ModelId;
  onSend: (text: string) => void;
  onExport: () => void;
  activeTitle?: string;
  onOpenLeft: () => void;
  onOpenRight: () => void;
  voiceState: 'idle' | 'listening' | 'processing';
  voiceInterim: string;
  voiceSupported: boolean;
  onVoiceToggle: () => void;
  onVoiceCommand?: (command: string, args: string) => void;
}

export default function ChatPanel(props: ChatPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const [showModelMenu, setShowModelMenu] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [props.messages, props.liveText]);

  const handleSend = () => {
    if (inputValue.trim()) {
      props.onSend(inputValue);
      setInputValue('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const models: ModelId[] = getAvailableModels().map((model) => model.id);

  return (
    <div className="h-full flex flex-col gap-3 glass rounded-lg border border-cyan-500/20 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-cyan-500/10">
        <div className="flex-1">
          <h2 className="text-sm font-display font-bold text-cyan-300 truncate">
            {props.activeTitle || 'New Conversation'}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowModelMenu(!showModelMenu)}
            className="px-2 py-1 text-xs font-mono bg-cyan-500/10 rounded border border-cyan-500/20 text-cyan-300 hover:bg-cyan-500/20 transition-colors"
          >
            {props.model}
          </button>
          <button
            onClick={props.onExport}
            className="p-1.5 rounded hover:bg-cyan-500/10 text-cyan-400 transition-colors"
            title="Export"
          >
            <Download size={16} />
          </button>
          <button className="p-1.5 rounded hover:bg-cyan-500/10 text-cyan-400 transition-colors">
            <MoreVertical size={16} />
          </button>
        </div>
      </div>

      {/* Model Selector */}
      {showModelMenu && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-3 flex gap-2 border-b border-cyan-500/10 pb-2"
        >
          {models.map((m) => (
            <button
              key={m}
              onClick={() => {
                props.onModelChange(m);
                setShowModelMenu(false);
              }}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                props.model === m
                  ? 'bg-cyan-500/30 border border-cyan-500/50 text-cyan-200'
                  : 'bg-ink-800/30 border border-cyan-500/10 text-ink-400 hover:bg-ink-800/50'
              }`}
            >
              {modelMeta(m).label}
            </button>
          ))}
        </motion.div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 p-4">
        {props.messages.length === 0 && !props.liveText && (
          <div className="h-full flex items-center justify-center text-center">
            <div className="text-ink-600 text-sm">
              <div className="text-3xl mb-2">✨</div>
              <p>Start a conversation...</p>
            </div>
          </div>
        )}

        {props.messages.map((msg, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-xs lg:max-w-md px-3 py-2 rounded-lg text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-cyan-500/20 text-cyan-100'
                  : 'bg-ink-800/50 border border-cyan-500/10 text-ink-200'
              }`}
            >
              {msg.content}
            </div>
          </motion.div>
        ))}

        {props.liveText && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-3 justify-start"
          >
            <div className="max-w-xs lg:max-w-md px-3 py-2 rounded-lg text-sm leading-relaxed bg-ink-800/50 border border-cyan-500/10 text-ink-200">
              {props.liveText}
              <motion.span
                animate={{ opacity: [0, 1] }}
                transition={{ duration: 0.8, repeat: Infinity }}
              >
                ▌
              </motion.span>
            </div>
          </motion.div>
        )}

        {props.voiceInterim && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-3 justify-end"
          >
            <div className="max-w-xs lg:max-w-md px-3 py-2 rounded-lg text-sm text-amber-200 bg-amber-500/10 border border-amber-500/20">
              🎤 {props.voiceInterim}
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-cyan-500/10 space-y-2">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message RyanAI..."
            className="flex-1 bg-ink-800/50 border border-cyan-500/20 rounded px-3 py-2 text-sm text-ink-100 placeholder-ink-600 focus:outline-none focus:border-cyan-500/50 resize-none max-h-24"
            rows={1}
            disabled={props.sending}
          />
          {props.voiceSupported && (
            <button
              onClick={props.onVoiceToggle}
              className={`p-2 rounded transition-colors ${
                props.voiceState === 'listening'
                  ? 'bg-amber-500/30 text-amber-300'
                  : 'hover:bg-cyan-500/10 text-cyan-400'
              }`}
              title="Voice input"
            >
              {props.voiceState === 'listening' ? (
                <Square size={18} />
              ) : (
                <Mic size={18} />
              )}
            </button>
          )}
          <button
            onClick={handleSend}
            disabled={props.sending || !inputValue.trim()}
            className="p-2 rounded bg-cyan-500/20 hover:bg-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-cyan-300 transition-colors"
            title="Send"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
