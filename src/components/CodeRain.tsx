import { motion } from 'framer-motion';

export default function CodeRain() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 opacity-5">
      <motion.div
        animate={{ y: ['0%', '100%'] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        className="font-mono text-xs text-cyan-500 whitespace-pre-wrap"
      >
        {Array(50)
          .fill(0)
          .map((_, i) => (
            <div key={i}>{Math.random().toString(2).substring(2).substring(0, 80)}</div>
          ))}
      </motion.div>
    </div>
  );
}
