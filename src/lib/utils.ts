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
