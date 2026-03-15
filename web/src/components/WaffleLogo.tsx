export function WaffleLogo({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 36 36" fill="none"
      className={className}
      aria-hidden="true"
    >
      {[0, 1, 2, 3].map((row) =>
        [0, 1, 2, 3].map((col) => (
          <rect
            key={`${row}-${col}`}
            x={col * 9 + 1} y={row * 9 + 1}
            width="7" height="7" rx="1.5"
            fill="currentColor"
            opacity={1 - (row + col) * 0.06}
          />
        ))
      )}
    </svg>
  );
}
