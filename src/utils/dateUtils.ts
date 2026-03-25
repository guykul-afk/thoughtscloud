/**
 * Standardized date utilities for the ThoughtsCloud system.
 * Week definition: Sunday 00:01 to Saturday 23:59.
 */

export function getStartOfCurrentWeek(date: Date = new Date()): number {
  const d = new Date(date);
  const day = d.getDay(); // 0 (Sun) to 6 (Sat)
  
  // Go back to Sunday
  d.setDate(d.getDate() - day);
  
  // Set to 00:01:00.000
  d.setHours(0, 1, 0, 0);
  
  return d.getTime();
}

export function getEndOfCurrentWeek(date: Date = new Date()): number {
  const d = new Date(date);
  const day = d.getDay();
  
  // Go forward to Saturday
  d.setDate(d.getDate() + (6 - day));
  
  // Set to 23:59:59.999
  d.setHours(23, 59, 59, 999);
  
  return d.getTime();
}

/**
 * Returns the timestamp for Sunday 00:01 of the previous week.
 */
export function getStartOfPreviousWeek(date: Date = new Date()): number {
  const startOfThisWeek = getStartOfCurrentWeek(date);
  const d = new Date(startOfThisWeek);
  d.setDate(d.getDate() - 7);
  return d.getTime();
}

/**
 * Helper to check if a timestamp falls within the "Current Week"
 */
export function isWithinCurrentWeek(timestamp: number): boolean {
  const now = new Date();
  return timestamp >= getStartOfCurrentWeek(now) && timestamp <= getEndOfCurrentWeek(now);
}
