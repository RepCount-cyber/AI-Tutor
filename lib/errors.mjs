export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function requireValue(condition, message, status = 400) {
  if (!condition) throw new AppError(status, message);
}
export function text(value, max = 4000) {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `Enter text between 1 and ${max} characters.`);
  return value.trim();
}
export function uuid(value) {
  requireValue(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value), 'Invalid record identifier.');
  return value;
}
