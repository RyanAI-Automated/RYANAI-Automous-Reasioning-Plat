import { useEffect, useRef, useState } from 'react';
import { BridgeConnectionState, BridgeEvent, RyanAIBridgeClient } from './client';

interface UseBridgeSocketOptions {
  url?: string;
  topics: string[];
  getTicket: () => Promise<string>;
  onEvent: (event: BridgeEvent) => void | Promise<void>;
  enabled?: boolean;
}

export function useBridgeSocket({ url, topics, getTicket, onEvent, enabled = true }: UseBridgeSocketOptions) {
  const [state, setState] = useState<BridgeConnectionState>('offline');
  const eventRef = useRef(onEvent);
  eventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) { setState('offline'); return; }
    const client = new RyanAIBridgeClient({
      url,
      topics,
      getTicket,
      onEvent: (event) => eventRef.current(event),
      onState: setState,
    });
    client.start();
    return () => client.stop();
  }, [url, topics.join('|'), getTicket, enabled]);

  return { state, isConnected: state === 'connected' };
}
