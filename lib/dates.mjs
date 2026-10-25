import { requireValue } from './errors.mjs';
export function todayDubai(now = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
export function addDays(date, count) { requireValue(validDate(date), 'Invalid date.'); return new Date(new Date(`${date}T12:00:00Z`).getTime() + count * 86400000).toISOString().slice(0, 10); }
export function monday(date = todayDubai()) { const day = new Date(`${date}T12:00:00Z`).getUTCDay(); return addDays(date, -((day + 6) % 7)); }
export function minutes(time) {
  const match = /^(\d{2}):(\d{2})$/.exec(time || '');
  requireValue(match && +match[1] < 24 && +match[2] < 60, 'Use a valid HH:MM time.');
  return +match[1] * 60 + +match[2];
}
export function timeLabel(n) { return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; }
