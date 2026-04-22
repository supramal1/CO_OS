const MARK_LEN = 24;
const MARK_INSET = 28;

function Corner({ style }: { style: React.CSSProperties }) {
  return (
    <div
      style={{
        position: "absolute",
        width: MARK_LEN,
        height: MARK_LEN,
        color: "var(--ink-faint)",
        ...style,
      }}
      aria-hidden
    >
      <div
        style={{
          position: "absolute",
          background: "currentColor",
          width: 1,
          height: MARK_LEN,
          top: 0,
          left: 0,
        }}
      />
      <div
        style={{
          position: "absolute",
          background: "currentColor",
          height: 1,
          width: MARK_LEN,
          top: 0,
          left: 0,
        }}
      />
    </div>
  );
}

export function CropMarks() {
  return (
    <>
      <Corner style={{ top: MARK_INSET, left: MARK_INSET }} />
      <Corner
        style={{ top: MARK_INSET, right: MARK_INSET, transform: "scaleX(-1)" }}
      />
      <Corner
        style={{ bottom: MARK_INSET, left: MARK_INSET, transform: "scaleY(-1)" }}
      />
      <Corner
        style={{ bottom: MARK_INSET, right: MARK_INSET, transform: "scale(-1,-1)" }}
      />
    </>
  );
}
