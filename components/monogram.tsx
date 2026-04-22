type Props = { size?: number; className?: string };

export function Monogram({ size = 20, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      className={className}
      aria-hidden
    >
      <rect x="0.5" y="0.5" width="19" height="19" stroke="currentColor" />
      <text
        x="10"
        y="14"
        textAnchor="middle"
        fontFamily="var(--font-plex-mono)"
        fontSize="10"
        fontWeight="500"
        fill="currentColor"
        letterSpacing="0.04em"
      >
        CO
      </text>
    </svg>
  );
}
