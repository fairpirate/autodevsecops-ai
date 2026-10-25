import { statePill } from "../store";

export function Pill({ value }: { value: string }) {
  const cls = statePill(value);
  return <span className={cls ? `pill ${cls}` : "pill"}>{value}</span>;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="muted" role="status">
      {label}
    </p>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="ghost" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ message }: { message: string }) {
  return <p className="muted">{message}</p>;
}
