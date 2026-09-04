import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(num: string | number) {
  const n = typeof num === "string" ? parseInt(num, 10) : num;
  if (isNaN(n)) return "0";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toString();
}

export function formatFullNumber(num: string | number) {
  const n = typeof num === "string" ? parseInt(num, 10) : num;
  if (isNaN(n)) return "0";
  return new Intl.NumberFormat("vi-VN").format(n);
}
