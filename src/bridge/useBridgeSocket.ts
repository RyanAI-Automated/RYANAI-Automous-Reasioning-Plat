import { useEffect, useRef, useState } from 'react';
import { BridgeConnectionState, BridgeEvent, RyanAIBridgeClient } from './client';

interface UseBridgeSocketOptions {
  url?: string;
  topics: string[];
  getTicket: () => Promise<string>;
  onEvent: (event: BridgeEvent) => void | Promise<void>;
}

export function useBridgeSocket({ url, topics, getTicket, onEvent }: UseBridgeSocketOptions) {
  const [state, setState] = useState<BridgeConnectionState>('offline');
  const eventRef = useRef(onEvent);
  eventRef.current = onEvent;

  useEffect(() => {
    const client = new RyanAIBridgeClient({
      url,
      topics,
      getTicket,
      onEvent: (event) => eventRef.current(event),
      onState: setState,
    });
    client.start();
    return () => client.stop();
  }, [url, topics.join('|'), getTicket]);

  return { state, isConnected: state === 'connected' };
}
