import React, { useState, useRef } from 'react';

export const RyanVoiceStream = () => {
  const [isListening, setIsListening] = useState(false);
  const audioContext = useRef<AudioContext | null>(null);
  const ws = useRef<WebSocket | null>(null);

  const toggleVoiceLink = () => {
    if (isListening) {
      ws.current?.close();
      setIsListening(false);
      return;
    }

    // Connect to RyanAI Fastify Gateway which proxies to OpenAI Realtime API / ElevenLabs
    ws.current = new WebSocket('wss://api.yourdomain.com/v1/voice-stream');
    
    ws.current.onopen = async () => {
      setIsListening(true);
      audioContext.current = new AudioContext();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = audioContext.current.createMediaStreamSource(stream);
      const processor = audioContext.current.createScriptProcessor(1024, 1, 1);
      
      source.connect(processor);
      processor.connect(audioContext.current.destination);
      
      processor.onaudioprocess = (e) => {
        const pcmData = e.inputBuffer.getChannelData(0);
        // Stream raw audio buffer to Fastify -> OpenAI Realtime
        if (ws.current?.readyState === WebSocket.OPEN) {
          ws.current.send(pcmData.buffer); 
        }
      };
    };

    ws.current.onmessage = (event) => {
      // Receive AI Audio Response from Ryan and play it via AudioContext
      const audioBlob = new Blob([event.data], { type: 'audio/pcm' });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.play();
    };
  };

  return (
    <div className="absolute top-4 right-4 flex items-center gap-3 bg-black/80 border border-cyan-500 p-3 rounded-lg shadow-[0_0_15px_#0ff]">
      <div className={`w-3 h-3 rounded-full ${isListening ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
      <button 
        onClick={toggleVoiceLink}
        className="text-cyan-400 font-mono text-sm uppercase tracking-wider hover:text-white"
      >
        {isListening ? 'Terminate Ryan Link' : 'Initialize Ryan Voice'}
      </button>
    </div>
  );
};