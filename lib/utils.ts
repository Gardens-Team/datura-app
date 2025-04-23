import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type StyleValue = string | number | { [key: string]: any };

export function sx(...styles: StyleValue[]) {
  return Object.assign({}, ...styles);
}
