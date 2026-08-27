import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Режим «эксперт»: выгрузка сырых данных.
 *
 * Смысл раздела не в удобстве, а в проверяемости. Приложение утверждает вещи
 * о вашем обучении — «прочность 72», «заметная переоценка себя»,
 * «интерливинг работает». Все они выведены из этих строк, и человек должен
 * иметь возможность пересчитать их сам, а не верить на слово.
 */
const DATASETS = [
  {
    id: 'responses',
    label: 'Ответы',
    description:
      'По одной строке на ответ: время, JOK, уверенность, правильность. Тексты ответов не выгружаются — для пересчёта метрик они не нужны.',
  },
  {
    id: 'nodes',
    label: 'Узлы',
    description:
      'Прочность, автоматизм, точность, медиана времени, даты освоения и время до автоматизма.',
  },
  {
    id: 'sessions',
    label: 'Сессии',
    description: 'Режим, перемешивание, длина набора, точность и длительность.',
  },
] as const;

export function ExportPanel({
  pathId,
  className,
}: {
  pathId?: string;
  className?: string;
}) {
  const suffix = pathId ? `&pathId=${pathId}` : '';

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle>Режим «эксперт»</CardTitle>
        <CardDescription>
          Сырые данные в CSV. Всё, что показано выше, выведено из этих строк — их можно
          пересчитать самостоятельно и не верить приложению на слово.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {DATASETS.map((dataset) => (
          <div key={dataset.id} className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-fg">{dataset.label}</p>
              <p className="text-xs text-fg-subtle">{dataset.description}</p>
            </div>
            <Button size="sm" variant="secondary" asChild>
              <a href={`/api/analytics/export?dataset=${dataset.id}${suffix}`} download>
                <Download aria-hidden />
                CSV
              </a>
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
