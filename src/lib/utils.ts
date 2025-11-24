import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats a date string from YYYY-MM-DD to YYYY/MM/DD without any Date object conversion
 */
export function formatDateString(dateString: string): string {
  return dateString.replace(/-/g, '/');
}

/**
 * Formats a date string from YYYY-MM-DD to DD MMM YYYY without Date object conversion
 */
export function formatDateStringToLong(dateString: string): string {
  const [year, month, day] = dateString.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[parseInt(month) - 1]} ${year}`;
}

/**
 * Formats a date string from YYYY-MM-DD to MMM YYYY without Date object conversion
 */
export function formatDateStringToMonthYear(dateString: string): string {
  const [year, month] = dateString.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[parseInt(month) - 1]} ${year}`;
}

/**
 * Extracts the month number (1-12) from a YYYY-MM-DD date string without timezone conversion
 */
export function getMonthFromDateString(dateString: string): number {
  const [, month] = dateString.split('-');
  return parseInt(month);
}

/**
 * Calculates the number of days between two date strings (YYYY-MM-DD) without timezone conversion
 * Returns the absolute difference in days
 */
export function daysBetweenDateStrings(date1: string, date2: string): number {
  const [y1, m1, d1] = date1.split('-').map(Number);
  const [y2, m2, d2] = date2.split('-').map(Number);
  
  // Create dates at noon to avoid timezone issues
  const d1Obj = new Date(y1, m1 - 1, d1, 12, 0, 0);
  const d2Obj = new Date(y2, m2 - 1, d2, 12, 0, 0);
  
  const diffTime = Math.abs(d2Obj.getTime() - d1Obj.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
}
