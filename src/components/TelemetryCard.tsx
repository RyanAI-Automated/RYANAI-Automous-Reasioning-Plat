import React from 'react';

interface TelemetryCardProps {
  header: string;
  title: string;
  value: string | number;
  progress?: number;
  progressColor?: string;
  footerContent?: React.ReactNode;
  activeBorder?: boolean;
}

export const TelemetryCard: React.FC<TelemetryCardProps> = ({
  header,
  title,
  value,
  progress,
  progressColor = 'bg-cyan-400',
  footerContent,
  activeBorder = false,
}) => (
  <div className={`card ${activeBorder ? 'hud-border-active' : ''} flex flex-col justify-between`}>
    <div>
      <span className="card-header">{header}</span>
      <h2 className="card-title mt-1">{title}</h2>
      <div className="text-3xl font-mono text-cyan-300 font-bold mt-2">{value}</div>
    </div>

    {progress !== undefined && (
      <div className="w-full bg-slate-950/80 rounded-full h-2.5 mt-4 overflow-hidden border border-cyan-500/20">
        <div
          className={`${progressColor} h-2.5 rounded-full transition-all duration-500 box-glow`}
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>
    )}

    {footerContent && <div className="mt-4">{footerContent}</div>}
  </div>
);