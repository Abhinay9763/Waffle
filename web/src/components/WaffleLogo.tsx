import { LOGO } from "@/lib/config";

export function WaffleLogo({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={LOGO} alt="SMEC logo" width={size} height={size} className={className} style={{ objectFit: "contain" }} />
  );
}
