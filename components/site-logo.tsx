type SiteLogoProps = {
  logoUrl?: string;
  alt: string;
  className?: string;
};

export function SiteLogo({ logoUrl, alt, className = "h-5 w-5 rounded object-contain" }: SiteLogoProps) {
  const src = logoUrl?.trim();
  if (!src) return <span className="inline-block h-2 w-2 rounded-full bg-primary" />;
  return <img className={className} src={src} alt={alt} />;
}
