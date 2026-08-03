import { ScienceHint } from '@/components/science-hint';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ReflectPage() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        Дневник обучения
        <ScienceHint citation="metacognition" />
      </h1>
      <p className="mt-1 text-sm text-fg-muted">
        Узел не переходит в статус «освоен» без записи в дневнике: отслеживание
        собственного понимания — отдельный навык, а не формальность.
      </p>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Раздел появится на этапе 4</CardTitle>
          <CardDescription>
            Вопросы для дневника формирует агент MetacognitiveCoach по фактическим
            данным сессии: где расходились уверенность и точность.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-fg-subtle">
          Таблица `reflections` уже создана, поле `calibration_delta` рассчитывается
          из уверенности, собранной до показа результата.
        </CardContent>
      </Card>
    </div>
  );
}
