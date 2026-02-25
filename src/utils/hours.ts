import type { WorkHoursStats } from '../types';

const HOURS_PER_DAY = 7;

function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function countWeekdaysInMonth(year: number, monthIndex: number): number {
  const date = new Date(year, monthIndex, 1);
  let count = 0;

  while (date.getMonth() === monthIndex) {
    if (isWeekday(date)) count += 1;
    date.setDate(date.getDate() + 1);
  }

  return count;
}

function countWeekdaysFromMonthStart(today: Date): number {
  const date = new Date(today.getFullYear(), today.getMonth(), 1);
  let count = 0;

  while (date <= today) {
    if (isWeekday(date)) count += 1;
    date.setDate(date.getDate() + 1);
  }

  return count;
}

export function calculateWorkHours(now = new Date()): WorkHoursStats {
  const year = now.getFullYear();
  const month = now.getMonth();

  const totalWorkingDays = countWeekdaysInMonth(year, month);
  const elapsedWorkingDays = countWeekdaysFromMonthStart(now);

  const totalMonthHours = totalWorkingDays * HOURS_PER_DAY;
  const elapsedHours = elapsedWorkingDays * HOURS_PER_DAY;
  const completionPercent = totalMonthHours
    ? Math.round((elapsedHours / totalMonthHours) * 100)
    : 0;

  return {
    totalMonthHours,
    elapsedHours,
    elapsedWorkingDays,
    totalWorkingDays,
    completionPercent
  };
}
