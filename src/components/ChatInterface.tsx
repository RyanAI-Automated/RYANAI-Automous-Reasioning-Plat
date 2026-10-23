export default function ChatInterface() {
  return (
    <div className="h-full flex items-center justify-center bg-ink-900/50 border border-cyan-500/20 rounded">
      <div className="text-center text-ink-600">
        <div className="text-3xl mb-2">💻</div>
        <p className="text-sm">Inference Console</p>
        <p className="text-xs mt-2">Real-time model output stream</p>
      </div>
    </div>
  );
}
