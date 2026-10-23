import React from 'react';

interface HeaderProps {
  isShieldActive: boolean;
  onToggleShield: () => void;
}

export const Header: React.FC<HeaderProps> = ({ isShieldActive, onToggleShield }) => (
  <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass hud-border p-4 rounded-xl z-10">
    <div>
      <div className="flex items-center space-x-3">
        <div className="w-3 h-3 rounded-full bg-cyan-400 animate-pulse" />
        <h1 className="text-glow text-2xl md:text-3xl">RYAN-OS // SENTINEL HUD</h1>
      </div>
      <p className="text-xs font-mono text-cyan-400/70 mt-1">
        NODE_ID: 0x8F9A2B4C • LOCATION: JHB_SERVER_CLUSTER_01
      </p>
    </div>

    <div className="flex items-center space-x-3">
      <span className={isShieldActive ? 'badge badge-success' : 'badge badge-error'}>
        {isShieldActive ? 'FIREWALL PROTECTED' : 'FIREWALL DISABLED'}
      </span>
      <button onClick={onToggleShield} className="btn-primary">
        {isShieldActive ? 'Disable Sentinel' : 'Enable Sentinel'}
      </button>
    </div>
  </header>
);