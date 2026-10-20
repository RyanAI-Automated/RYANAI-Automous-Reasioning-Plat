import { useState } from 'react';
import { motion } from 'framer-motion';

const randomLine = () => Math.random().toString(2).substring(2).substring(0, 80);

export default function CodeRain() {
  // Generate the decorative lines once so re-renders do not reshuffle them.
  const [lines] = useState(() => Array.from({ length: 50 }, randomLine));
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 opacity-5">
      <motion.div
        animate={{ y: ['0%', '100%'] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        className="font-mono text-xs text-cyan-500 whitespace-pre-wrap"
      >
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </motion.div>
    </div>
  );
}
