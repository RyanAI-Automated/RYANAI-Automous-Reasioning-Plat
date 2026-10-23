export default function Greeting() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="text-center py-8">
      <h2 className="text-2xl font-bold text-cyan-300 mb-2">{greeting}! 👋</h2>
      <p className="text-ink-400 text-sm">Ask me anything about reasoning, code, or your ideas.</p>
    </div>
  );
}
