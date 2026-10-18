import type { Metadata } from "next";
import { Suspense } from "react";
import { PublicVerifier } from "@/components/PublicVerifier";

export const metadata: Metadata = {
  title: "Public verifier — EL JOKER 2.0",
  description: "Check any EL JOKER mission yourself: your browser recomputes every hash and reads Hedera directly. No trust in our server required.",
};

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center text-ink-400">Loading the verifier…</div>}>
      <PublicVerifier />
    </Suspense>
  );
}
