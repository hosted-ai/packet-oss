/**
 * GeometricHeader - decorative header pattern inspired by Zence design
 */

export function GeometricHeader() {
  return (
    <div className="h-16 w-full overflow-hidden relative">
      <svg viewBox="0 0 800 64" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
        {/* Background shapes */}
        <rect x="0" y="0" width="800" height="64" fill="#18181b" />

        {/* Coral/Pink circle */}
        <circle cx="120" cy="32" r="50" fill="#f43f5e" />

        {/* Teal rectangle */}
        <rect x="180" y="0" width="120" height="64" fill="#14b8a6" />

        {/* Yellow/Orange triangle */}
        <polygon points="320,0 400,64 320,64" fill="#f59e0b" />

        {/* Black circle */}
        <circle cx="450" cy="32" r="40" fill="#18181b" />

        {/* Dotted pattern area */}
        <rect x="500" y="0" width="150" height="64" fill="#f43f5e" />
        {[...Array(6)].map((_, row) =>
          [...Array(10)].map((_, col) => (
            <circle
              key={`dot-${row}-${col}`}
              cx={510 + col * 14}
              cy={8 + row * 10}
              r="2"
              fill="#18181b"
            />
          ))
        )}

        {/* Striped section */}
        <g>
          <rect x="650" y="0" width="80" height="64" fill="#f59e0b" />
          {[...Array(8)].map((_, i) => (
            <line
              key={`stripe-${i}`}
              x1={658 + i * 10}
              y1="0"
              x2={638 + i * 10}
              y2="64"
              stroke="#18181b"
              strokeWidth="3"
            />
          ))}
        </g>

        {/* Teal triangle at end */}
        <polygon points="730,0 800,0 800,64 760,64" fill="#14b8a6" />
      </svg>
    </div>
  );
}
