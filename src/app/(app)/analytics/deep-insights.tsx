import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { DeepInsights } from '@/lib/db/queries/insights';
import { MIN_CELL_ATTEMPTS, calendarIntensity } from '@/lib/services/analytics/insights';
import { cn } from '@/lib/utils';

/**
 * Развёрнутая аналитика: тренд, тепловая карта, радар, календарь.
 *
 * Серверный компонент и чистый SVG — без графической библиотеки. Причина
 * прикладная: четыре графика с фиксированной формой проще нарисовать
 * напрямую, чем описать чужим API, а весь recharts ради них тянуть в бандл
 * незачем. Плюс SVG даёт полный контроль над доступностью, а её здесь надо
 * много: график без текстовой альтернативы для screen reader — пустое место.
 */

const BLOOM_LABEL: Record<string, string> = {
  recall: 'вспомнить',
  understand: 'понять',
  apply: 'применить',
  analyze: 'анализ',
  evaluate: 'оценка',
  create: 'создание',
};

const TYPE_LABEL: Record<string, string> = {
  mcq: 'выбор',
  multi_select: 'мультивыбор',
  cloze: 'пропуск',
  short_answer: 'короткий',
  free_recall: 'свободный',
  ordering: 'порядок',
  matching: 'соответствие',
  code: 'код',
  case_study: 'кейс',
  estimation: 'оценка',
};

export function DeepInsightsView({ data }: { data: DeepInsights }) {
  return (
    <div className="flex flex-col gap-4">
      <StrengthTrend trend={data.trend} />
      <BloomHeatmap cells={data.heatmap} />
      <CognitiveRadarChart axes={data.radar} />
      <PracticeCalendar days={data.calendar} periodDays={data.calendarDays} />
    </div>
  );
}

/** Тренд прочности. Разрывы в линии — дни без занятий, и это честно. */
function StrengthTrend({ trend }: { trend: DeepInsights['trend'] }) {
  if (trend.length < 2) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Тренд прочности</CardTitle>
          <CardDescription>
            Появится, когда наберётся хотя бы два дня с практикой. Линия по одной точке
            показывала бы направление, которого не измеряли.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const width = 640;
  const height = 140;
  const max = 100;
  const step = trend.length > 1 ? width / (trend.length - 1) : width;

  const points = trend
    .map((point, index) => `${index * step},${height - (point.value / max) * height}`)
    .join(' ');

  const first = trend[0]!;
  const last = trend[trend.length - 1]!;
  const delta = last.value - first.value;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Тренд прочности</CardTitle>
        <CardDescription>
          Средняя прочность узлов по дням с практикой. За период{' '}
          {delta >= 0 ? `выросла на ${delta}` : `снизилась на ${Math.abs(delta)}`} пунктов
          ({first.value} → {last.value}). Дни без занятий в линию не достраиваются.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-32 w-full"
          role="img"
          aria-label={`Тренд прочности: с ${first.value} до ${last.value} за ${trend.length} дней с практикой`}
        >
          <polyline
            points={points}
            fill="none"
            stroke="var(--color-status-mastered)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {trend.map((point, index) => (
            <circle
              key={point.date}
              cx={index * step}
              cy={height - (point.value / max) * height}
              r={2.5}
              fill="var(--color-status-mastered)"
            >
              <title>
                {point.date}: {point.value} (узлов: {point.samples})
              </title>
            </circle>
          ))}
        </svg>
      </CardContent>
    </Card>
  );
}

/**
 * Тепловая карта «Блум × тип задания».
 *
 * Отвечает на вопрос «где практики было мало», а не «где я плох». Клетка с
 * малым числом попыток остаётся серой: точность по трём ответам выглядит как
 * измерение, но им не является.
 */
