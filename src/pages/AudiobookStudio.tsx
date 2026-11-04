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
function decodeAudioBase64(value: string, mimeType = 'audio/mpeg'): Blob {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
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
  const [initialProject] = useState(() => loadProject(userId));
  const [serverProjectId, setServerProjectId] = useState<string | null>(null);
  const [serverReady, setServerReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState('Connecting to private audiobook storage…');

  const [project, setProject] = useState<Project>(initialProject);
  const [activeId, setActiveId] = useState(initialProject.chapters[0].id);
  const [busy, setBusy] = useState<'transcribe' | 'render' | 'book' | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioName, setAudioName] = useState('chapter.mp3');
  const [renderedFiles, setRenderedFiles] = useState<Record<string, { url: string; name: string }>>({});
  const renderedUrls = useRef(new Set<string>());
  const uploadRef = useRef<HTMLInputElement>(null);
  const chapter = useMemo(() => project.chapters.find(c => c.id === activeId) ?? project.chapters[0], [project.chapters, activeId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await authenticatedFetch('/api/v1/audiobooks');
        const data = await response.json() as { projects?: Array<{ id: string; title: string; language: string; chapters: Array<{ id: string; title: string; content: string; narrationSettings?: unknown }> }>; error?: string };
        if (!response.ok) throw new Error(data.error || 'Could not load saved audiobook projects.');
        const saved = data.projects?.[0];
        if (saved) {
          if (!active) return;
          const chapters = saved.chapters.map(item => {
            const settings = item.narrationSettings && typeof item.narrationSettings === 'object' ? item.narrationSettings as Record<string, unknown> : {};
            return { id: item.id, title: item.title, text: item.content, voice: VOICES.includes(settings.voice as typeof VOICES[number]) ? String(settings.voice) : 'coral', style: typeof settings.style === 'string' ? settings.style : '', speed: typeof settings.speed === 'number' && settings.speed >= .8 && settings.speed <= 1.2 ? settings.speed : 1 };
          });
          setProject({ title: saved.title, language: isRyanLanguage(saved.language) ? saved.language : DEFAULT_LANGUAGE, chapters: chapters.length ? chapters : initialProject.chapters });
          setActiveId(chapters[0]?.id ?? initialProject.chapters[0].id);
          setServerProjectId(saved.id);
          setSyncStatus('Saved to your private RyanAI account.');
        } else {
          const create = await authenticatedFetch('/api/v1/audiobooks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: initialProject.title, language: initialProject.language, chapters: initialProject.chapters }) });
          const created = await create.json() as { project?: { id: string }; error?: string };
          if (!create.ok || !created.project?.id) throw new Error(created.error || 'Could not create your private audiobook project.');
          if (!active) return;
          setServerProjectId(created.project.id);
          setSyncStatus('Saved to your private RyanAI account.');
        }
      } catch (cause) {
        if (active) { setSyncStatus('Local draft only — server persistence is unavailable.'); setError(cause instanceof Error ? cause.message : 'Could not connect to audiobook storage.'); }
      } finally { if (active) setServerReady(true); }
    })();
    return () => { active = false; };
  }, [userId]);
  useEffect(() => {
    try { localStorage.setItem(KEY + userId, JSON.stringify(project)); }
    catch { setError('Browser storage is full. Export your manuscript before continuing.'); }
  }, [project, userId]);
  useEffect(() => {
    if (!serverReady || !serverProjectId) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await authenticatedFetch('/api/v1/audiobooks/' + serverProjectId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: project.title, language: project.language, chapters: project.chapters }) });
          const result = await response.json() as { error?: string };
          if (!response.ok) throw new Error(result.error || 'Could not save audiobook changes.');
          setSyncStatus('All changes saved to PostgreSQL.');
        } catch (cause) { setSyncStatus('Save failed — your local draft is retained.'); setError(cause instanceof Error ? cause.message : 'Could not save audiobook changes.'); }
      })();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [project, serverProjectId, serverReady]);

  useEffect(() => () => { renderedUrls.current.forEach(url => URL.revokeObjectURL(url)); }, []);

  const updateChapter = useCallback((patch: Partial<Chapter>) => {
    setProject(current => ({ ...current, chapters: current.chapters.map(c => c.id === activeId ? { ...c, ...patch } : c) }));
  }, [activeId]);
  const onTranscript = useCallback((text: string, final: boolean) => {
    if (final && text.trim()) setProject(current => ({ ...current, chapters: current.chapters.map(c => c.id === activeId ? { ...c, text: [c.text.trim(), text.trim()].filter(Boolean).join(' ') } : c) }));
  }, [activeId]);
  const recognition = useVoiceRecognition({ language: project.language, onTranscript });
  useEffect(() => { recognition.stop(); }, [activeId, recognition.stop]);

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
      const response = await authenticatedFetch('/api/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: chapter.text, language: project.language, voice: chapter.voice, style: chapter.style, speed: chapter.speed }) });
      const result = await response.json() as { audioBase64?: string; mimeType?: string; error?: string };
      if (!response.ok || !result.audioBase64) throw new Error(result.error || 'Narration generation failed.');
      const url = URL.createObjectURL(decodeAudioBase64(result.audioBase64, result.mimeType || 'audio/mpeg'));
      renderedUrls.current.add(url);
      const name = `${chapter.title.replace(/[^a-z0-9-_]/gi, '-').slice(0, 60) || 'chapter'}.mp3`;
      setRenderedFiles(current => ({ ...current, [chapter.id]: { url, name } }));
      setAudioUrl(url);
      setAudioName(name);
      setStatus('Narration generated. Listen and review before exporting.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Narration generation failed.'); setStatus(''); }
    finally { setBusy(null); }
  };

  const renderEntireBook = async () => {
    if (!serverProjectId) { setError('Connect to PostgreSQL before starting a durable audiobook render.'); return; }
    if (project.chapters.some(item => !item.text.trim())) { setError('Every chapter needs manuscript text before rendering the entire audiobook.'); return; }
    setBusy('book'); setError(''); setStatus('Saving manuscript and queuing durable render job…');
    try {
      const save = await authenticatedFetch('/api/v1/audiobooks/' + serverProjectId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: project.title, language: project.language, chapters: project.chapters }) });
      const saved = await save.json() as { error?: string };
      if (!save.ok) throw new Error(saved.error || 'Could not save manuscript before rendering.');
      const queued = await authenticatedFetch('/api/v1/audiobooks/' + serverProjectId + '/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) });
      const queuedData = await queued.json() as { job?: { id: string; status: string }; error?: string };
      if (!queued.ok || !queuedData.job?.id) throw new Error(queuedData.error || 'Could not queue audiobook render.');
      const jobId = queuedData.job.id;
      let jobStatus = queuedData.job.status;
      setStatus('Render job queued. The server worker continues independently of this page.');
      while (jobStatus === 'queued' || jobStatus === 'running' || jobStatus === 'cancel_requested') {
        await new Promise(resolve => window.setTimeout(resolve, 2500));
        const poll = await authenticatedFetch('/api/v1/audiobook-jobs/' + jobId);
        const data = await poll.json() as { job?: { status: string; progress?: { completedChapters?: number; totalChapters?: number; currentChapter?: string }; error?: string }; error?: string };
        if (!poll.ok || !data.job) throw new Error(data.error || 'Could not retrieve render job status.');
        jobStatus = data.job.status;
        if (jobStatus === 'running') setStatus('Rendering: ' + (data.job.progress?.completedChapters ?? 0) + '/' + (data.job.progress?.totalChapters ?? project.chapters.length) + ' chapters complete.');
        if (jobStatus === 'failed') throw new Error(data.job.error || 'Audiobook rendering failed after its retry limit.');
        if (jobStatus === 'cancelled') throw new Error('Audiobook rendering was cancelled.');
      }
      const downloadsResponse = await authenticatedFetch('/api/v1/audiobook-jobs/' + jobId + '/downloads');
      const downloadData = await downloadsResponse.json() as { downloads?: Array<{ chapterId: string; chapterTitle: string; url: string }>; error?: string };
      if (!downloadsResponse.ok || !downloadData.downloads?.length) throw new Error(downloadData.error || 'No downloadable chapter artifacts were returned.');
      const urls = new Map(downloadData.downloads.map(item => [item.chapterId, item.url]));
      const files: Record<string, { url: string; name: string }> = {};
      for (const item of project.chapters) {
        const signedUrl = urls.get(item.id);
        if (!signedUrl) continue;
        const media = await fetch(signedUrl);
        if (!media.ok) throw new Error('Could not retrieve rendered audio for ' + item.title + '.');
        const url = URL.createObjectURL(await media.blob());
        renderedUrls.current.add(url);
        files[item.id] = { url, name: (item.title.replace(/[^a-z0-9-_]/gi, '-').slice(0, 60) || 'chapter') + '.mp3' };
      }
      setRenderedFiles(current => ({ ...current, ...files }));
      setStatus('Audiobook render completed. ' + Object.keys(files).length + ' chapter MP3 files are ready.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Audiobook rendering could not be completed.'); setStatus(''); }
    finally { setBusy(null); }
  };

  const addChapter = () => { const next = newChapter(project.chapters.length + 1); setProject(p => ({ ...p, chapters: [...p.chapters, next] })); setActiveId(next.id); setAudioUrl(null); };
  const deleteChapter = () => {
    if (!chapter || project.chapters.length < 2) return;
    const rest = project.chapters.filter(c => c.id !== chapter.id);
    setProject(p => ({ ...p, chapters: rest })); setActiveId(rest[0].id); setAudioUrl(renderedFiles[rest[0].id]?.url ?? null);
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
        {project.chapters.map((c, i) => <button key={c.id} onClick={() => { setActiveId(c.id); setAudioUrl(renderedFiles[c.id]?.url ?? null); setAudioName(renderedFiles[c.id]?.name ?? 'chapter.mp3'); setError(''); setStatus(''); }} className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${c.id === chapter?.id ? 'bg-cyan-400/15 text-cyan-100' : 'text-slate-400 hover:bg-white/5'}`}><span className="block text-[10px] uppercase opacity-60">Chapter {i + 1}</span><span className="block truncate">{c.title || 'Untitled'}</span></button>)}
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
            <button onClick={() => void render()} disabled={busy !== null || !chapter.text.trim()} className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"><WandSparkles size={16} />{busy === 'render' ? 'Generating…' : 'Generate chapter'}</button><button onClick={() => void renderEntireBook()} disabled={busy !== null || project.chapters.some(c => !c.text.trim())} className="rounded-lg border border-violet-400/40 px-3 py-2 text-sm text-violet-200 disabled:opacity-50">{busy === 'book' ? 'Rendering book…' : 'Render entire audiobook'}</button>
          </div>
          {recognition.isListening && <p role="status" className="text-xs text-emerald-300">Microphone active. Final speech segments are appended to this chapter.</p>}
          {recognition.error && <p role="alert" className="text-sm text-rose-300">{recognition.error}</p>}{recognition.interimText && <p className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-2 text-sm text-emerald-100">Hearing: {recognition.interimText}</p>}
          <label className="block text-xs font-medium text-slate-400">Manuscript / transcript<textarea value={chapter.text} onChange={e => updateChapter({ text: e.target.value })} rows={15} maxLength={100000} placeholder="Write, paste, transcribe or dictate your chapter…" className="mt-2 w-full resize-y rounded-xl border border-slate-700 bg-slate-950 p-4 text-sm leading-7 text-slate-100 focus:border-cyan-400" /></label>
          <div className="grid gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:grid-cols-2">
            <label className="text-xs text-slate-400">Narrator voice<select value={chapter.voice} onChange={e => updateChapter({ voice: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">{VOICES.map(v => <option key={v} value={v}>{v}</option>)}</select></label>
            <label className="text-xs text-slate-400">Speaking speed: {chapter.speed.toFixed(1)}×<input type="range" min=".8" max="1.2" step=".1" value={chapter.speed} onChange={e => updateChapter({ speed: Number(e.target.value) })} className="mt-3 w-full accent-cyan-400" /></label>
            <label className="text-xs text-slate-400 md:col-span-2">Performance direction<textarea value={chapter.style} maxLength={500} rows={2} onChange={e => updateChapter({ style: e.target.value })} placeholder="Warm, suspenseful, calm, conversational…" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /><span className="mt-1 block text-[11px] text-slate-500">Expressive delivery depends on provider capabilities. Word-level timing and mid-word voice switching are not yet exposed.</span></label>
          </div>
          {busy === 'transcribe' && <p role="status" className="text-sm text-cyan-200">Transcribing recording…</p>}
          {<p role="status" className="text-xs text-cyan-200">{syncStatus}</p>}{status && <p role="status" className="text-sm text-emerald-300">{status}</p>}
          {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
          {audioUrl && <div className="space-y-3 rounded-xl border border-cyan-400/20 bg-slate-900/70 p-4"><p className="text-sm font-semibold text-white">Generated narration</p><audio controls src={audioUrl} className="w-full" /><a href={audioUrl} download={audioName} className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/40 px-3 py-2 text-sm text-cyan-100"><Download size={16} /> Download MP3</a></div>}{Object.keys(renderedFiles).length > 0 && <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/60 p-4"><h2 className="text-sm font-semibold text-white">Rendered audiobook chapters</h2>{project.chapters.filter(c => renderedFiles[c.id]).map(c => <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="text-slate-300">{c.title}</span><a href={renderedFiles[c.id].url} download={renderedFiles[c.id].name} className="inline-flex items-center gap-1 text-cyan-200"><Download size={14} /> Download MP3</a></div>)}</div>}
        </>}
        <p className="text-[11px] leading-relaxed text-slate-500">Server-side OPENAI_API_KEY is required for cloud transcription and narration; provider calls may incur usage charges. The key is never sent to the browser. Browser S2T support depends on device/browser. Tshivenda capability is not guaranteed until separately verified.</p>
      </div>
    </div>
  </section>;
}
