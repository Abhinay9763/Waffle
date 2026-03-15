import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-zinc-950">
      <Loader2 className="w-5 h-5 animate-spin text-zinc-600" />
    </div>
  );
}