function BloomHeatmap({ cells }: { cells: DeepInsights['heatmap'] }) {
  if (cells.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Блум × тип задания</CardTitle>
          <CardDescription>Появится после первых ответов.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const levels = [...new Set(cells.map((cell) => cell.level))];
  const types = [...new Set(cells.map((cell) => cell.type))];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Блум × тип задания</CardTitle>
        <CardDescription>
          Где практики было много, а где почти не было. Серые клетки — меньше{' '}
          {MIN_CELL_ATTEMPTS} попыток: точность по ним не считается, потому что такое число
          выглядит как измерение, не будучи им.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[28rem] border-separate border-spacing-1 text-xs">
          <caption className="sr-only">
            Точность по уровням таксономии Блума и типам заданий
          </caption>
          <thead>
            <tr>
              <th scope="col" className="text-left font-normal text-fg-subtle">
                уровень
              </th>
              {types.map((type) => (
                <th key={type} scope="col" className="font-normal text-fg-subtle">
                  {TYPE_LABEL[type] ?? type}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {levels.map((level) => (
              <tr key={level}>
                <th scope="row" className="text-left font-normal text-fg-muted">
                  {BLOOM_LABEL[level] ?? level}
                </th>
                {types.map((type) => {
                  const cell = cells.find((c) => c.level === level && c.type === type);
                  return (
                    <td key={type} className="p-0">
                      <HeatCellView cell={cell} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function HeatCellView({ cell }: { cell: DeepInsights['heatmap'][number] | undefined }) {
  if (!cell) {
    return (
      <div
        className="flex h-8 items-center justify-center rounded border border-border text-[10px] text-fg-subtle"
        title="Практики не было"
      >
        —
      </div>
    );
  }

  // Цвет — от янтарного (низкая точность) к зелёному, теми же токенами, что
  // и статусы узлов: пробел янтарный, а не красный, и здесь тоже.
  const color =
    cell.accuracy === null
      ? 'var(--color-bg-hover)'
      : cell.accuracy >= 0.8
        ? 'var(--color-status-mastered)'
        : cell.accuracy >= 0.5
          ? 'var(--color-status-in-progress)'
          : 'var(--color-status-has-gaps)';

  return (
    <div
      className="flex h-8 items-center justify-center rounded text-[10px] font-medium"
      style={{
        backgroundColor: `color-mix(in oklch, ${color} ${cell.accuracy === null ? 40 : 55}%, transparent)`,
        color: cell.accuracy === null ? 'var(--color-fg-subtle)' : 'var(--color-fg)',
      }}
      title={`Попыток: ${cell.attempts}${
        cell.accuracy === null
          ? `; точность не считается (меньше ${MIN_CELL_ATTEMPTS} попыток)`
          : `; точность ${Math.round(cell.accuracy * 100)}%`
      }`}
    >
      {/* Число в клетке, а не только цвет: смысл не должен зависеть от
          различения оттенков. */}
      {cell.accuracy === null ? `${cell.attempts}·` : `${Math.round(cell.accuracy * 100)}%`}
    </div>
  );
}

/**
 * Радар когнитивного портрета.
 *
 * Идеального многоугольника здесь не существует, и это сказано прямо: высокая
 * скорость при низкой калибровке — не хуже обратного, это разные профили.
 */
function CognitiveRadarChart({ axes }: { axes: DeepInsights['radar'] }) {
  const size = 220;
  const center = size / 2;
  const radius = center - 34;
  const measured = axes.filter((axis) => axis.value !== null);

  const point = (index: number, value: number) => {
    const angle = (Math.PI * 2 * index) / axes.length - Math.PI / 2;
    return [center + Math.cos(angle) * radius * value, center + Math.sin(angle) * radius * value];
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Портрет</CardTitle>
        <CardDescription>
          Шесть измеренных величин в одной шкале. «Идеального» многоугольника не существует:
          высокая скорость при слабой калибровке — не хуже обратного, это разные профили. Ось
          без данных не рисуется — ноль на радаре читался бы как «плохо».
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="size-56 shrink-0"
          role="img"
          aria-label={`Портрет: ${measured
            .map((axis) => `${axis.label} ${Math.round((axis.value as number) * 100)}%`)
            .join(', ')}`}
        >
          {[0.25, 0.5, 0.75, 1].map((ring) => (
            <circle
              key={ring}
              cx={center}
              cy={center}
              r={radius * ring}
              fill="none"
              stroke="var(--color-border)"
              strokeWidth={0.5}
            />
          ))}

          {measured.length >= 3 ? (
            <polygon
              points={axes
                .map((axis, index) =>
                  axis.value === null ? null : point(index, axis.value).join(','),
                )
                .filter(Boolean)
                .join(' ')}
              fill="color-mix(in oklch, var(--color-interactive) 22%, transparent)"
              stroke="var(--color-interactive)"
              strokeWidth={1.5}
            />
          ) : null}

          {axes.map((axis, index) => {
            const [x, y] = point(index, 1);
            return (
              <line
                key={axis.key}
                x1={center}
                y1={center}
                x2={x}
                y2={y}
                stroke="var(--color-border)"
                strokeWidth={0.5}
                // Ось без данных — пунктир: видно, что она есть, но не измерена.
                strokeDasharray={axis.value === null ? '3 3' : undefined}
              />
            );
          })}
        </svg>

        <ul className="flex flex-1 flex-col gap-1.5 text-xs">
          {axes.map((axis) => (
            <li key={axis.key} className="flex items-baseline justify-between gap-3">
              <span className="text-fg-muted" title={axis.hint}>
                {axis.label}
              </span>
              <span className={cn('tabular-nums', axis.value === null ? 'text-fg-subtle' : 'text-fg')}>
                {axis.value === null ? 'не измерено' : `${Math.round(axis.value * 100)}%`}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Календарь занятий.
 *
 * Плотность практики, а не стрик. Разница не косметическая: стрик наказывает
 * за пропуск и заставляет заходить ради непрерывности, календарь просто
 * показывает, как было. Поэтому здесь нет ни серий, ни «рекорда», ни красного
 * цвета для пропущенных дней.
 */
function PracticeCalendar({
  days,
  periodDays,
}: {
  days: DeepInsights['calendar'];
  periodDays: number;
}) {
  const weeks: DeepInsights['calendar'][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const active = days.filter((day) => day.sessions > 0).length;
  const totalMinutes = days.reduce((sum, day) => sum + day.minutes, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Календарь занятий</CardTitle>
        <CardDescription>
          Плотность практики за {periodDays} дней: занятий было в {active} днях, всего{' '}
          {Math.round(totalMinutes / 60)} ч. Серий и рекордов здесь нет намеренно — они
          заставляют заходить ради непрерывности, а не ради обучения.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <div className="flex gap-1" role="img" aria-label={`Занятия за ${periodDays} дней: активных дней ${active}, всего ${Math.round(totalMinutes / 60)} часов`}>
          {weeks.map((week, index) => (
            <div key={index} className="flex flex-col gap-1">
              {week.map((day) => (
                <span
                  key={day.date}
                  className="size-3 rounded-[3px]"
                  style={{
                    backgroundColor:
                      calendarIntensity(day, days) === 0
                        ? 'var(--color-bg-hover)'
                        : `color-mix(in oklch, var(--color-status-mastered) ${calendarIntensity(day, days) * 22}%, transparent)`,
                  }}
                  title={
                    day.sessions === 0
                      ? `${day.date}: без практики`
                      : `${day.date}: сессий ${day.sessions}, заданий ${day.responses}, ${day.minutes} мин`
                  }
                />
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
