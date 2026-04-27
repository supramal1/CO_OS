"use client";

// Wall-mounted notification board — the operator's inbox surface inside
// the pixel office. Anchored to the back wall in the gap between the
// rightmost station and the plant shelf (x≈776–852). Renders as part of
// the SVG scene so it shares the pixel-art rendering and reads as a
// fixture in the room rather than a chrome overlay.
//
// Three states:
//   - empty: a clean cork board (no envelopes), low-key fixture.
//   - 1+: stacked envelopes pinned to the board + a count badge in the
//     top-right corner.
//   - hover/click: cursor + onClick fire a host callback so the shell
//     can open the modal. The hit target covers the whole board.

// Bubble palette mirrored from character.tsx so the inbox kit reads as
// the same vocabulary as sprite envelopes. Duplicated rather than
// imported to keep character.tsx free of cross-component exports.
const COL_BUBBLE = "#D9D8C7";
const COL_BUBBLE_INK = "#0E0F12";

// Plant shelf starts at x=860; rightmost station ends near x=824 inside
// the station band. We park the board inside that 36-pixel gap, slightly
// raised so it lines up with the door-trim band of the wall.
const BOARD_X = 776;
const BOARD_Y = 30;
const BOARD_W = 76;
const BOARD_H = 64;

const COL_CORK = "#9A6F44";
const COL_CORK_DARK = "#6F4F2C";
const COL_FRAME = "#3A2A18";
const COL_FRAME_LIGHT = "#5A4226";
const COL_PIN = "#C7423A";
const COL_BADGE = "#E08D5C"; // forge — same alarm hue as failed/blocked
const COL_BADGE_INK = "#1A1003";

interface Props {
  count: number;
  onClick?: () => void;
}

export function InboxBoard({ count, onClick }: Props) {
  const interactive = Boolean(onClick) && count > 0;
  const label =
    count === 0
      ? "Approvals inbox: empty"
      : `Approvals inbox: ${count} pending — click to review`;

  return (
    <g
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={label}
      style={{
        cursor: interactive ? "pointer" : "default",
        outline: "none",
      }}
      onClick={interactive ? onClick : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick!();
              }
            }
          : undefined
      }
    >
      {/* Frame — wood-toned border so the board reads as mounted */}
      <rect
        x={BOARD_X - 2}
        y={BOARD_Y - 2}
        width={BOARD_W + 4}
        height={BOARD_H + 4}
        fill={COL_FRAME}
      />
      <rect
        x={BOARD_X - 1}
        y={BOARD_Y - 1}
        width={BOARD_W + 2}
        height={1}
        fill={COL_FRAME_LIGHT}
      />
      {/* Cork field */}
      <rect
        x={BOARD_X}
        y={BOARD_Y}
        width={BOARD_W}
        height={BOARD_H}
        fill={COL_CORK}
      />
      {/* Cork grain — sparse pixel-fleck texture so the board doesn't
          read as a flat brown rectangle. */}
      {CORK_FLECKS.map(([dx, dy], i) => (
        <rect
          key={i}
          x={BOARD_X + dx}
          y={BOARD_Y + dy}
          width={1}
          height={1}
          fill={COL_CORK_DARK}
        />
      ))}
      {/* Mounting pins — top corners */}
      <rect x={BOARD_X + 4} y={BOARD_Y + 4} width={2} height={2} fill={COL_PIN} />
      <rect
        x={BOARD_X + BOARD_W - 6}
        y={BOARD_Y + 4}
        width={2}
        height={2}
        fill={COL_PIN}
      />
      {/* Title plate — small dark strip at the top so the role of the
          board reads even when empty. */}
      <rect
        x={BOARD_X + 10}
        y={BOARD_Y + 8}
        width={BOARD_W - 20}
        height={9}
        fill="#1A1003"
      />
      <text
        x={BOARD_X + BOARD_W / 2}
        y={BOARD_Y + 15}
        textAnchor="middle"
        fontFamily="var(--font-plex-mono), ui-monospace, monospace"
        fontSize={6}
        fill={COL_BUBBLE}
        style={{ letterSpacing: "0.16em" }}
      >
        INBOX
      </text>

      {/* Empty state: no envelopes, no badge */}
      {count === 0 && (
        <text
          x={BOARD_X + BOARD_W / 2}
          y={BOARD_Y + BOARD_H / 2 + 8}
          textAnchor="middle"
          fontFamily="var(--font-plex-mono), ui-monospace, monospace"
          fontSize={6}
          fill={COL_BUBBLE_INK}
          opacity={0.55}
          style={{ letterSpacing: "0.16em" }}
        >
          ALL CLEAR
        </text>
      )}

      {/* 1+ envelopes — stack up to 3 with a slight offset so the pile
          reads as physical mail. count > 3 still renders 3 envelopes
          (the badge carries the actual number). */}
      {count > 0 && (
        <g className="co-pulse">
          {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
            <Envelope
              key={i}
              x={BOARD_X + 16 + i * 3}
              y={BOARD_Y + 24 + i * 2}
            />
          ))}
        </g>
      )}

      {/* Count badge — top-right corner, only when there are pending
          approvals. Forge red so it reads as an alarm at a glance. */}
      {count > 0 && (
        <g>
          <rect
            x={BOARD_X + BOARD_W - 14}
            y={BOARD_Y - 4}
            width={14}
            height={12}
            fill={COL_BADGE}
          />
          <rect
            x={BOARD_X + BOARD_W - 14}
            y={BOARD_Y - 5}
            width={14}
            height={1}
            fill={COL_BADGE}
            opacity={0.55}
          />
          <text
            x={BOARD_X + BOARD_W - 7}
            y={BOARD_Y + 4}
            textAnchor="middle"
            fontFamily="var(--font-plex-mono), ui-monospace, monospace"
            fontSize={count > 9 ? 7 : 8}
            fontWeight={700}
            fill={COL_BADGE_INK}
          >
            {count > 99 ? "99+" : count}
          </text>
        </g>
      )}
    </g>
  );
}

