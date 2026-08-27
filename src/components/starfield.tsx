'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Звёздный фон с параллаксом.
 *
 * Три решения, каждое со своей причиной:
 *
 * 1. При `prefers-reduced-motion` слой не рендерится вовсе, а не замедляется.
 *    Движущийся фон — ровно тот класс эффектов, ради которого эта настройка
 *    и существует; «почти неподвижные» звёзды всё равно вызывают тошноту у
 *    тех, кто её включил.
 * 2. Только десктоп. На телефоне параллакс требует перерисовки на каждый кадр
 *    прокрутки ради эффекта, который на маленьком экране почти не виден, —
 *    плохой размен для батареи. Мобильному достаётся статичный градиент из CSS.
 * 3. Звёзды генерируются один раз с фиксированным зерном. Случайное
 *    расположение на каждый рендер означало бы, что фон перепрыгивает при
 *    любой навигации.
 *
 * Слой чисто декоративный и не несёт данных: `aria-hidden`, `pointer-events:
 * none`, `z-index: -1`. Правило «цвет = данные» он не нарушает, потому что
 * ничего не сообщает и никогда не подсвечивает элементы интерфейса.
 */

type Star = { x: number; y: number; size: number; depth: number; opacity: number };

/** Детерминированный генератор: одинаковый фон при каждом монтировании. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function makeStars(count: number): Star[] {
  const random = seededRandom(20260827);
  return Array.from({ length: count }, () => ({
    x: random() * 100,
    y: random() * 100,
    size: 0.6 + random() * 1.4,
    // Три плана глубины: дальние почти неподвижны, ближние заметно смещаются.
    depth: 0.15 + random() * 0.85,
    opacity: 0.15 + random() * 0.45,
  }));
}

const STARS = makeStars(90);

export function Starfield() {
  const [enabled, setEnabled] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const desktop = window.matchMedia('(min-width: 768px) and (pointer: fine)');

    const update = () => setEnabled(!reducedMotion.matches && desktop.matches);
    update();

    // Настройки меняются на лету: человек включил «уменьшить движение» или
    // повернул планшет — слой обязан отреагировать без перезагрузки.
    reducedMotion.addEventListener('change', update);
    desktop.addEventListener('change', update);
    return () => {
      reducedMotion.removeEventListener('change', update);
      desktop.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    function onScroll() {
      if (frameRef.current !== null) return;
      // Через requestAnimationFrame: обработчик прокрутки, пишущий в стиль
      // напрямую, вызывает перерасчёт раскладки по несколько раз за кадр.
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const element = ref.current;
        if (element) element.style.setProperty('--scroll', String(window.scrollY));
      });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div ref={ref} aria-hidden className="starfield" style={{ '--scroll': 0 } as React.CSSProperties}>
      <svg width="100%" height="100%" preserveAspectRatio="none">
        {STARS.map((star, index) => (
          <circle
            key={index}
            cx={`${star.x}%`}
            cy={`${star.y}%`}
            r={star.size}
            fill="#ffffff"
            opacity={star.opacity}
            style={{
              transform: `translateY(calc(var(--scroll) * ${-0.04 * star.depth} * 1px))`,
            }}
          />
        ))}
      </svg>
    </div>
  );
}
