import { motion } from 'framer-motion';

function makeBinaryLine(lineIndex: number): string {
  return Array.from({ length: 80 }, (_, charIndex) => {
    const value = Math.imul(lineIndex + 1, charIndex + 17) + charIndex * 31;
    return Math.abs(value % 7) < 3 ? '1' : '0';
  }).join('');
}

export default function CodeRain() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 opacity-5">
      <motion.div
        animate={{ y: ['0%', '100%'] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        className="font-mono text-xs text-cyan-500 whitespace-pre-wrap"
      >
        {Array.from({ length: 50 }, (_, i) => (
          <div key={i}>{makeBinaryLine(i)}</div>
        ))}
      </motion.div>
    </div>
  );
}
