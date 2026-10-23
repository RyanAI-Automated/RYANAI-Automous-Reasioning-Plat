import { useEffect, useRef, useState, useCallback } from 'react';
import { TelemetryData, LogEntry, OutgoingMessage, IncomingMessage } from '../types';

export const useTelemetrySocket = (url: string) => {
  const [telemetry, setTelemetry] = useState<TelemetryData>({
    cpuUsage: 0,
    memoryUsage: 0,
    networkLatency: 0,
    activeThreads: 0,
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(url);
    socketRef.current = ws;

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);

    ws.onmessage = (event) => {
      try {
        const message: OutgoingMessage = JSON.parse(event.data);

        if (message.type === 'TELEMETRY') {
          setTelemetry(message.payload);
        } else if (message.type === 'LOG') {
          setLogs((prev) => [message.payload, ...prev.slice(0, 49)]); // Keep last 50
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message', e);
      }
    };

    return () => {
      ws.close();
    };
  }, [url]);

  const sendCommand = useCallback((command: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      const msg: IncomingMessage = { type: 'COMMAND', command };
      socketRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const triggerSweep = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      const msg: IncomingMessage = { type: 'SWEEP_START' };
      socketRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { telemetry, logs, isConnected, sendCommand, triggerSweep };
};