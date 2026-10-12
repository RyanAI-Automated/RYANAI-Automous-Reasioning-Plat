import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, LogOut, Terminal } from 'lucide-react';
import type {
  Conversation,
  ModelId,
  ToolStep,
  SystemStatus,
} from '@/lib/types';
import { DEFAULT_MODEL, modelMeta, MODELS } from '@/lib/models';
import {
  createConversation,
  createMessage,
  generateTitle,
  loadConversations as loadLocalConversations,
  saveConversations,
} from '@/lib/storage';
import { streamReasoning } from '@/lib/reasoning';
import { useVoiceRecognition, VOICE_COMMANDS } from '@/lib/useVoiceRecognition';
import { supabase } from '@/lib/supabase';
import Sidebar from '@/components/Sidebar';
import ChatPanel from '@/components/ChatPanel';
import TelemetryPanel from '@/components/TelemetryPanel';
import AboutModal from '@/components/AboutModel';
import MemoryVault from '@/components/MemoryVault';
import GithubModal from '@/components/GithubModal';
import CodeRain from '@/components/CodeRain';
import ChatInterface from '@/components/ChatInterface';
import Modal from '@/components/Modal';

interface CommandCenterProps {
  onSignOut: () => void;
  userId: string;
  userEmail?: string;
  userFullName?: string;
}

