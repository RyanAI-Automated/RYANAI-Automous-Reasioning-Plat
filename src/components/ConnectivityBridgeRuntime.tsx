import { useEffect } from 'react';
import { ConnectivityBridgeClient } from '@/api/connectivityBridge';
import { supabase } from '@/lib/supabase';

interface ConnectivityBridgeRuntimeProps {
  userId: string;
}

/** Keeps one authenticated, replayable bridge session for the signed-in browser. */
export default function ConnectivityBridgeRuntime({ userId }: ConnectivityBridgeRuntimeProps) {
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
        window.dispatchEvent(new CustomEvent('ryanai-bridge-state', { detail: { state, userId } }));
      },
      onCapabilities: (capabilities) => {
        window.dispatchEvent(new CustomEvent('ryanai-bridge-capabilities', { detail: { capabilities, userId } }));
      },
      onReplayGap: (gap) => {
        window.dispatchEvent(new CustomEvent('ryanai-bridge-replay-gap', { detail: { ...gap, userId } }));
      },
    });
    client.connect();
    return () => client.disconnect();
  }, [userId]);

  return null;
}
