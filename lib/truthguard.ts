import { FactCheckerResult } from "@/lib/genlayer";

export type Verdict = "true" | "false" | "uncertain";

export type EvidenceSource = {
  url: string;
  title?: string;
  excerpt?: string;
  /** 0-100, only present when the contract recorded a source reliability. */
  reliability?: number;
};

export type VerificationResult = {
  id: string;
  claim: string;
  verdict: Verdict;
  /** 0-100 from on-chain consensus; undefined when the contract did not record one. */
  confidence?: number;
  explanation: string;
  evidence: EvidenceSource[];
  /** True when the contract actually fetched and analyzed the evidence URL. */
  evidenceLoaded?: boolean;
  requester?: string;
  /** Bradbury block number the consensus result was recorded on. */
  verifiedBlock?: string;
  checksCount?: number;
  completedAt: string;
  txHash: string;
  contractAddress: string;
  raw: Record<string, unknown>;
};

export const verificationSteps = [
  {
    title: "Checking facts...",
    detail: "Submitting the claim to the TruthGuard contract on Bradbury Testnet."
  },
  {
    title: "Waiting for validator consensus",
    detail: "Validators fetch the evidence, analyze the claim, and must agree before the transaction finalizes."
  },
  {
    title: "Reading consensus result",
    detail: "Fetching the agreed verdict, confidence, and reasoning from get_last_result()."
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

/**
 * Build the display result strictly from what the contract returned.
 * Nothing here is guessed: confidence, evidence analysis, and the recorded
 * block number come from `get_last_result()`. Legacy contracts that only return
 * [claim, verdict, reason] leave the richer fields undefined, and the UI shows
 * them as "not recorded on-chain" instead of inventing numbers.
 */
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

  const evidence: EvidenceSource[] = [];
  if (contractResult.evidenceTitle || contractResult.evidenceExcerpt) {
    evidence.push({
      url: contractResult.url || sourceUrl,
      title: contractResult.evidenceTitle,
      excerpt: contractResult.evidenceExcerpt,
      reliability: contractResult.evidenceReliability
    });
  } else if (sourceUrl) {
    // The contract did not record an evidence analysis (e.g. legacy
    // deployments). Show the submitted URL with the explicit note that no
    // on-chain analysis exists for it.
    evidence.push({
      url: sourceUrl,
      title: safeHost(sourceUrl)
    });
  }

  return {
    id: `tg_${txHash.slice(2, 12)}_${Date.now().toString(36)}`,
    claim: contractResult.claim,
    verdict,
    confidence: contractResult.confidence,
    explanation:
      contractResult.reasoning ||
      contractResult.reason ||
      "The contract returned a verdict without reasoning. (A deployed contract that does not record reasoning may be an older FactChecker instance.)",
    evidence,
    evidenceLoaded: contractResult.evidenceLoaded,
    requester: contractResult.requester,
    verifiedBlock: contractResult.verifiedBlock,
    checksCount: contractResult.checksCount,
    completedAt: contractResult.verifiedBlock || new Date().toISOString(),
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

function safeHost(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "Submitted evidence";
  }
}
