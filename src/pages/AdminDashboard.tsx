import { KeyRound, ShieldCheck, Wrench, GitPullRequest, Network } from 'lucide-react';
import BrainKnowledgePanel from '@/components/BrainKnowledgePanel';
import SelfPatchPanel from '@/components/SelfPatchPanel';
import AuditLogPanel from '@/components/admin/AuditLogPanel';

const controls = [
  { title: 'Identity and access', description: 'Administrative access is determined by the authenticated server-issued identity and role.', icon: KeyRound },
  { title: 'Security posture', description: 'Review the existing internal Jarvis audit stream. Authentication and session events are not yet unified.', icon: ShieldCheck },
  { title: 'Provider operations', description: 'Review model readiness in the dedicated LLM operations interface.', icon: Network, href: '#/llm' },
  { title: 'Engineering changes', description: 'Submit isolated patch proposals for CI and human review; no direct production mutation.', icon: GitPullRequest },
];

export default function AdminDashboard() {
  return (
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-8">
      <header className="rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-6">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300"><ShieldCheck className="h-4 w-4" /> Restricted control plane</div>
        <h1 className="mt-2 text-3xl font-bold text-white">RyanAI Administration</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Owner and administrator tools. This UI is an additional boundary only; every privileged API must independently enforce authorization.</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        {controls.map(({ title, description, icon: Icon, href }) => <article key={title} className="rounded-xl border border-white/10 bg-slate-900/60 p-4"><div className="flex items-center gap-2 text-cyan-200"><Icon className="h-4 w-4" /><h2 className="text-sm font-semibold text-white">{title}</h2></div><p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>{href && <a href={href} className="mt-3 inline-block text-xs font-semibold text-cyan-200 underline">Open LLM operations</a>}</article>)}
      </div>
      <AuditLogPanel />
      <section className="space-y-3"><h2 className="flex items-center gap-2 text-lg font-semibold text-white"><Wrench className="h-5 w-5 text-cyan-300" /> Knowledge operations</h2><BrainKnowledgePanel /></section>
      <section className="space-y-3"><h2 className="text-lg font-semibold text-white">CI-gated self-patch proposals</h2><SelfPatchPanel /></section>
    </section>
  );
}
