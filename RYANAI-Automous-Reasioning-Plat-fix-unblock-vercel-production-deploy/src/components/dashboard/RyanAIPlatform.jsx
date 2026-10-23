import React, { useState, useEffect, useRef } from 'react';
import { 
  FileText, FileSpreadsheet, Download, Upload, Shield, 
  Mail, HardDrive, Contact, MessageSquare, Terminal, 
  Cpu, Zap, DollarSign, RefreshCw, Wrench, Activity, 
  Layers, Power, CheckCircle, Clock, AlertTriangle, 
  ShieldCheck, Play, FolderGit2, CheckCircle2, Sparkles 
} from 'lucide-react';

export default function RyanAIPlatform() {
  // --- AUTH & WORKSPACE STATE (From Enterprise App) ---
  const [authMode, setAuthMode] = useState('RYAN_DOMAIN');
  const [user, setUser] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [docTitle, setDocTitle] = useState('System_Architecture_Doc');
  const [docContent, setDocContent] = useState('RyanAI Autonomous Agent Deployment Framework...');
  
  // --- COCKPIT STATE (From Cockpit) ---
  const [activeView, setActiveView] = useState('CORE'); // CORE or WORKSPACE
  const [isAutonomous, setIsAutonomous] = useState(false);
  const [aiState, setAiState] = useState('idle');
  const [terminalLogs, setTerminalLogs] = useState([
    '[SYSTEM] RyanAI Reasoning Platform initialized.',
    '[SYSTEM] Awaiting user input or autonomous handover...'
  ]);
  const [maintenanceLogs, setMaintenanceLogs] = useState([
    'v4.2.1 Kernel applied successfully.',
    'Memory state optimal.'
  ]);
  
  const terminalEndRef = useRef(null);

  // --- LOGIC: Authentication ---
  const handleLogin = (e) => {
    e.preventDefault();
    if (authMode === 'MASTER') {
      if (username === 'administrator' && password) {
        setUser({ username: 'administrator', role: 'ADMIN', email: 'administrator@ryanai.dev' });
        setStatusMsg('');
      } else {
        setStatusMsg('❌ Master Credentials Rejected.');
      }
    } else {
      setUser({ username, role: 'USER', email: `${username}@ryanai.dev` });
      setStatusMsg('');
    }
  };

  // --- LOGIC: Terminal Auto-scroll ---
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLogs]);

  // --- LOGIC: Autonomous AI Engine ---
  useEffect(() => {
    if (!user) return; // Halt simulation if logged out

    let activityInterval;
    let stateInterval;

    if (isAutonomous) {
      const activeStates = ['reasoning', 'coding', 'self-updating'];
      setAiState('reasoning'); 
      
      const autonomousTasks = [
        '[AGENT] Refactoring legacy components in /src/core...',
        '[AGENT] Scanning enterprise pipeline for vulnerabilities...',
        '[AGENT] Deploying neural scaffold to shadow server...',
        '[AGENT] Auto-resolving pending dependency conflicts...',
        '[AGENT] Pushing milestone update to Phase II...',
        '[AGENT] Generating new architectural proposals...',
        '[AGENT] Compiling micro-agent worker mesh...'
      ];

      const healingTasks = [
        'Auto-patching memory leak in module 0x4B.',
        'Re-indexing cloud databases (Performance +14%).',
        'Purging orphaned Docker containers.',
        'Upgrading encryption keys (Standard rotation).'
      ];

      stateInterval = setInterval(() => {
        setAiState(activeStates[Math.floor(Math.random() * activeStates.length)]);
      }, 4500);

      activityInterval = setInterval(() => {
        setTerminalLogs(prev => [...prev.slice(-15), autonomousTasks[Math.floor(Math.random() * autonomousTasks.length)]]);
        
        if (Math.random() > 0.6) {
          setMaintenanceLogs(prev => [...prev.slice(-5), healingTasks[Math.floor(Math.random() * healingTasks.length)]]);
        }
      }, 2500);

    } else {
      setAiState('idle');
      setTerminalLogs(prev => [...prev, '[SYSTEM] Manual override engaged. Autonomous agent dormant.']);
    }

    return () => {
      clearInterval(activityInterval);
      clearInterval(stateInterval);
    };
  }, [isAutonomous, user]);

  const triggerManualWork = (toolName) => {
    if (isAutonomous) return;
    setAiState('working');
    setTerminalLogs(prev => [...prev.slice(-15), `[USER] Executing unrestricted tool: ${toolName}...`]);
    setTimeout(() => {
      if (!isAutonomous) setAiState('idle');
    }, 3000);
  };

  // --- THEME ---
  const theme = {
    color: isAutonomous ? 'purple' : 'cyan',
    bgCore: isAutonomous ? 'bg-purple-500/20' : 'bg-cyan-500/20',
    borderCore: isAutonomous ? 'border-purple-500/50' : 'border-cyan-500/50',
    glow: isAutonomous ? 'shadow-[0_0_40px_rgba(168,85,247,0.4)]' : 'shadow-[0_0_40px_rgba(6,182,212,0.4)]',
    text: isAutonomous ? 'text-purple-400' : 'text-cyan-400',
    textGlow: isAutonomous ? 'drop-shadow-[0_0_8px_rgba(168,85,247,0.8)]' : 'drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]',
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#050914] text-slate-300 font-sans overflow-hidden selection:bg-cyan-900">
      
      {/* BACKGROUND AMBIENT LIGHT */}
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full blur-[150px] opacity-20 pointer-events-none transition-colors duration-1000 ${isAutonomous ? 'bg-purple-600' : 'bg-cyan-600'}`} />

      {/* ================= GLOBAL HEADER ================= */}
      <div className="flex-none bg-[#0b0f19] border-b border-gray-800/80 px-6 py-3 flex justify-between items-center z-50">
        <div className="flex items-center gap-3">
          <Shield className="text-sky-400" size={24} />
          <span className="text-[18px] font-bold tracking-[2px] text-sky-400 font-mono">RYAN_AI // PLATFORM</span>
        </div>
        {user ? (
          <div className="flex items-center gap-4">
            <span className="text-emerald-400 text-[11px] font-mono tracking-widest uppercase">
              ● {user.email} [{user.role}]
            </span>
            <button 
              onClick={() => { setUser(null); setIsAutonomous(false); }} 
              className="bg-red-900/40 hover:bg-red-900 text-red-200 border border-red-700/50 px-3 py-1.5 rounded text-xs font-bold transition-all"
            >
              LOGOUT
            </button>
          </div>
        ) : (
          <span className="text-red-400 text-[11px] font-mono tracking-widest uppercase">● Unauthenticated</span>
        )}
      </div>

      {/* ================= MAIN CONTENT AREA ================= */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {!user ? (
          /* ================= AUTHENTICATION GATEWAY ================= */
          <div className="w-full flex justify-center items-center relative z-10">
            <div className="w-[450px] bg-black/60 backdrop-blur-xl border border-gray-800 p-8 rounded-xl shadow-2xl">
              <h2 className="text-sky-400 text-lg font-bold tracking-widest text-center mt-0 mb-6 font-mono">SYSTEM ACCESS GATEWAY</h2>
              
              <div className="flex gap-2 mb-6 text-xs font-mono">
                <button onClick={() => setAuthMode('RYAN_DOMAIN')} className={`flex-1 py-2 rounded border ${authMode === 'RYAN_DOMAIN' ? 'bg-sky-600 border-sky-400 text-white' : 'bg-gray-900 border-gray-700 text-gray-400'}`}>@ryanai</button>
                <button onClick={() => setAuthMode('GMAIL')} className={`flex-1 py-2 rounded border ${authMode === 'GMAIL' ? 'bg-sky-600 border-sky-400 text-white' : 'bg-gray-900 border-gray-700 text-gray-400'}`}>Gmail / WA</button>
                <button onClick={() => setAuthMode('MASTER')} className={`flex-1 py-2 rounded border ${authMode === 'MASTER' ? 'bg-red-700 border-red-500 text-white' : 'bg-gray-900 border-gray-700 text-gray-400'}`}>Master Admin</button>
              </div>

              <form onSubmit={handleLogin} className="font-mono">
                <label className="text-[10px] text-gray-400 tracking-widest">IDENTIFIER / USERNAME</label>
                <input 
                  type="text" 
                  value={username} 
                  onChange={(e) => setUsername(e.target.value)} 
                  placeholder={authMode === 'MASTER' ? 'administrator' : 'username'} 
                  className="w-full p-2.5 bg-black/50 border border-gray-700 text-white rounded mt-1.5 mb-4 focus:border-sky-500 focus:outline-none"
                  required 
                />

                <label className="text-[10px] text-gray-400 tracking-widest">SECRET PASSWORD / KEY</label>
                <input 
                  type="password" 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  placeholder="••••••••••••" 
                  className="w-full p-2.5 bg-black/50 border border-gray-700 text-white rounded mt-1.5 mb-6 focus:border-sky-500 focus:outline-none"
                  required 
                />

                <button type="submit" className="w-full py-3 bg-sky-600 hover:bg-sky-500 text-white font-bold tracking-widest text-sm rounded transition-colors">
                  AUTHENTICATE
                </button>
              </form>

              {statusMsg && <div className="mt-4 text-xs text-red-400 text-center font-mono">{statusMsg}</div>}
            </div>
          </div>
        ) : (
          /* ================= INTEGRATED COCKPIT ================= */
          <div className="flex w-full h-full">
            
            {/* --- LEFT PANEL: DEV & PIPELINE --- */}
            <aside className="w-[300px] h-full border-r border-white/5 bg-slate-950/60 backdrop-blur-xl flex flex-col p-5 space-y-6 overflow-y-auto z-10 custom-scrollbar">
              
              <div className="space-y-4">
                <div className="flex items-center space-x-3 pb-2 border-b border-white/10">
                  <Wrench className={`w-5 h-5 ${theme.text}`} />
                  <h2 className="text-sm font-bold uppercase tracking-widest text-slate-100">Unrestricted Dev Tools</h2>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { name: 'Core Terminal', icon: Terminal },
                    { name: 'Sandbox Engine', icon: Cpu },
                    { name: 'Auto-Builder', icon: FolderGit2 },
                    { name: 'Full Rewrite', icon: Sparkles }
                  ].map((tool, idx) => (
                    <button 
                      key={idx}
                      onClick={() => triggerManualWork(tool.name)}
                      disabled={isAutonomous}
                      className={`flex flex-col items-center justify-center space-y-2 p-3 rounded-xl border border-white/5 bg-slate-900/50 hover:bg-slate-800 hover:border-${theme.color}-500/50 transition-all duration-300 ${isAutonomous ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <tool.icon className={`w-5 h-5 ${isAutonomous ? 'text-slate-500' : theme.text}`} />
                      <span className="text-[9px] font-mono tracking-wider uppercase text-center">{tool.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center space-x-3 pb-2 border-b border-white/10">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <h2 className="text-sm font-bold uppercase tracking-widest text-slate-100">Enterprise Pipeline</h2>
                </div>
                <div className="space-y-3">
                  <div className="relative overflow-hidden p-3 rounded-lg border border-emerald-500/20 bg-emerald-950/20">
                    <div className="absolute top-0 left-0 h-1 bg-emerald-500 w-full" />
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs font-semibold text-emerald-100">Phase I: Core Reasoning</span>
                      <CheckCircle className="w-4 h-4 text-emerald-500" />
                    </div>
                    <p className="text-[10px] text-emerald-400/70 font-mono">Status: 100% Complete | Ready</p>
                  </div>
                  
                  <div className="relative overflow-hidden p-3 rounded-lg border border-amber-500/20 bg-amber-950/20">
                    <div className="absolute top-0 left-0 h-1 bg-amber-500 w-[65%]" />
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs font-semibold text-amber-100">Phase II: Stress Test</span>
                      <Clock className="w-4 h-4 text-amber-500" />
                    </div>
                    <p className="text-[10px] text-amber-400/70 font-mono">Status: Active Testing | 65%</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4 flex-1">
                <div className="flex items-center space-x-3 pb-2 border-b border-white/10">
                  <Layers className="w-5 h-5 text-indigo-400" />
                  <h2 className="text-sm font-bold uppercase tracking-widest text-slate-100">Architecture Scaffolds</h2>
                </div>
                <div className="bg-black/40 p-4 rounded-xl border border-white/5 space-y-3 font-mono text-[10px]">
                  <div className="border-l-2 border-indigo-500 pl-2">
                    <p className="text-indigo-300 mb-1">NEW PROPOSAL: Agentic Swarm Mesh</p>
                    <p className="text-slate-500">Self-organizing nodes. Status: <span className="text-amber-400">Under Review</span></p>
                  </div>
                  <div className="border-l-2 border-slate-600 pl-2">
                    <p className="text-slate-300 mb-1">ACTIVE SCAFFOLD: /src/ui/telemetry.rs</p>
                    <p className="text-slate-500">Real-time metrics compiler updated.</p>
                  </div>
                </div>
              </div>
            </aside>

            {/* --- CENTER PANEL: AI CORE / WORKSPACE TOGGLE --- */}
            <main className="flex-1 flex flex-col items-center justify-between p-6 z-10 relative">
              
              {/* Center Top Control Bar */}
              <div className="w-full flex justify-between items-center max-w-4xl bg-black/40 backdrop-blur-md border border-white/10 p-2 rounded-2xl mb-6">
                
                {/* View Toggle */}
                <div className="flex items-center space-x-2 px-2">
                   <div className="flex space-x-1 bg-black/50 p-1 rounded-lg border border-white/5">
                     <button onClick={() => setActiveView('CORE')} className={`px-4 py-1.5 text-[10px] font-bold tracking-widest uppercase rounded transition-colors ${activeView === 'CORE' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'}`}>AI Engine</button>
                     <button onClick={() => setActiveView('WORKSPACE')} className={`px-4 py-1.5 text-[10px] font-bold tracking-widest uppercase rounded transition-colors ${activeView === 'WORKSPACE' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'}`}>Workspace</button>
                   </div>
                </div>

                {/* State Indicators & Toggle */}
                <div className="flex items-center space-x-4 pr-2">
                  <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-full animate-ping ${
                      aiState === 'coding' ? 'bg-cyan-400' : 
                      aiState === 'reasoning' ? 'bg-purple-400' : 
                      aiState === 'self-updating' ? 'bg-emerald-400' : 'bg-slate-400'
                    }`} />
                    <span className="text-[10px] font-mono tracking-widest text-slate-400 uppercase">SYS::{aiState}</span>
                  </div>

                  <button 
                    onClick={() => setIsAutonomous(!isAutonomous)}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-xl border transition-all duration-500 ${
                      isAutonomous 
                        ? 'bg-purple-900/30 border-purple-500 text-purple-300 shadow-[0_0_20px_rgba(168,85,247,0.3)]' 
                        : 'bg-slate-900 border-slate-700 hover:border-cyan-500 text-slate-400 hover:text-cyan-400'
                    }`}
                  >
                    <Power className={`w-4 h-4 ${isAutonomous ? 'animate-pulse' : ''}`} />
                    <span className="text-[10px] font-bold tracking-widest uppercase">
                      {isAutonomous ? 'Auto Active' : 'Enable Agent'}
                    </span>
                  </button>
                </div>
              </div>

              {/* DYNAMIC CENTER CONTENT */}
              <div className="flex-1 w-full max-w-4xl flex flex-col relative overflow-hidden">
                
                {activeView === 'CORE' ? (
                  <>
                    {/* Visual AI Core */}
                    <div className="flex-1 flex items-center justify-center relative w-full">
                      <div className={`absolute w-80 h-80 rounded-full border border-dashed transition-all duration-1000 ${theme.borderCore} ${
                        aiState === 'working' || aiState === 'coding' ? 'animate-[spin_4s_linear_infinite]' : 
                        aiState === 'reasoning' || aiState === 'self-updating' ? 'animate-[spin_2s_linear_infinite]' : 'animate-[spin_20s_linear_infinite]'
                      }`} />
                      <div className={`absolute w-[20rem] h-[20rem] rounded-full border transition-all duration-1000 ${theme.borderCore} opacity-30 ${
                        isAutonomous ? 'animate-ping duration-[3000ms]' : ''
                      }`} />

                      <div className={`relative w-56 h-56 rounded-[40px] bg-black/60 backdrop-blur-xl border-2 transition-all duration-700 flex flex-col items-center justify-center overflow-hidden ${theme.borderCore} ${theme.glow}`}>
                        {isAutonomous && (
                          <div className={`absolute top-0 left-0 w-full h-1 animate-[bounce_2s_infinite] ${
                            aiState === 'self-updating' ? 'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,1)]' : 'bg-purple-500 shadow-[0_0_15px_rgba(168,85,247,1)]'
                          }`} />
                        )}

                        <div className="flex space-x-10 mb-6 relative z-10">
                          {/* Eyes */}
                          {[0,1].map(eye => (
                            <div key={eye} className="relative w-10 h-6 flex justify-center items-center">
                              <div className={`w-full bg-white rounded-full transition-all duration-300 shadow-[0_0_15px_rgba(255,255,255,0.8)] ${
                                aiState === 'idle' ? 'h-2' : 
                                aiState === 'coding' ? 'h-6 animate-pulse' : 
                                aiState === 'reasoning' ? 'h-1 scale-x-125' :
                                aiState === 'self-updating' ? 'h-8 rounded-xl' : 'h-4'
                              }`} />
                              {isAutonomous && <div className="absolute w-2 h-2 bg-purple-900 rounded-full animate-ping" />}
                            </div>
                          ))}
                        </div>

                        {/* Mouth / Visualizer */}
                        <div className="flex items-end space-x-1 h-6">
                          {[...Array(7)].map((_, i) => (
                            <div 
                              key={i} 
                              className={`w-1.5 rounded-t-sm transition-all ${isAutonomous ? 'bg-purple-400' : 'bg-cyan-400'}`}
                              style={{
                                height: aiState === 'idle' ? '4px' : 
                                        aiState === 'coding' ? `${Math.max(8, Math.random() * 24)}px` : 
                                        aiState === 'reasoning' ? `${Math.max(4, Math.random() * 12)}px` : `${Math.max(6, Math.random() * 16)}px`,
                                animation: aiState !== 'idle' ? `pulse ${0.2 + (i * 0.15)}s infinite alternate` : 'none'
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Live Terminal */}
                    <div className="w-full h-40 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl flex flex-col overflow-hidden shadow-2xl shrink-0">
                      <div className={`px-4 py-2 flex items-center space-x-2 border-b border-white/10 ${isAutonomous ? 'bg-purple-900/20' : 'bg-cyan-900/10'}`}>
                        <Terminal className={`w-4 h-4 ${theme.text}`} />
                        <span className="text-[10px] font-mono tracking-widest text-slate-300">LIVE ACTION TERMINAL</span>
                        {isAutonomous && <span className="ml-auto flex items-center space-x-2 text-[10px] text-purple-400 font-mono animate-pulse"><Zap className="w-3 h-3"/> <span>AGENT TAKEOVER ACTIVE</span></span>}
                      </div>
                      <div className="flex-1 p-4 font-mono text-xs overflow-y-auto custom-scrollbar space-y-1.5">
                        {terminalLogs.map((log, idx) => (
                          <div key={idx} className={`${
                            log.startsWith('[AGENT]') ? 'text-purple-300' : 
                            log.startsWith('[USER]') ? 'text-cyan-300' : 'text-slate-400'
                          }`}>
                            <span className="opacity-50 mr-2">{new Date().toLocaleTimeString([], {hour12:false})}</span>{log}
                          </div>
                        ))}
                        <div ref={terminalEndRef} />
                      </div>
                    </div>
                  </>
                ) : (
                  /* Enterprise Workspace Area */
                  <div className="flex-1 flex flex-col bg-black/30 border border-white/5 rounded-2xl p-4 overflow-hidden shadow-2xl">
                    
                    {/* Toolbar */}
                    <div className="bg-black/50 border border-white/10 rounded-xl p-3 mb-4 shrink-0">
                      <div className="text-[10px] text-sky-400 font-bold mb-2 uppercase tracking-widest font-mono">Attached Ribbon Toolbar // Import & Export Engine</div>
                      <div className="flex gap-2 flex-wrap">
                        <button className="flex items-center gap-2 bg-slate-800 text-white border border-slate-600 px-3 py-1.5 rounded text-xs hover:bg-slate-700 transition-colors"><Upload size={14} /> Import Data</button>
                        <button className="flex items-center gap-2 bg-emerald-900 text-white border border-emerald-700 px-3 py-1.5 rounded text-xs hover:bg-emerald-800 transition-colors"><Download size={14} /> Export .docx</button>
                        <button className="flex items-center gap-2 bg-blue-900 text-white border border-blue-700 px-3 py-1.5 rounded text-xs hover:bg-blue-800 transition-colors"><FileSpreadsheet size={14} /> Export .xlsx</button>
                        <button className="flex items-center gap-2 bg-red-900 text-white border border-red-700 px-3 py-1.5 rounded text-xs hover:bg-red-800 transition-colors"><FileText size={14} /> Export .pdf</button>
                      </div>
                    </div>

                    {/* Editor Grid */}
                    <div className="flex-1 grid grid-cols-[250px_1fr] gap-4 overflow-hidden">
                      {/* Left: Google Sync */}
                      <div className="bg-black/40 border border-white/10 rounded-xl p-4 flex flex-col h-full overflow-y-auto custom-scrollbar">
                        <h4 className="text-sky-400 text-xs font-bold uppercase mb-4 tracking-widest font-mono">Google Account Sync</h4>
                        <div className="flex flex-col gap-2 font-mono">
                          <div className="flex items-center gap-3 bg-black/60 p-2.5 rounded border border-white/5 text-xs text-gray-300"><Mail size={16} className="text-red-500" /> <span>Gmail Stream</span></div>
                          <div className="flex items-center gap-3 bg-black/60 p-2.5 rounded border border-white/5 text-xs text-gray-300"><HardDrive size={16} className="text-blue-500" /> <span>Google Drive</span></div>
                          <div className="flex items-center gap-3 bg-black/60 p-2.5 rounded border border-white/5 text-xs text-gray-300"><Contact size={16} className="text-green-500" /> <span>Google Contacts</span></div>
                          <div className="flex items-center gap-3 bg-black/60 p-2.5 rounded border border-white/5 text-xs text-gray-300"><MessageSquare size={16} className="text-yellow-500" /> <span>Notes & Msgs</span></div>
                        </div>
                      </div>

                      {/* Right: Doc Editor */}
                      <div className="bg-black/40 border border-white/10 rounded-xl p-4 flex flex-col h-full overflow-hidden">
                        <input 
                          type="text" 
                          value={docTitle} 
                          onChange={(e) => setDocTitle(e.target.value)}
                          className="w-full bg-transparent border-none border-b border-white/10 text-sky-400 text-lg font-bold pb-2 mb-4 focus:outline-none focus:border-sky-400 font-mono"
                        />
                        <textarea 
                          value={docContent}
                          onChange={(e) => setDocContent(e.target.value)}
                          className="w-full flex-1 bg-black/60 border border-white/10 text-gray-200 p-4 rounded font-mono text-sm focus:outline-none focus:border-sky-500/50 resize-none custom-scrollbar"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </main>

            {/* --- RIGHT PANEL: OPS & MAINT --- */}
            <aside className="w-[300px] h-full border-l border-white/5 bg-slate-950/60 backdrop-blur-xl flex flex-col p-5 space-y-6 overflow-y-auto z-10 custom-scrollbar">
              
              <div className="space-y-4">
                <div className="flex items-center space-x-3 pb-2 border-b border-white/10">
                  <DollarSign className="w-5 h-5 text-amber-400" />
                  <h2 className="text-sm font-bold uppercase tracking-widest text-slate-100">Financials & Bills</h2>
                </div>
                <div className="space-y-3">
                  <div className="p-3 bg-black/40 border border-amber-500/20 rounded-xl flex justify-between items-center">
                    <div>
                      <p className="text-xs font-semibold text-slate-200">AWS Cloud Compute</p>
                      <p className="text-[10px] text-amber-500 flex items-center mt-1"><AlertTriangle className="w-3 h-3 mr-1"/> Due in 3 days</p>
                    </div>
                    <span className="text-amber-400 font-mono font-bold">$4,210.00</span>
                  </div>
                  <div className="p-3 bg-black/40 border border-white/5 rounded-xl flex justify-between items-center opacity-70">
                    <div>
                      <p className="text-xs font-semibold text-slate-200">OpenAI Enterprise API</p>
                      <p className="text-[10px] text-emerald-500 flex items-center mt-1"><CheckCircle className="w-3 h-3 mr-1"/> Auto-Paid</p>
                    </div>
                    <span className="text-slate-400 font-mono font-bold">$1,205.50</span>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center space-x-3 pb-2 border-b border-white/10">
                  <RefreshCw className="w-5 h-5 text-cyan-400" />
                  <h2 className="text-sm font-bold uppercase tracking-widest text-slate-100">Updates & Schedules</h2>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between p-2.5 bg-black/20 border border-white/5 rounded-lg">
                    <span className="text-slate-300">Kernel Patch v4.2.1</span>
                    <span className="text-emerald-500 font-mono text-[10px]">STABLE</span>
                  </div>
                  <div className="flex items-center justify-between p-2.5 bg-black/20 border border-white/5 rounded-lg">
                    <span className="text-slate-300">DB Index Optimization</span>
                    <span className="text-cyan-500 font-mono text-[10px]">02:00 AM</span>
                  </div>
                  <div className="flex items-center justify-between p-2.5 bg-black/20 border border-white/5 rounded-lg">
                    <span className="text-slate-300">SSL Cert Renewal</span>
                    <span className="text-amber-500 font-mono text-[10px]">PENDING</span>
                  </div>
                </div>
              </div>

              <div className="space-y-4 flex-1 flex flex-col">
                <div className="flex items-center space-x-3 pb-2 border-b border-white/10">
                  <ShieldCheck className={`w-5 h-5 ${isAutonomous ? 'text-purple-400' : 'text-emerald-400'}`} />
                  <h2 className="text-sm font-bold uppercase tracking-widest text-slate-100">Auto-Healing Logs</h2>
                </div>
                
                <div className={`flex-1 bg-black/60 border rounded-xl p-4 overflow-y-auto custom-scrollbar transition-colors duration-500 ${isAutonomous ? 'border-purple-500/30' : 'border-emerald-500/20'}`}>
                   <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-2">
                      <span className="text-[10px] font-mono tracking-widest text-slate-400 uppercase">Diagnostic Stream</span>
                      {isAutonomous && <span className="px-2 py-0.5 rounded text-[8px] font-bold bg-purple-900/50 text-purple-300 border border-purple-500/30">AGENT MANAGED</span>}
                   </div>
                   
                   <div className="space-y-3">
                     {maintenanceLogs.map((log, idx) => (
                       <div key={idx} className="flex items-start space-x-2 text-[10px] font-mono">
                         <Activity className={`w-3 h-3 mt-0.5 min-w-[12px] ${isAutonomous ? 'text-purple-500' : 'text-emerald-500'}`} />
                         <span className="text-slate-300">{log}</span>
                       </div>
                     ))}
                   </div>
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}