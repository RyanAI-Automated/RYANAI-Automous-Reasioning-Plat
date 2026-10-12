import React, { RefObject } from 'react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

interface ChatStreamProps {
  messages: ChatMessage[];
  containerRef?: RefObject<HTMLDivElement | null>;
  isLoading?: boolean;
}

export const ChatStream: React.FC<ChatStreamProps> = ({
  messages,
  containerRef,
  isLoading,
}) => {
  return (
    // Fixed: Use standard 'ref' on the native div element instead of 'containerRef'
    <div ref={containerRef} className="flex flex-col space-y-4 overflow-y-auto p-4 h-full w-full">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex flex-col p-3 rounded-lg max-w-[85%] ${
            msg.role === 'user'
              ? 'ml-auto bg-blue-600 text-white'
              : 'mr-auto bg-slate-800 text-slate-100 border border-slate-700'
          }`}
        >
          <span className="text-xs font-semibold opacity-70 mb-1 capitalize">
            {msg.role}
          </span>
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
        </div>
      ))}
      {isLoading && (
        <div className="mr-auto bg-slate-800 text-slate-300 p-3 rounded-lg border border-slate-700 animate-pulse text-sm">
          RyanAI is reasoning...
        </div>
      )}
    </div>
  );
};

export default ChatStream;
