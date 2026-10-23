import type { ModelId } from '@/lib/types';

export default function Model({ model }: { model?: ModelId }) {
  return (
    <div className="px-2 py-1 text-xs bg-cyan-500/10 rounded border border-cyan-500/20 text-cyan-300">
      {model || 'Unknown Model'}
    </div>
  );
}