export default function CommandCenter({
  onSignOut,
  userId,
  userEmail,
  userFullName,
}: CommandCenterProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [sending, setSending] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [liveSteps, setLiveSteps] = useState<ToolStep[]>([]);
  const [liveModel, setLiveModel] = useState<ModelId>(DEFAULT_MODEL);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [githubConnected, setGithubConnected] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [status, setStatus] = useState<SystemStatus>({
    cpu: null,
    memory: null,
    latency: null,
    tokensIn: 0,
    tokensOut: 0,
    uptime: '00:00:00',
    model: DEFAULT_MODEL,
    state: 'idle',
  });
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const startTimeRef = useRef(Date.now());
  const requestStartRef = useRef<number | null>(null);
  const voiceStopRef = useRef<() => void>(() => undefined);

  const loadConversations = useCallback(async () => {
    const client = supabase;
    if (!client) {
      const localConversations = loadLocalConversations(userId);
      const supportedConversations = localConversations.map((conversation) => ({
        ...conversation,
        model: MODELS[conversation.model] ? conversation.model : DEFAULT_MODEL,
        messages: conversation.messages.map((message) => ({
          ...message,
          model:
            message.model && MODELS[message.model] ? message.model : undefined,
        })),
      }));
      setConversations(supportedConversations);
      if (supportedConversations.length > 0) {
        setActiveId(supportedConversations[0].id);
        setModel(supportedConversations[0].model);
      }
      return;
    }

    const { data, error } = await client
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Failed to load conversations:', error.message);
      return;
    }

    if (!data || data.length === 0) {
      setConversations([]);
      return;
    }

    // Load messages for each conversation.
    const convsWithMessages: Conversation[] = await Promise.all(
      data.map(async (conv) => {
        const { data: msgs } = await client
          .from('messages')
          .select('*')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: true });

        return {
          id: conv.id,
          title: conv.title,
          model: MODELS[conv.model as ModelId]
            ? (conv.model as ModelId)
            : DEFAULT_MODEL,
          messages: (msgs ?? []).map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            model: m.model as ModelId | undefined,
            steps: m.steps as ToolStep[] | undefined,
            timestamp: new Date(m.created_at).getTime(),
          })),
          createdAt: new Date(conv.created_at).getTime(),
          updatedAt: new Date(conv.updated_at).getTime(),
        };
      }),
    );

    setConversations(convsWithMessages);
    if (convsWithMessages.length > 0) {
      setActiveId(convsWithMessages[0].id);
      setModel(convsWithMessages[0].model);
    }
  }, [userId]);

  useEffect(() => {
    loadConversations();
    setGithubConnected(
      localStorage.getItem(`ryanai_github_connected:${userId}`) === 'true',
    );
  }, [loadConversations, userId]);

  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const hours = Math.floor(elapsed / 3600000);
      const mins = Math.floor((elapsed % 3600000) / 60000);
      const secs = Math.floor((elapsed % 60000) / 1000);
      const uptime = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

      setStatus((prev) => ({
        ...prev,
        uptime,
        model: sending ? liveModel : model,
        state: sending ? 'thinking' : 'idle',
      }));
    }, 2000);
    return () => clearInterval(interval);
  }, [sending, model, liveModel]);

  const activeConversation = conversations.find((c) => c.id === activeId);
  const activeMessages = activeConversation?.messages ?? [];

  const newConversation = useCallback(async () => {
    if (!supabase) {
      const conv = createConversation(model);
      setConversations((prev) => {
        const next = [conv, ...prev];
        saveConversations(next, userId);
        return next;
      });
      setActiveId(conv.id);
      setLiveText('');
      setLiveSteps([]);
      setLeftOpen(false);
      return conv.id;
    }

    const { data, error } = await supabase
      .from('conversations')
      .insert({ title: 'New Thread', model, user_id: userId })
      .select()
      .single();

    if (error || !data) {
      console.error('Failed to create conversation:', error?.message);
      return null;
    }

    const conv: Conversation = {
      id: data.id,
      title: data.title,
      model: data.model as ModelId,
      messages: [],
      createdAt: new Date(data.created_at).getTime(),
      updatedAt: new Date(data.updated_at).getTime(),
    };

    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
    setLiveText('');
    setLiveSteps([]);
    setLeftOpen(false);
    return conv.id;
  }, [model, userId]);

  const selectConversation = useCallback(
    (id: string) => {
      setActiveId(id);
      setLeftOpen(false);
      setLiveText('');
      setLiveSteps([]);
      const conv = conversations.find((c) => c.id === id);
      if (conv) setModel(conv.model);
    },
    [conversations],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      if (supabase) {
        await supabase.from('conversations').delete().eq('id', id);
      }
      setConversations((prev) => {
        const remaining = prev.filter((c) => c.id !== id);
        if (!supabase) saveConversations(remaining, userId);
        if (activeId === id) {
          if (remaining.length > 0) {
            setActiveId(remaining[0].id);
            setModel(remaining[0].model);
          } else {
            setActiveId(null);
          }
        }
        return remaining;
      });
    },
    [activeId, userId],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      let convId = activeId;
      if (!convId) {
        convId = await newConversation();
        if (!convId) return;
      }

      if (!mountedRef.current) return;
      const userMsg = createMessage('user', text);
      setConversations((prev) => {
        const next = prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                messages: [...c.messages, userMsg],
                updatedAt: Date.now(),
                title: c.messages.length === 0 ? generateTitle(text) : c.title,
              }
            : c,
        );
        if (!supabase) saveConversations(next, userId);
        return next;
      });

      if (supabase) {
        await supabase.from('messages').insert({
          conversation_id: convId,
          role: 'user',
          content: text,
        });
      }

      if (!mountedRef.current) return;
      // Update conversation title if first message
      const conv = conversations.find((c) => c.id === convId);
      if (conv && conv.messages.length === 0) {
        const title = generateTitle(text);
        if (supabase) {
          await supabase
            .from('conversations')
            .update({ title, updated_at: new Date().toISOString() })
            .eq('id', convId);
        }
      }

      if (!mountedRef.current) return;
      setSending(true);
      requestStartRef.current = performance.now();
      setLiveText('');
      setLiveSteps([]);
      setLiveModel(model);

      let accText = '';
      const accSteps: ToolStep[] = [];

      try {
        await streamReasoning(text, model, {
          onToken: (t) => {
            if (!mountedRef.current) return;
            accText += t;
            setLiveText(accText);
          },
          onStep: (step) => {
            if (!mountedRef.current) return;
            accSteps.push(step);
            setLiveSteps([...accSteps]);
          },
          onTitle: (title) => {
            if (!mountedRef.current) return;
            setConversations((prev) => {
              const next = prev.map((c) =>
                c.id === convId ? { ...c, title } : c,
              );
              if (!supabase) saveConversations(next, userId);
              return next;
            });
            if (supabase) {
              supabase
                .from('conversations')
                .update({ title, updated_at: new Date().toISOString() })
                .eq('id', convId);
            }
          },
          onDone: () => {
            if (!mountedRef.current) return;
            const assistantMsg = createMessage(
              'assistant',
              accText,
              model,
              accSteps,
            );
            setConversations((prev) => {
              const next = prev.map((c) =>
                c.id === convId
                  ? {
                      ...c,
                      messages: [...c.messages, assistantMsg],
                      updatedAt: Date.now(),
                    }
                  : c,
              );
              if (!supabase) saveConversations(next, userId);
              return next;
            });
            setLiveText('');
            setLiveSteps([]);

            if (supabase) {
              supabase.from('messages').insert({
                conversation_id: convId,
                role: 'assistant',
                content: accText,
                model,
                steps: accSteps.length > 0 ? accSteps : null,
              });
            }

            setStatus((prev) => ({
              ...prev,
              latency:
                requestStartRef.current === null
                  ? prev.latency
                  : Math.round(performance.now() - requestStartRef.current),
              tokensIn: prev.tokensIn + Math.floor(text.length / 4),
              tokensOut: prev.tokensOut + Math.floor(accText.length / 4),
              state: 'idle',
            }));
            requestStartRef.current = null;
          },
          onError: (msg) => {
            if (!mountedRef.current) return;
            console.error('Reasoning error:', msg);
            const errorMessage = createMessage(
              'assistant',
              `Reasoning request failed: ${msg}`,
              model,
              accSteps,
            );
            setConversations((prev) => {
              const next = prev.map((c) =>
                c.id === convId
                  ? {
                      ...c,
                      messages: [...c.messages, errorMessage],
                      updatedAt: Date.now(),
                    }
                  : c,
              );
              if (!supabase) saveConversations(next, userId);
              return next;
            });
            setLiveText('');
            setLiveSteps([]);
            setStatus((prev) => ({
              ...prev,
              latency:
                requestStartRef.current === null
                  ? prev.latency
                  : Math.round(performance.now() - requestStartRef.current),
              state: 'error',
            }));
            requestStartRef.current = null;
          },
        });
      } catch {
        console.error('Stream failed');
      } finally {
        setSending(false);
      }
    },
    [activeId, model, newConversation, conversations, userId],
  );

  const changeModel = useCallback(
    (m: ModelId) => {
      setModel(m);
      if (activeId) {
        setConversations((prev) => {
          const next = prev.map((c) =>
            c.id === activeId ? { ...c, model: m } : c,
          );
          if (!supabase) saveConversations(next, userId);
          return next;
        });
        if (supabase) {
          supabase
            .from('conversations')
            .update({ model: m })
            .eq('id', activeId);
        }
      }
    },
    [activeId, userId],
  );

  const exportThread = useCallback(() => {
    const conv = conversations.find((c) => c.id === activeId);
    if (!conv || conv.messages.length === 0) return;
    const title = conv.title || 'RyanAI thread';
    let md = `# ${title}\n\n> Exported from RyanAI · Autonomous Reasoning Engine\n> Model: ${modelMeta(conv.model).label}\n\n`;
    conv.messages.forEach((m) => {
      md += `## ${m.role === 'user' ? 'Operator' : `RyanAI (${modelMeta(m.model).label})`}\n\n${m.content}\n\n`;
      if (m.steps?.length) {
        md += `<details><summary>Tool trace (${m.steps.length})</summary>\n\n`;
        m.steps.forEach((s) => {
          md += `- \`${s.type}\` **${s.name}** → ${s.result || JSON.stringify(s.args)}\n`;
        });
        md += `\n</details>\n\n`;
      }
      md += `---\n\n`;
    });
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title
      .replace(/[^a-z0-9]+/gi, '-')
      .toLowerCase()
      .slice(0, 40)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeId, conversations]);

  // Voice command handler
  const handleVoiceCommand = useCallback(
    (command: string, args: string) => {
      void args;
      switch (command) {
        case 'new_thread':
          newConversation();
          break;
        case 'switch_gemini':
          changeModel('gemini-3.1-pro');
          break;
        case 'switch_claude':
          changeModel('claude-sonnet-4.6');
          break;
        case 'switch_gpt':
          changeModel('gpt-5.4');
          break;
        case 'export':
          exportThread();
          break;
        case 'open_memory':
          setMemoryOpen(true);
          break;
        case 'open_about':
          setAboutOpen(true);
          break;
        case 'open_github':
          setGithubOpen(true);
          break;
        case 'stop':
          voiceStopRef.current();
          break;
      }
    },
    [newConversation, changeModel, exportThread],
  );

  const handleVoiceTranscript = useCallback(
    (text: string, isFinal: boolean) => {
      if (!isFinal) return;
      const lower = text.toLowerCase().trim();
      const isCommand = Object.values(VOICE_COMMANDS).some((def) =>
        def.keywords.some((kw) => lower.startsWith(kw)),
      );
      if (!isCommand && text.trim()) {
        sendMessage(text.trim());
      }
    },
    [sendMessage],
  );

  const voice = useVoiceRecognition({
    onTranscript: handleVoiceTranscript,
    onCommand: handleVoiceCommand,
  });
  voiceStopRef.current = voice.stop;

  const lastAssistant = [...activeMessages]
    .reverse()
    .find((m) => m.role === 'assistant');
  const traceSteps = sending ? liveSteps : (lastAssistant?.steps ?? []);

  const sidebar = (
    <Sidebar
      conversations={conversations}
      activeId={activeId}
      onSelect={selectConversation}
      onNew={newConversation}
      onDelete={deleteConversation}
      onAbout={() => setAboutOpen(true)}
      onMemory={() => setMemoryOpen(true)}
      onConsole={() => setConsoleOpen(true)}
      onGithub={() => setGithubOpen(true)}
      githubConnected={githubConnected}
    />
  );

  const telemetry = (
    <TelemetryPanel status={status} steps={traceSteps} sending={sending} />
  );

  // Updated chatPanelProps utilizing explicit union type casting
  const chatPanelProps = {
    messages: activeMessages,
    model,
    onModelChange: changeModel,
    sending,
    liveText,
    liveModel,
    onSend: sendMessage,
    onExport: exportThread,
    activeTitle: activeConversation?.title,
    onOpenLeft: () => setLeftOpen(true),
    onOpenRight: () => setRightOpen(true),
    voiceState: voice.state as 'listening' | 'processing' | 'idle',
    voiceInterim: voice.interimText,
    voiceSupported: voice.isSupported,
    onVoiceToggle: voice.toggle,
    onVoiceCommand: handleVoiceCommand,
  };

  return (
    <div className="h-screen hud-radial hud-grid hud-scanlines overflow-hidden relative">
      <CodeRain />

      {/* Desktop layout */}
      <div className="h-full hidden lg:grid lg:grid-cols-12 gap-4 p-4 relative z-10">
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="lg:col-span-3 h-full"
        >
          {sidebar}
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="lg:col-span-6 h-full"
        >
          <ChatPanel {...chatPanelProps} />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="lg:col-span-3 h-full"
        >
          {telemetry}
        </motion.div>
      </div>

      {/* Mobile layout */}
      <div className="h-full lg:hidden flex flex-col relative z-10">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-cyan-500/15 glass">
          <button
            onClick={() => setLeftOpen(true)}
            className="p-1.5 rounded-lg hover:bg-cyan-500/10 text-ink-400"
          >
            <Menu size={18} />
          </button>
          <div className="flex items-center gap-2 flex-1">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-cyan-600 flex items-center justify-center">
              <span className="font-display font-black text-ink-950 text-xs">
                R
              </span>
            </div>
            <span className="font-display font-bold text-cyan-300 text-sm tracking-wider">
              RYANAI
            </span>
          </div>
          <div className="flex items-center gap-2">
            {userEmail && (
              <span className="text-[10px] text-ink-500 font-mono hidden sm:inline">
                {userFullName || userEmail}
              </span>
            )}
            <button
              onClick={onSignOut}
              className="p-1.5 rounded-lg hover:bg-rose-500/10 text-ink-400 hover:text-rose-400 transition-colors"
            >
              <LogOut size={16} />
            </button>
          </div>
          <button
            onClick={() => setRightOpen(true)}
            className="p-1.5 rounded-lg hover:bg-cyan-500/10 text-ink-400"
          >
            <Menu size={18} className="rotate-180" />
          </button>
        </div>
        <div className="flex-1 p-3">
          <ChatPanel {...chatPanelProps} />
        </div>
      </div>

      {/* Mobile drawers */}
      <AnimatePresence>
        {leftOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 lg:hidden"
            onClick={() => setLeftOpen(false)}
          >
            <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'tween', duration: 0.25 }}
              onClick={(e) => e.stopPropagation()}
              className="absolute left-0 top-0 bottom-0 w-[280px] p-3"
            >
              {sidebar}
            </motion.div>
          </motion.div>
        )}
        {rightOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 lg:hidden"
            onClick={() => setRightOpen(false)}
          >
            <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.25 }}
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-0 bottom-0 w-[300px] p-3"
            >
              {telemetry}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <MemoryVault
        userId={userId}
        open={memoryOpen}
        onClose={() => setMemoryOpen(false)}
      />
      <Modal
        open={consoleOpen}
        onClose={() => setConsoleOpen(false)}
        title="Inference Console"
        icon={<Terminal size={16} />}
      >
        <div className="h-[26rem] -m-2 overflow-hidden rounded-lg">
          <ChatInterface />
        </div>
      </Modal>
      <GithubModal
        open={githubOpen}
        onClose={() => setGithubOpen(false)}
        connected={githubConnected}
      />
    </div>
  );
}
