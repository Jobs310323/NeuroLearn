export default function LoadingPath() {
  return (
    <div className="flex h-dvh flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="h-5 w-48 animate-pulse rounded bg-bg-elevated" />
        <div className="h-8 w-32 animate-pulse rounded bg-bg-elevated" />
      </div>
      <div className="flex-1 animate-pulse bg-bg-elevated/30" />
    </div>
  );
}
