import { ScienceHint } from '@/components/science-hint';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ReviewPage() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        Очередь повторений
        <ScienceHint citation="fsrs" />
      </h1>
      <p className="mt-1 text-sm text-fg-muted">
        Интервалы считает FSRS: повторение назначается на момент, когда вероятность
        вспомнить падает до целевого уровня.
      </p>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Раздел появится на этапе 3</CardTitle>
          <CardDescription>
            Сейчас готов фундамент: карта знаний и структура данных. Очередь включится
            вместе с движком тестирования и интеграцией ts-fsrs.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-fg-subtle">
          Состояние карточек уже хранится в таблицах `fsrs_cards` и `review_logs`.
        </CardContent>
      </Card>
    </div>
  );
}
