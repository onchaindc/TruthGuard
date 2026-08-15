import { config } from "dotenv";
import path from "path";
import { createAccount, createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { isDecidedState, type TransactionHash } from "genlayer-js/types";

config({
  path: [
    path.join(__dirname, ".env"),
    path.join(__dirname, ".env.local"),
    path.join(__dirname, "..", ".env.local"),
  ],
});

const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;
const account = createAccount(privateKey);
const client = createClient({
  chain: testnetBradbury,
  endpoint: process.env.RPC_URL || testnetBradbury.rpcUrls.default.http[0],
  account,
});

const CONTRACT = (process.env.NEXT_PUBLIC_FACTCHECKER_CONTRACT ||
  "0x5bce9473CD61A5A0FF9f13FCE2522efCC00776f8") as `0x${string}`;

const mode = process.argv[2] || "submit";

const main = async () => {
  if (mode === "submit") {
    const claim = process.argv[3] || "Paris is the capital of France";
    const url = process.argv[4] || "https://en.wikipedia.org/wiki/Paris";
    console.log(`verify_claim → ${CONTRACT}`);
    const tx = (await client.writeContract({
      address: CONTRACT,
      functionName: "verify_claim",
      args: [claim, url],
      value: BigInt(0),
    })) as TransactionHash;
    console.log("TX_HASH=" + tx);
    return;
  }

  const txHash = process.argv[3] as TransactionHash;
  if (!txHash) throw new Error("poll mode needs a tx hash");
  // Bradbury consensus on a web-fetching, LLM-running contract can take
  // several minutes. Poll up to ~10 minutes before giving up.
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const t = await client.getTransaction({ hash: txHash });
    const status = t.statusName?.toString();
    const result = t.resultName?.toString();
    const exec = t.txExecutionResultName?.toString();
    console.log(`[poll ${i + 1}] status=${status} result=${result} exec=${exec}`);
    if (status && isDecidedState(status)) {
      const last = await client.readContract({
        address: CONTRACT,
        functionName: "get_last_result",
        args: [],
        jsonSafeReturn: true,
      });
      console.log("\nget_last_result():");
      console.log(JSON.stringify(last, null, 2));
      break;
    }
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
