export default function OfflinePage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-8 text-center">
      <h1 className="text-xl font-semibold">Нет сети</h1>
      <p className="text-sm text-fg-muted">
        Эта страница ещё не была открыта офлайн. Карточки на повторение, открытые ранее, доступны из
        «Повторения» — оценки сохранятся и уйдут на сервер, когда сеть вернётся.
      </p>
    </div>
  );
}
