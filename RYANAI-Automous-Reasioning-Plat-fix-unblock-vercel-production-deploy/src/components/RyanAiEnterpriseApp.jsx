import React, { useState } from 'react';
import { 
  FileText, Table, FileSpreadsheet, Download, Upload, LogIn, Shield, 
  RefreshCw, Mail, HardDrive, Contact, MessageSquare, CheckCircle, Lock 
} from 'lucide-react';

export default function RyanAiEnterpriseApp() {
  const [activeTab, setActiveTab] = useState('ribbon');
  const [authMode, setAuthMode] = useState('RYAN_DOMAIN'); // RYAN_DOMAIN, GMAIL, MASTER
  const [user, setUser] = useState(null);
  
  // Ribbon Document Content
  const [docTitle, setDocTitle] = useState('System_Architecture_Doc');
  const [docContent, setDocContent] = useState('RyanAI Autonomous Agent Deployment Framework...');

  // Login Form States
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  const handleLogin = (e) => {
    e.preventDefault();
    if (authMode === 'MASTER') {
      if (username === 'administrator' && password) {
        setUser({ username: 'administrator', role: 'ADMIN', email: 'administrator@ryanai.dev' });
        setStatusMsg('✓ Master Admin Access Granted.');
      } else {
        setStatusMsg('❌ Master Credentials Rejected.');
      }
    } else {
      setUser({ username, role: 'USER', email: `${username}@ryanai.dev` });
      setStatusMsg(`✓ Logged in as ${username}@ryanai.dev`);
    }
  };

  return (
    <div style={{ backgroundColor: '#030712', color: '#f3f4f6', minHeight: '100vh', fontFamily: 'Courier New, monospace' }}>
      
      {/* HEADER NAVBAR */}
      <div style={{ backgroundColor: '#0b0f19', borderBottom: '1px solid #1f2937', padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Shield style={{ color: '#38bdf8' }} size={28} />
          <span style={{ fontSize: '20px', fontWeight: 'bold', letterSpacing: '2px', color: '#38bdf8' }}>RYAN_AI // PLATFORM</span>
        </div>
        
        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ color: '#4ade80', fontSize: '13px' }}>● {user.email} [{user.role}]</span>
            <button onClick={() => setUser(null)} style={{ background: '#991b1b', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>Logout</button>
          </div>
        ) : (
          <span style={{ color: '#f87171', fontSize: '13px' }}>● Unauthenticated</span>
        )}
      </div>

      {!user ? (
        /* AUTHENTICATION CENTER */
        <div style={{ maxWidth: '450px', margin: '60px auto', background: '#0b0f19', border: '1px solid #1f2937', padding: '32px', borderRadius: '8px' }}>
          <h2 style={{ color: '#38bdf8', marginTop: 0, textAlign: 'center' }}>SYSTEM ACCESS GATEWAY</h2>
          
          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
            <button onClick={() => setAuthMode('RYAN_DOMAIN')} style={{ flex: 1, padding: '8px', background: authMode === 'RYAN_DOMAIN' ? '#0284c7' : '#1e293b', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>@ryanai</button>
            <button onClick={() => setAuthMode('GMAIL')} style={{ flex: 1, padding: '8px', background: authMode === 'GMAIL' ? '#0284c7' : '#1e293b', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Gmail / WA</button>
            <button onClick={() => setAuthMode('MASTER')} style={{ flex: 1, padding: '8px', background: authMode === 'MASTER' ? '#dc2626' : '#1e293b', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Master Admin</button>
          </div>

          <form onSubmit={handleLogin}>
            <label style={{ fontSize: '12px', color: '#9ca3af' }}>IDENTIFIER / USERNAME</label>
            <input 
              type="text" 
              value={username} 
              onChange={(e) => setUsername(e.target.value)} 
              placeholder={authMode === 'MASTER' ? 'administrator' : 'username'} 
              style={{ width: '100%', padding: '10px', background: '#030712', border: '1px solid #374151', color: '#fff', borderRadius: '4px', margin: '6px 0 16px 0' }}
              required 
            />

            <label style={{ fontSize: '12px', color: '#9ca3af' }}>SECRET PASSWORD / KEY</label>
            <input 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              placeholder="••••••••••••" 
              style={{ width: '100%', padding: '10px', background: '#030712', border: '1px solid #374151', color: '#fff', borderRadius: '4px', margin: '6px 0 20px 0' }}
              required 
            />

            <button type="submit" style={{ width: '100%', padding: '12px', background: '#0284c7', color: '#fff', border: 'none', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer' }}>AUTHENTICATE</button>
          </form>

          {statusMsg && <div style={{ marginTop: '16px', fontSize: '12px', color: statusMsg.includes('✓') ? '#4ade80' : '#f87171', textAlign: 'center' }}>{statusMsg}</div>}
        </div>
      ) : (
        /* WORKSPACE INTERFACE */
        <div style={{ padding: '24px' }}>
          
          {/* ATTACHED DYNAMIC RIBBON TOOLBAR */}
          <div style={{ background: '#0b0f19', border: '1px solid #1f2937', borderRadius: '6px', padding: '12px', marginBottom: '20px' }}>
            <div style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 'bold', marginBottom: '8px', textTransform: 'uppercase' }}>Attached Ribbon Toolbar // Import & Export Engine</div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#1e293b', color: '#fff', border: '1px solid #374151', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer' }}>
                <Upload size={16} /> Import (.docx, .xlsx, .pdf)
              </button>
              <button style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#065f46', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer' }}>
                <Download size={16} /> Export Word (.docx)
              </button>
              <button style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#1e3a8a', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer' }}>
                <FileSpreadsheet size={16} /> Export Excel (.xlsx)
              </button>
              <button style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#991b1b', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer' }}>
                <FileText size={16} /> Export PDF (.pdf)
              </button>
            </div>
          </div>

          {/* GOOGLE INTEGRATION HUB & WORKSPACE */}
          <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '20px' }}>
            
            {/* GOOGLE ECOSYSTEM SIDEBAR */}
            <div style={{ background: '#0b0f19', border: '1px solid #1f2937', borderRadius: '6px', padding: '16px' }}>
              <h4 style={{ color: '#38bdf8', marginTop: 0 }}>Google Account Sync</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#030712', padding: '10px', borderRadius: '4px', border: '1px solid #1f2937' }}>
                  <Mail size={18} color="#ea4335" /> <span>Gmail Stream</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#030712', padding: '10px', borderRadius: '4px', border: '1px solid #1f2937' }}>
                  <HardDrive size={18} color="#4285f4" /> <span>Google Drive</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#030712', padding: '10px', borderRadius: '4px', border: '1px solid #1f2937' }}>
                  <Contact size={18} color="#34a853" /> <span>Google Contacts</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#030712', padding: '10px', borderRadius: '4px', border: '1px solid #1f2937' }}>
                  <MessageSquare size={18} color="#fbbc05" /> <span>Notes & Messages</span>
                </div>
              </div>
            </div>

            {/* EDITOR WORKSPACE CANVAS */}
            <div style={{ background: '#0b0f19', border: '1px solid #1f2937', borderRadius: '6px', padding: '20px' }}>
              <input 
                type="text" 
                value={docTitle} 
                onChange={(e) => setDocTitle(e.target.value)}
                style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid #374151', color: '#38bdf8', fontSize: '18px', fontWeight: 'bold', padding: '8px 0', marginBottom: '16px' }}
              />
              <textarea 
                value={docContent}
                onChange={(e) => setDocContent(e.target.value)}
                rows={16}
                style={{ width: '100%', background: '#030712', border: '1px solid #1f2937', color: '#f3f4f6', padding: '16px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '14px', lineHeight: '1.6' }}
              />
            </div>

          </div>
        </div>
      )}
    </div>
  );
}