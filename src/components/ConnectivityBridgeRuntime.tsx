import { useEffect } from 'react';
import { requestBridgeTicket, RyanAIBridgeClient } from '@/bridge/client';
import { supabase } from '@/lib/supabase';

interface ConnectivityBridgeRuntimeProps {
  userId: string;
}

const BRIDGE_TOPICS = ['telemetry', 'logs', 'tasks', 'agent.status', 'notifications'];

/** Keeps one authenticated, replayable bridge session for the signed-in browser. */
export default function ConnectivityBridgeRuntime({ userId }: ConnectivityBridgeRuntimeProps) {
  useEffect(() => {
    if (!userId || !supabase) return;
    const client = new RyanAIBridgeClient({
      topics: BRIDGE_TOPICS,
      getTicket: () => requestBridgeTicket(async () => {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        return data.session?.user.id === userId ? data.session.access_token : null;
      }),
      onEvent: (event) => {
        window.dispatchEvent(new CustomEvent('ryanai-bridge-event', { detail: event }));
      },
      onState: (state, detail) => {
        window.dispatchEvent(new CustomEvent('ryanai-bridge-state', { detail: { state, detail, userId } }));
      },
      onCapabilities: (capabilities) => {
        window.dispatchEvent(new CustomEvent('ryanai-bridge-capabilities', { detail: { capabilities, userId } }));
      },
    });
    client.start();
    return () => client.stop();
  }, [userId]);

  return null;
}
