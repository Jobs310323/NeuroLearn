import { BrainCircuit } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { auth } from '@/lib/auth';

export const metadata = {
  title: 'NeuroLearn — практика до автоматизма',
  description:
    'Обучение через практику до автоматизма, а не через чтение теории. Честная модель ученика, ноль геймификации.',
};

/**
 * Лендинг.
 *
 * Вошедшего человека сюда пускать незачем — он уже всё решил, и страница
 * «почему стоит попробовать» для него шум. Поэтому редирект остаётся первым
 * действием, а страница показывается только тем, кто ещё не вошёл.
 *
 * Текст построен на том, что в продукте неудобно, а не на том, что приятно.
 * Причина не в скромности: приложение действительно требует усилия, и человек,
 * пришедший за приятным, уйдёт на второй сессии, потратив своё и наше время.
 * Честное обещание отсеивает раньше и дешевле.
 */
export default async function RootPage() {
  const session = await auth();
  if (session?.user?.id) redirect('/dashboard');

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-10 px-6 py-16">
      <header className="flex flex-col gap-4">
        <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <BrainCircuit className="size-4 text-accent" aria-hidden />
          NeuroLearn
        </span>

        <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          Практика до автоматизма — вместо ощущения, что вы что-то поняли
        </h1>

        <p className="max-w-2xl text-base leading-relaxed text-fg-muted">
          Приложение строит под вашу цель дерево знаний и гоняет вас по нему до тех пор,
          пока ответ не станет быстрым и верным. Оно намеренно неудобно: тест идёт до
          теории, темы перемешиваются, результат сессии бывает хуже, чем при спокойном
          чтении. Через неделю разница обратная — ровно на это всё и рассчитано.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/login">Начать</Link>
          </Button>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <Feature title="Ноль геймификации">
          Ни очков, ни уровней, ни серий. Метрика, которую приятно наращивать, начинает
          подменять цель: стрик заставляет заходить ради стрика. Вместо них — прочность
          знания, калибровка и время до автоматизма: их нельзя нарастить, не научившись.
        </Feature>

        <Feature title="Честная модель ученика">
          Система показывает не то, что вы прошли, а то, что помните: расписание повторений
          по FSRS, разрыв между уверенностью и точностью, типы ошибок. Сырые данные можно
          выгрузить в CSV и пересчитать выводы самостоятельно.
        </Feature>

        <Feature title="Рабочая тетрадь">
          Второй слой той же карты. Каждая заметка заякорена на тему и возвращается, когда
          знание под ней проседает. Записать мысль можно одним жестом откуда угодно, а
          унести — целиком, обычными .md-файлами.
        </Feature>

        <Feature title="Работает без ИИ">
          Проверка ответов, подбор заданий, расписание, поиск и подсказки — детерминированные
          и считаются на месте. Модель нужна для генерации материала и разбора; когда она
          недоступна, обучение продолжается, а приложение говорит об этом прямо.
        </Feature>
      </section>

      <footer className="border-t border-border pt-6 text-xs text-fg-subtle">
        <p>
          В основе — работы по тестированию как способу учиться, интерливингу, желательным
          трудностям и метакогниции. Каждая механика в интерфейсе подписана тем
          исследованием, из которого она взята: вы всегда можете проверить, почему
          приложение просит вас делать именно так.
        </p>
      </footer>
    </main>
  );
}

function Feature({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass p-5">
      <h2 className="text-sm font-medium text-fg">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-fg-muted">{children}</p>
    </div>
  );
}
