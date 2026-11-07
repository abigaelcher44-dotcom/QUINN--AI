interface QuinnLogoProps {
  size?: number;
  animated?: boolean;
  className?: string;
}

const QuinnLogo = ({ size = 40, animated = true, className = '' }: QuinnLogoProps) => {
  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      {animated && (
        <span className="absolute inset-0 rounded-full border border-violet-400/50 animate-ping" />
      )}
      <svg viewBox="0 0 128 128" width={size} height={size} className="relative">
        <defs>
          <linearGradient id="quinnGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#c4b5fd" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
          <radialGradient id="quinnGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#c4b5fd" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="64" cy="64" r="58" fill="url(#quinnGlow)" opacity="0.35" />
        <g className={animated ? 'origin-center [animation:spin_18s_linear_infinite]' : ''} style={{ transformOrigin: '64px 64px' }}>
          <path d="M 64 12 A 52 52 0 1 1 22 88" fill="none" stroke="url(#quinnGrad)" strokeWidth="4" strokeLinecap="round" />
          <path d="M 106 40 A 52 52 0 0 1 92 108" fill="none" stroke="url(#quinnGrad)" strokeWidth="4" strokeLinecap="round" />
        </g>
        <polygon points="64,28 94,46 94,82 64,100 34,82 34,46" fill="none" stroke="#c4b5fd" strokeWidth="2" opacity="0.5" />
        <g stroke="url(#quinnGrad)" strokeWidth="6" strokeLinecap="round" fill="none">
          <line x1="46" y1="44" x2="46" y2="84" />
          <line x1="46" y1="44" x2="78" y2="44" />
          <line x1="46" y1="64" x2="72" y2="64" />
          <line x1="46" y1="84" x2="78" y2="84" />
        </g>
        <circle cx="64" cy="64" r="3" fill="#c4b5fd" />
      </svg>
    </div>
  );
};

export default QuinnLogo;
