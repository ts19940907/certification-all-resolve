import type { SrsCardState, SrsRating } from '../types/srs';

const MIN_EASE = 1.3;
const EASY_BONUS = 1.3;

/** 端末ローカルのカレンダー日付 YYYY-MM-DD */
export function localDateString(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addLocalDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map((v) => Number(v));
  const dt = new Date(y!, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + days);
  return localDateString(dt);
}

function clampEase(ease: number): number {
  return Math.max(MIN_EASE, Math.round(ease * 100) / 100);
}

/**
 * Anki SM-2 系の次回スケジュール。
 * dueOn は端末ローカル日付文字列で返す。
 */
export function applySm2(
  current: Pick<SrsCardState, 'easeFactor' | 'intervalDays' | 'repetitions'>,
  rating: SrsRating,
  today = localDateString(),
): SrsCardState {
  let ease = current.easeFactor || 2.5;
  let interval = Math.max(0, current.intervalDays);
  let reps = Math.max(0, current.repetitions);

  switch (rating) {
    case 'again': {
      reps = 0;
      interval = 0;
      ease = clampEase(ease - 0.2);
      return {
        easeFactor: ease,
        intervalDays: interval,
        repetitions: reps,
        dueOn: today,
      };
    }
    case 'hard': {
      ease = clampEase(ease - 0.15);
      if (reps === 0) {
        interval = 1;
        reps = 1;
      } else {
        interval = Math.max(1, Math.ceil(interval * 1.2));
        reps += 1;
      }
      break;
    }
    case 'good': {
      if (reps === 0) {
        interval = 1;
      } else if (reps === 1) {
        interval = 6;
      } else {
        interval = Math.max(1, Math.round(interval * ease));
      }
      reps += 1;
      break;
    }
    case 'easy': {
      ease = clampEase(ease + 0.15);
      if (reps === 0) {
        interval = 4;
      } else if (reps === 1) {
        interval = Math.max(4, Math.round(6 * EASY_BONUS));
      } else {
        interval = Math.max(1, Math.round(interval * ease * EASY_BONUS));
      }
      reps += 1;
      break;
    }
  }

  return {
    easeFactor: ease,
    intervalDays: interval,
    repetitions: reps,
    dueOn: addLocalDays(today, interval),
  };
}

/** 新規カード登録時（まだ評価していない）: 当日 due */
export function initialSrsState(today = localDateString()): SrsCardState {
  return {
    easeFactor: 2.5,
    intervalDays: 0,
    repetitions: 0,
    dueOn: today,
  };
}
