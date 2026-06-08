"use client";

import type { InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  tone?: "default" | "search";
};

export function Input({ className = "", tone = "default", type = "text", ...props }: InputProps) {
  if (tone === "search") {
    return (
      <span className={`ui-search-input ${className}`.trim()}>
        <span className="ui-search-input-mark mono" aria-hidden="true">/</span>
        <input type={type} className="ui-input" {...props} />
      </span>
    );
  }
  return <input type={type} className={`ui-input ${className}`.trim()} {...props} />;
}
