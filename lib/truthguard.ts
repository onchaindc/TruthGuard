import { FactCheckerResult } from "@/lib/genlayer";

export type Verdict = "true" | "false" | "uncertain";

export type VerificationResult = {
  id: string;
  claim: string;
  verdict: Verdict;
  confidence: number;
  explanation: string;
  evidence: {
    title: string;
    url: string;
    excerpt: string;
    reliability: number;
  }[];
  validators: number;
  completedAt: string;
  txHash: string;
  contractAddress: string;
  raw: Record<string, unknown>;
};

export const verificationSteps = [
  {
    title: "Checking facts...",
    detail: "Submitting the claim to the Bradbury Testnet fact-checking contract."
  },
  {
    title: "Waiting for transaction",
    detail: "Your wallet transaction is being confirmed on GenLayer."
  },
  {
    title: "Reading consensus result",
    detail: "Fetching the latest verdict and reason from get_last_result()."
  }
];

export const exampleClaims = [
  "A daily 20 minute walk can improve cardiovascular health.",
  "A major crypto exchange announced GenLayer support on Bradbury Testnet today.",
  "Wireless headphones with active noise cancellation always block 100% of background sound.",
  "The Eiffel Tower is taller in summer because iron expands with heat."
];

export function isValidUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function genlayerExplorerTxUrl(txHash: string) {
  const explorer = process.env.NEXT_PUBLIC_GENLAYER_EXPLORER || "https://explorer-bradbury.genlayer.com";
  return `${explorer.replace(/\/$/, "")}/transactions/${txHash}`;
}

export function createVerificationResult({
  contractResult,
  txHash,
  contractAddress,
  evidenceUrl
}: {
  contractResult: FactCheckerResult;
  txHash: string;
  contractAddress: string;
  evidenceUrl: string;
}): VerificationResult {
  const verdict = normalizeVerdict(contractResult.verdict);
  const sourceUrl = evidenceUrl.trim();

  return {
    id: `tg_${txHash.slice(2, 12)}_${Date.now().toString(36)}`,
    claim: contractResult.claim,
    verdict,
    confidence: confidenceFor(verdict),
    explanation: contractResult.reason || "The contract returned a verdict without a reason.",
    evidence: sourceUrl
      ? [
          {
            title: safeHost(sourceUrl),
            url: sourceUrl,
            excerpt: "Evidence URL submitted with the claim and included in the contract request.",
            reliability: 88
          }
        ]
      : [],
    validators: 5,
    completedAt: new Date().toISOString(),
    txHash,
    contractAddress,
    raw: {
      contractResult,
      evidenceUrl: sourceUrl,
      method: "verify_claim(claim, url) -> get_last_result()"
    }
  };
}

function normalizeVerdict(value: string): Verdict {
  const normalized = value.trim().toLowerCase();

  if (normalized === "true" || normalized.includes("true")) {
    return "true";
  }

  if (normalized === "false" || normalized.includes("false")) {
    return "false";
  }

  return "uncertain";
}

function confidenceFor(verdict: Verdict) {
  if (verdict === "uncertain") {
    return 64;
  }

  return 92;
}

function safeHost(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "Submitted evidence";
  }
}
