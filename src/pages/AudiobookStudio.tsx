import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookAudio, FileAudio, Mic, MicOff, Plus, Download, Trash2, WandSparkles } from 'lucide-react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { useVoiceRecognition } from '@/lib/useVoiceRecognition';
import { DEFAULT_LANGUAGE, RYANAI_LANGUAGES, isRyanLanguage } from '@/shared/languages';

const KEY = 'ryanai:audiobook-project:v1:';
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse'] as const;
interface Chapter { id: string; title: string; text: string; voice: string; style: string; speed: number }
interface Project { title: string; language: string; chapters: Chapter[] }
const newChapter = (n: number): Chapter => ({ id: crypto.randomUUID(), title: `Chapter ${n}`, text: '', voice: 'coral', style: 'Expressive, warm audiobook narration. Use natural pauses and clear pronunciation.', speed: 1 });
function loadProject(userId: string): Project {
  const fallback = { title: 'My RyanAI Audiobook', language: DEFAULT_LANGUAGE, chapters: [newChapter(1)] };
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY + userId) || 'null') as Partial<Project> | null;
    if (!parsed || !Array.isArray(parsed.chapters)) return fallback;
    const chapters = parsed.chapters.filter((c): c is Chapter => Boolean(c && typeof c.id === 'string' && typeof c.title === 'string' && typeof c.text === 'string')).map(c => ({
      id: c.id, title: c.title.slice(0, 120), text: c.text.slice(0, 100000),
      voice: VOICES.includes(c.voice as typeof VOICES[number]) ? c.voice : 'coral',
      style: typeof c.style === 'string' ? c.style.slice(0, 500) : '',
      speed: typeof c.speed === 'number' && c.speed >= .8 && c.speed <= 1.2 ? c.speed : 1,
    }));
    return { title: typeof parsed.title === 'string' ? parsed.title.slice(0, 120) : fallback.title, language: typeof parsed.language === 'string' && isRyanLanguage(parsed.language) ? parsed.language : DEFAULT_LANGUAGE, chapters: chapters.length ? chapters : fallback.chapters };
  } catch { return fallback; }
}
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected audio file.'));
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      const comma = value.indexOf(',');
      if (comma < 0) reject(new Error('Could not encode the selected audio file.'));
      else resolve(value.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export default function AudiobookStudio({ userId }: { userId: string }) {
  const [project, setProject] = useState<Project>(() => loadProject(userId));
  const [activeId, setActiveId] = useState(() => loadProject(userId).chapters[0].id);
  const [busy, setBusy] = useState<'transcribe' | 'render' | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioName, setAudioName] = useState('chapter.mp3');
  const uploadRef = useRef<HTMLInputElement>(null);
  const chapter = useMemo(() => project.chapters.find(c => c.id === activeId) ?? project.chapters[0], [project.chapters, activeId]);

  useEffect(() => {
    try { localStorage.setItem(KEY + userId, JSON.stringify(project)); }
    catch { setError('Browser storage is full. Export your manuscript before continuing.'); }
  }, [project, userId]);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  const updateChapter = useCallback((patch: Partial<Chapter>) => {
    setProject(current => ({ ...current, chapters: current.chapters.map(c => c.id === activeId ? { ...c, ...patch } : c) }));
  }, [activeId]);
  const onTranscript = useCallback((text: string, final: boolean) => {
    if (final && text.trim()) setProject(current => ({ ...current, chapters: current.chapters.map(c => c.id === activeId ? { ...c, text: [c.text.trim(), text.trim()].filter(Boolean).join(' ') } : c) }));
  }, [activeId]);
  const recognition = useVoiceRecognition({ language: project.language, onTranscript });

  const transcribe = async (file?: File) => {
    if (!file || !chapter) return;
    setError(''); setStatus('');
    if (file.size > MAX_AUDIO_BYTES) { setError('Audio uploads are limited to 16 MB.'); return; }
    if (!file.type.startsWith('audio/') && file.type !== 'video/mp4') { setError('Choose an audio file such as MP3, WAV, M4A, OGG or WebM.'); return; }
    setBusy('transcribe');
    try {
      const response = await authenticatedFetch('/api/v1/audio/transcriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioBase64: await toBase64(file), mimeType: file.type, fileName: file.name, language: project.language }) });
      const result = await response.json() as { text?: string; error?: string };
      if (!response.ok || !result.text) throw new Error(result.error || 'Transcription failed.');
      updateChapter({ text: [chapter.text.trim(), result.text.trim()].filter(Boolean).join('\n\n') });
      setStatus('Transcription completed. Review the transcript before publishing.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Transcription failed.'); }
    finally { setBusy(null); if (uploadRef.current) uploadRef.current.value = ''; }
  };

  const render = async () => {
    if (!chapter?.text.trim()) { setError('Add or transcribe chapter text before generating narration.'); return; }
    if (chapter.text.length > 4000) { setError('Render one segment at a time. Each narration request is limited to 4,000 characters.'); return; }
    setBusy('render'); setError(''); setStatus('Generating narration…');
    try {
      const response = await authenticatedFetch('/api/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: chapter.text, voice: chapter.voice, style: chapter.style, speed: chapter.speed }) });
      const result = await response.json() as { audioBase64?: string; mimeType?: string; error?: string };
      if (!response.ok || !result.audioBase64) throw new Error(result.error || 'Narration generation failed.');
      const binary = atob(result.audioBase64); const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType || 'audio/mpeg' }));
      setAudioUrl(current => { if (current) URL.revokeObjectURL(current); return url; });
      setAudioName(`${chapter.title.replace(/[^a-z0-9-_]/gi, '-').slice(0, 60) || 'chapter'}.mp3`);
      setStatus('Narration generated. Listen and review before exporting.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Narration generation failed.'); setStatus(''); }
    finally { setBusy(null); }
  };

  const addChapter = () => { const next = newChapter(project.chapters.length + 1); setProject(p => ({ ...p, chapters: [...p.chapters, next] })); setActiveId(next.id); setAudioUrl(null); };
  const deleteChapter = () => {
    if (!chapter || project.chapters.length < 2) return;
    const rest = project.chapters.filter(c => c.id !== chapter.id);
    setProject(p => ({ ...p, chapters: rest })); setActiveId(rest[0].id); setAudioUrl(null);
  };
  const exportText = () => {
    const text = project.chapters.map(c => `# ${c.title}\n\n${c.text}`).join('\n\n---\n\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${project.title.replace(/[^a-z0-9-_]/gi, '-') || 'audiobook'}.md`; link.click(); URL.revokeObjectURL(url);
  };

  return <section className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-[.24em] text-cyan-300">RyanAI Audio Intelligence</p><h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-white"><BookAudio className="h-6 w-6 text-cyan-300" /> Audiobook Studio</h1><p className="mt-1 text-sm text-slate-400">Transcribe recordings, dictate chapters and create expressive narration.</p></div>
      <button onClick={exportText} className="rounded-lg border border-cyan-400/40 px-4 py-2 text-sm text-cyan-200">Export manuscript</button>
    </header>
    <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="space-y-3 rounded-xl border border-cyan-400/20 bg-slate-900/70 p-3">
        <label className="block text-xs text-slate-400">Project title<input value={project.title} maxLength={120} onChange={e => setProject(p => ({ ...p, title: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label>
        <label className="block text-xs text-slate-400">Language<select value={project.language} onChange={e => setProject(p => ({ ...p, language: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">{RYANAI_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}</select></label>
        <div className="flex items-center justify-between pt-2"><span className="text-xs font-semibold uppercase text-slate-400">Chapters</span><button onClick={addChapter} aria-label="Add chapter" className="rounded p-2 text-cyan-200"><Plus size={17} /></button></div>
        {project.chapters.map((c, i) => <button key={c.id} onClick={() => { setActiveId(c.id); setAudioUrl(null); setError(''); setStatus(''); }} className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${c.id === chapter?.id ? 'bg-cyan-400/15 text-cyan-100' : 'text-slate-400 hover:bg-white/5'}`}><span className="block text-[10px] uppercase opacity-60">Chapter {i + 1}</span><span className="block truncate">{c.title || 'Untitled'}</span></button>)}
        <button onClick={deleteChapter} disabled={project.chapters.length < 2} className="flex items-center gap-2 px-2 py-2 text-xs text-rose-300 disabled:opacity-40"><Trash2 size={14} /> Delete chapter</button>
        <p className="border-t border-slate-800 pt-3 text-[11px] text-slate-500">Manuscript settings save in this browser for this account. Audio files are temporary until downloaded.</p>
      </aside>
      <div className="space-y-4">
        {chapter && <>
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <label className="text-xs text-slate-400">Chapter name<input value={chapter.title} maxLength={120} onChange={e => updateChapter({ title: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-400">{chapter.text.length.toLocaleString()} characters<span className="mt-1 block">4,000 per narration render</span></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => uploadRef.current?.click()} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/40 px-3 py-2 text-sm text-cyan-100 disabled:opacity-50"><FileAudio size={16} /> Transcribe recording</button>
            <input ref={uploadRef} type="file" accept="audio/*,video/mp4" className="hidden" onChange={e => void transcribe(e.target.files?.[0])} />
            <button onClick={recognition.toggle} disabled={!recognition.isSupported || busy !== null} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-50 ${recognition.isListening ? 'border-rose-400/50 text-rose-200' : 'border-slate-700 text-slate-200'}`}>{recognition.isListening ? <MicOff size={16} /> : <Mic size={16} />}{recognition.isListening ? 'Stop live S2T' : 'Start live S2T'}</button>
            <button onClick={() => void render()} disabled={busy !== null || !chapter.text.trim()} className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"><WandSparkles size={16} />{busy === 'render' ? 'Generating…' : 'Generate narration'}</button>
          </div>
          {recognition.isListening && <p role="status" className="text-xs text-emerald-300">Microphone active. Final speech segments are appended to this chapter.</p>}
          {recognition.interimText && <p className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-2 text-sm text-emerald-100">Hearing: {recognition.interimText}</p>}
          <label className="block text-xs font-medium text-slate-400">Manuscript / transcript<textarea value={chapter.text} onChange={e => updateChapter({ text: e.target.value })} rows={15} maxLength={100000} placeholder="Write, paste, transcribe or dictate your chapter…" className="mt-2 w-full resize-y rounded-xl border border-slate-700 bg-slate-950 p-4 text-sm leading-7 text-slate-100 focus:border-cyan-400" /></label>
          <div className="grid gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:grid-cols-2">
            <label className="text-xs text-slate-400">Narrator voice<select value={chapter.voice} onChange={e => updateChapter({ voice: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">{VOICES.map(v => <option key={v} value={v}>{v}</option>)}</select></label>
            <label className="text-xs text-slate-400">Speaking speed: {chapter.speed.toFixed(1)}×<input type="range" min=".8" max="1.2" step=".1" value={chapter.speed} onChange={e => updateChapter({ speed: Number(e.target.value) })} className="mt-3 w-full accent-cyan-400" /></label>
            <label className="text-xs text-slate-400 md:col-span-2">Performance direction<textarea value={chapter.style} maxLength={500} rows={2} onChange={e => updateChapter({ style: e.target.value })} placeholder="Warm, suspenseful, calm, conversational…" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /><span className="mt-1 block text-[11px] text-slate-500">Expressive delivery depends on provider capabilities. Word-level timing and mid-word voice switching are not yet exposed.</span></label>
          </div>
          {busy === 'transcribe' && <p role="status" className="text-sm text-cyan-200">Transcribing recording…</p>}
          {status && <p role="status" className="text-sm text-emerald-300">{status}</p>}
          {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
          {audioUrl && <div className="space-y-3 rounded-xl border border-cyan-400/20 bg-slate-900/70 p-4"><p className="text-sm font-semibold text-white">Generated narration</p><audio controls src={audioUrl} className="w-full" /><a href={audioUrl} download={audioName} className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/40 px-3 py-2 text-sm text-cyan-100"><Download size={16} /> Download MP3</a></div>}
        </>}
        <p className="text-[11px] leading-relaxed text-slate-500">Server-side OPENAI_API_KEY is required for cloud transcription and narration; provider calls may incur usage charges. The key is never sent to the browser. Browser S2T support depends on device/browser. Tshivenda capability is not guaranteed until separately verified.</p>
      </div>
    </div>
  </section>;
}
