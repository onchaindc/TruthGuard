import { NextRequest, NextResponse } from "next/server";
import {
  FACT_CHECKER_CONTRACT_ADDRESS,
  formatContractError,
  getGenLayerTransactionState,
  readLastResult
} from "@/lib/genlayer";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const txHash = searchParams.get("txHash") || "";
  const contractAddress = searchParams.get("contractAddress") || FACT_CHECKER_CONTRACT_ADDRESS;

  try {
    if (txHash) {
      const transactionState = await getGenLayerTransactionState(txHash);

      if (transactionState.pending) {
        return NextResponse.json(
          {
            status: "pending",
            transactionStatus: transactionState.status,
            executionResult: transactionState.executionResult
          },
          { status: 202 }
        );
      }

      if (transactionState.failed) {
        return NextResponse.json(
          {
            status: "failed",
            transactionStatus: transactionState.status,
            executionResult: transactionState.executionResult,
            error:
              "The transaction reached Bradbury, but the contract execution failed. Confirm the deployed contract address and method names match verify_claim(claim, url)."
          },
          { status: 409 }
        );
      }
    }

    const result = await readLastResult(contractAddress);
    return NextResponse.json({ status: "complete", result });
  } catch (error) {
    return NextResponse.json(
      { status: "error", error: formatContractError(error) },
      { status: 502 }
    );
  }
}