function Envelope({ x, y }: { x: number; y: number }) {
  const w = 28;
  const h = 18;
  return (
    <g>
      {/* Drop shadow */}
      <rect x={x + 1} y={y + 1} width={w} height={h} fill="#000" opacity={0.35} />
      {/* Body */}
      <rect x={x} y={y} width={w} height={h} fill={COL_BUBBLE} />
      {/* Flap chevron */}
      <rect x={x + 2} y={y + 1} width={w - 4} height={1} fill={COL_BUBBLE_INK} opacity={0.4} />
      <rect x={x + 4} y={y + 2} width={w - 8} height={1} fill={COL_BUBBLE_INK} opacity={0.55} />
      <rect x={x + 6} y={y + 3} width={w - 12} height={1} fill={COL_BUBBLE_INK} opacity={0.7} />
      <rect x={x + 9} y={y + 4} width={w - 18} height={1} fill={COL_BUBBLE_INK} opacity={0.85} />
      <rect x={x + 12} y={y + 5} width={w - 24} height={1} fill={COL_BUBBLE_INK} />
      {/* Forge stripe along bottom — kit-consistent with the sprite envelope */}
      <rect x={x} y={y + h - 2} width={w} height={2} fill={COL_BADGE} />
      {/* Pin in the centre top */}
      <rect x={x + w / 2 - 1} y={y - 2} width={2} height={3} fill={COL_PIN} />
    </g>
  );
}

// Hand-placed cork-grain flecks. Avoiding randomness so SSR/CSR markup
// matches and the texture stays stable across renders.
const CORK_FLECKS: ReadonlyArray<readonly [number, number]> = [
  [4, 22],
  [9, 28],
  [16, 36],
  [22, 26],
  [28, 32],
  [34, 24],
  [40, 36],
  [46, 28],
  [52, 30],
  [58, 36],
  [64, 26],
  [70, 32],
  [6, 44],
  [12, 50],
  [20, 56],
  [28, 50],
  [36, 56],
  [44, 50],
  [52, 56],
  [60, 50],
  [68, 56],
  [3, 36],
  [3, 50],
  [72, 44],
  [10, 18],
  [42, 18],
  [60, 18],
];
