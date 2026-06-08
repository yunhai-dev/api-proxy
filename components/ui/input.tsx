"use client";

import type { InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  tone?: "default" | "search";
};

export function Input({ className = "", tone = "default", type = "text", ...props }: InputProps) {
  return <input type={type} className={`ui-input ${tone === "search" ? "search-input" : ""} ${className}`.trim()} {...props} />;
}
