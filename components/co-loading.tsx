import type { CSSProperties } from "react";

const CUBE_FACES = ["front", "back", "right", "left", "top", "bottom"];

type CoLoadingProps = {
  label: string;
  detail?: string;
  size?: "sm" | "md";
};

export function CoLoading({ label, detail, size = "sm" }: CoLoadingProps) {
  const cubeSize = size === "md" ? 58 : 38;
  const style = {
    "--co-cube-wrap-size": `${cubeSize + 22}px`,
    "--co-cube-size": `${cubeSize}px`,
    "--co-cube-mark-size": `${Math.max(10, Math.round(cubeSize * 0.28))}px`,
  } as CSSProperties;

  return (
    <div className="co-loading" role="status" aria-live="polite">
      <div className="co-cube-wrap co-loading__cube" style={style} aria-hidden>
        <div className="co-cube-shadow" />
        <div className="co-cube">
          {CUBE_FACES.map((face) => (
            <div className={`co-cube__face co-cube__face--${face}`} key={face}>
              <span className="co-cube__mark">CO</span>
              <span className="co-cube__grid" />
            </div>
          ))}
        </div>
      </div>
      <div className="co-loading__copy">
        <span>
          {label}
          <span className="co-loading__dots" aria-hidden>
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </span>
        {detail ? <small>{detail}</small> : null}
      </div>
    </div>
  );
}
