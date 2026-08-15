'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ReflectionListItem } from '@/lib/db/queries/reflections';

import { ReflectionJournal } from '../review/reflection-journal';

const TYPE_LABEL: Record<string, string> = {
  pre_flight: 'перед началом',
  post_module: 'после модуля',
  error_analysis: 'разбор ошибок',
  weekly: 'еженедельная',
  project_defense: 'защита проекта',
};

export function ReflectView({
  initialHistory,
  initialNodeId,
}: {
  initialHistory: ReflectionListItem[];
  initialNodeId: string | null;
}) {
  const router = useRouter();
  const [nodeId, setNodeId] = useState(initialNodeId);

  if (nodeId) {
    return (
      <ReflectionJournal
        nodeId={nodeId}
        sessionId={null}
        onDone={() => {
          setNodeId(null);
          router.push('/reflect');
          router.refresh();
        }}
      />
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-3">
      {initialHistory.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Записей пока нет</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-fg-muted">
            Дневник открывается автоматически, когда узел близок к статусу «освоен» —
            после завершения сессии практики.
          </CardContent>
        </Card>
      ) : (
        initialHistory.map((r) => (
          <Card key={r.id}>
            <CardHeader>
              <div className="flex items-center justify-between gap-2 text-xs text-fg-subtle">
                <span>
                  {r.nodeTitle ?? 'Без узла'} · {TYPE_LABEL[r.type] ?? r.type}
                </span>
                <span>{new Date(r.createdAt).toLocaleDateString('ru-RU')}</span>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p className="text-fg-muted">{r.body}</p>
              {r.depthScore != null ? (
                <p className="text-xs text-fg-subtle">
                  Глубина рефлексии: {Math.round(r.depthScore * 100)}%
                  {r.calibrationDelta != null
                    ? ` · разрыв калибровки ${r.calibrationDelta >= 0 ? '+' : ''}${Math.round(r.calibrationDelta * 100)}%`
                    : ''}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
