import { redirect } from 'next/navigation';

import { requireUserId } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { notes } from '@/lib/db/schema';
import { parseShare } from '@/lib/notes/share-target';

export const metadata = { title: 'Записать — NeuroLearn' };

/**
 * PWA share target: «Поделиться» из любого приложения системы создаёт
 * заметку.
 *
 * Заметка создаётся сразу, без экрана подтверждения, и человек попадает
 * прямо в неё на правку. Подтверждение здесь было бы лишним шагом ровно в
 * тот момент, ради которого захват и существует: мысль уже в руках, её надо
 * положить, а не согласовать.
 *
 * Метод GET, а не POST: POST-вариант share target требует обработки
 * multipart в service worker, и это оправдано только для файлов. Текст и
 * ссылка помещаются в query — см. `public/manifest.json`.
 */
export default async function ShareTargetPage({
  searchParams,
}: {
  searchParams: Promise<{ title?: string; text?: string; url?: string }>;
}) {
  const userId = await requireUserId();
  const params = await searchParams;

  const draft = parseShare(params);

  // Пустой шар (человек открыл ярлык «Записать мысль» без содержимого) —
  // просто открываем тетрадь, а не создаём пустую заметку.
  if (!draft.contentMd && !draft.title) redirect('/notes');

  const [created] = await db
    .insert(notes)
    .values({
      userId,
      type: draft.type,
      title: draft.title,
      contentMd: draft.contentMd,
      colorLabel: draft.type === 'quote' ? 'source' : 'neutral',
    })
    .returning({ id: notes.id });

  redirect(created ? `/notes?note=${created.id}` : '/notes');
}
