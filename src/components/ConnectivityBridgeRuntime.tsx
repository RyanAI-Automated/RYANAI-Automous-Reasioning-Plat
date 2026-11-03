import { useEffect, useState } from 'react';
import { ConnectivityBridgeClient, type BridgeCapabilities } from '@/api/connectivityBridge';
import { supabase } from '@/lib/supabase';

interface ConnectivityBridgeRuntimeProps {
  userId: string;
}

/** Keeps one authenticated, replayable bridge session for the signed-in browser. */
export default function ConnectivityBridgeRuntime({ userId }: ConnectivityBridgeRuntimeProps) {
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'degraded' | 'closed'>('connecting');
  const [capabilities, setCapabilities] = useState<BridgeCapabilities>({});
  const [replayGap, setReplayGap] = useState(false);

  useEffect(() => {
    if (!userId || !supabase) return;
    const client = new ConnectivityBridgeClient({
      getAccessToken: async () => {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        return data.session?.user.id === userId ? data.session.access_token : null;
      },
      onEvent: (event) => {
        window.dispatchEvent(new CustomEvent('ryanai-bridge-event', { detail: event }));
      },
      onState: (state) => {
        setConnectionState(state);
        window.dispatchEvent(new CustomEvent('ryanai-bridge-state', { detail: { state, userId } }));
      },
      onCapabilities: (nextCapabilities) => {
        setCapabilities(nextCapabilities);
        window.dispatchEvent(new CustomEvent('ryanai-bridge-capabilities', { detail: { capabilities, userId } }));
      },
      onReplayGap: (gap) => {
        setReplayGap(true);
        window.dispatchEvent(new CustomEvent('ryanai-bridge-replay-gap', { detail: { ...gap, userId } }));
      },
    });
    client.connect();

    let vercelHeartbeatTimer: ReturnType<typeof setInterval> | undefined;
    if (import.meta.env.VITE_VERCEL_BRIDGE_ADAPTER_ENABLED === 'true') {
      const sendVercelHeartbeat = async () => {
        try {
          const { data, error } = await supabase.auth.getSession();
          if (error || data.session?.user.id !== userId) return;
          await fetch('/api/bridge/heartbeat', {
            method: 'POST',
            headers: { authorization: 'Bearer ' + data.session.access_token },
            cache: 'no-store',
            signal: AbortSignal.timeout(5000),
          });
        } catch {
          // The bridge will mark Vercel unavailable when its independent heartbeat expires.
        }
      };
      void sendVercelHeartbeat();
      vercelHeartbeatTimer = setInterval(() => void sendVercelHeartbeat(), 30000);
    }

    return () => {
      if (vercelHeartbeatTimer) clearInterval(vercelHeartbeatTimer);
      client.disconnect();
    };
  }, [userId]);

  const stateLabel = connectionState === 'connected' ? 'connected' : connectionState;
  const stateColor = connectionState === 'connected' ? 'text-emerald-400' : connectionState === 'degraded' ? 'text-amber-400' : 'text-slate-400';
  return (
    <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-2 text-xs">
      <span className={stateColor}>Bridge: {stateLabel}</span>
      <span className={capabilities.api === 'ready' ? 'text-emerald-400' : 'text-slate-400'}>API: {capabilities.api ?? 'unknown'}</span>
      <span className={capabilities.vercel === 'ready' ? 'text-emerald-400' : 'text-slate-400'}>Vercel: {capabilities.vercel ?? 'unknown'}</span>
      <span className={capabilities.mcp === 'ready' ? 'text-emerald-400' : 'text-slate-400'}>MCP: {capabilities.mcp ?? 'unknown'}</span>
      {replayGap && <span className="text-amber-400">History gap: reconciliation required</span>}
    </div>
  );
}
