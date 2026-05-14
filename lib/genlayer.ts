import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import {
  ExecutionResult,
  isDecidedState,
  TransactionResult,
  type GenLayerTransaction,
  type TransactionHash
} from "genlayer-js/types";
import type { Eip1193Provider } from "ethers";
import type { Address } from "viem";
export const FACT_CHECKER_CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_FACTCHECKER_CONTRACT || "0x6a620f3a17334BC1Ab25e31C4C60318f148e800f";
export const CONTRACT_ADDRESS = FACT_CHECKER_CONTRACT_ADDRESS;

export const GENLAYER_RPC_URL =
  process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ||
  process.env.NEXT_PUBLIC_GENLAYER_NETWORK ||
  "https://rpc-bradbury.genlayer.com";

export const FACT_CHECKER_ABI = [
  {
    name: "verify_claim",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "claim", type: "string" },
      { name: "url", type: "string" }
    ],
    outputs: []
  },
  {
    name: "get_last_result",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "claim", type: "string" },
      { name: "verdict", type: "string" },
      { name: "reason", type: "string" }
    ]
  }
] as const;

export type FactCheckerResult = {
  claim: string;
  verdict: string;
  reason: string;
};

export type VerifyClaimResponse = {
  txHash: string;
};

export type GenLayerTransactionState = {
  pending: boolean;
  failed: boolean;
  status?: string;
  result?: string;
  executionResult?: string;
  transaction?: GenLayerTransaction;
};

type GenLayerClientConfig = NonNullable<Parameters<typeof createClient>[0]>;
type GenLayerWalletProvider = GenLayerClientConfig["provider"];

function makeGenLayerClient({
  account,
  provider
}: {
  account?: string;
  provider?: Eip1193Provider;
} = {}) {
  return createClient({
    chain: testnetBradbury,
    endpoint: GENLAYER_RPC_URL,
    account: account as Address | undefined,
    provider: provider as GenLayerWalletProvider
  });
}

export async function verifyClaimWithContract({
  claim,
  url,
  from,
  provider,
  contractAddress = FACT_CHECKER_CONTRACT_ADDRESS
}: {
  claim: string;
  url?: string;
  from: string;
  provider: Eip1193Provider;
  contractAddress?: string;
}): Promise<VerifyClaimResponse> {
  const client = makeGenLayerClient({ account: from, provider });
  const tx = await client.writeContract({
    address: contractAddress as Address,
    functionName: "verify_claim",
    args: [claim, url || ""],
    value: BigInt(0)
  });

  return { txHash: normalizeTransactionHash(tx) };
}

export async function readLastResult(
  contractAddress = FACT_CHECKER_CONTRACT_ADDRESS
): Promise<FactCheckerResult> {
  const client = makeGenLayerClient();
  const result = await client.readContract({
    address: contractAddress as Address,
    functionName: "get_last_result",
    args: [],
    jsonSafeReturn: true
  });

  return normalizeFactCheckerResult(result);
}

export async function getGenLayerTransactionState(txHash: string): Promise<GenLayerTransactionState> {
  const client = makeGenLayerClient();
  const transaction = await client.getTransaction({ hash: txHash as TransactionHash });
  const status = transaction.statusName?.toString();
  const result = transaction.resultName?.toString();
  const executionResult = transaction.txExecutionResultName?.toString();
  const pending = !status || !isDecidedState(status);
  const failed =
    result === TransactionResult.FAILURE ||
    executionResult === ExecutionResult.FINISHED_WITH_ERROR ||
    status === "CANCELED" ||
    status === "VALIDATORS_TIMEOUT" ||
    status === "LEADER_TIMEOUT";

  return {
    pending,
    failed,
    status,
    result,
    executionResult,
    transaction
  };
}

export function formatContractError(error: unknown) {
  if (error instanceof Error) {
    const code = (error as Error & { code?: string | number }).code?.toString();
    const message = collectErrorMessages(error).join(" ");
    const normalizedMessage = message.toLowerCase();

    if (code === "ACTION_REJECTED" || code === "4001" || normalizedMessage.includes("user rejected")) {
      return "Transaction rejected in wallet.";
    }

    if (normalizedMessage.includes("revert") || normalizedMessage.includes("finished_with_error")) {
      return "Bradbury accepted the transaction, but the contract execution reverted. This usually means the contract rejected the input or the deployed method signature differs from the frontend call.";
    }

    if (/0x[0-9a-f]{80,}/i.test(message)) {
      return "The wallet or RPC rejected the contract call data. Reconnect your wallet, switch to GenLayer Bradbury, and try again.";
    }

    if (normalizedMessage.includes("network") || normalizedMessage.includes("rpc")) {
      return "RPC/network error while contacting Bradbury Testnet. Please retry.";
    }

    return message || error.message;
  }

  return "Unable to verify claim. Please retry.";
}

function normalizeTransactionHash(value: unknown): string {
  if (typeof value === "string" && value.startsWith("0x")) {
    return value;
  }

  if (value && typeof value === "object") {
    const possibleHash = value as {
      hash?: unknown;
      txHash?: unknown;
      transactionHash?: unknown;
      txId?: unknown;
      id?: unknown;
    };
    const hash =
      possibleHash.hash ||
      possibleHash.txHash ||
      possibleHash.transactionHash ||
      possibleHash.txId ||
      possibleHash.id;

    if (typeof hash === "string" && hash.startsWith("0x")) {
      return hash;
    }
  }

  throw new Error("Bradbury returned an unexpected transaction response.");
}

function normalizeFactCheckerResult(result: unknown): FactCheckerResult {
  if (Array.isArray(result)) {
    return {
      claim: stringifyValue(result[0]),
      verdict: stringifyValue(result[1]),
      reason: stringifyValue(result[2])
    };
  }

  if (result instanceof Map) {
    return {
      claim: stringifyValue(result.get("claim") ?? result.get(0)),
      verdict: stringifyValue(result.get("verdict") ?? result.get(1)),
      reason: stringifyValue(result.get("reason") ?? result.get(2))
    };
  }

  if (result && typeof result === "object") {
    const objectResult = result as Record<string, unknown>;
    return {
      claim: stringifyValue(objectResult.claim ?? objectResult[0]),
      verdict: stringifyValue(objectResult.verdict ?? objectResult[1]),
      reason: stringifyValue(objectResult.reason ?? objectResult[2])
    };
  }

  throw new Error("Bradbury returned an unexpected fact-check result.");
}

function stringifyValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return typeof value === "string" ? value : String(value);
}

function collectErrorMessages(error: unknown): string[] {
  if (!error || typeof error !== "object") {
    return [];
  }

  const current = error as {
    message?: string;
    shortMessage?: string;
    reason?: string;
    details?: string;
    info?: unknown;
    error?: unknown;
    cause?: unknown;
  };
  const messages = [
    current.shortMessage,
    current.reason,
    current.details,
    current.message
  ].filter(Boolean) as string[];

  return [
    ...messages,
    ...collectErrorMessages(current.info),
    ...collectErrorMessages(current.error),
    ...collectErrorMessages(current.cause)
  ];
}
