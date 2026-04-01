import { LOGO, LOGO_ALT } from "@/lib/config";

export function WaffleLogo({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={LOGO} alt={LOGO_ALT} width={size} height={size} className={className} style={{ objectFit: "contain" }} />
  );
}
