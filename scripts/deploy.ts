import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { createAccount, createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import {
  GenLayerTransaction,
  TransactionHash,
  TransactionStatus
} from "genlayer-js/types";
import path from "path";

// Load the classic `.env`, the local `.env.local`, and the repo-root
// `.env.local` (used by Freebuff's write-only env tool). Later files take
// precedence for duplicate keys.
config({
  path: [
    path.join(__dirname, ".env"),
    path.join(__dirname, ".env.local"),
    path.join(__dirname, "..", ".env.local")
  ]
});

const CONTRACT_ENV_KEY = "NEXT_PUBLIC_FACTCHECKER_CONTRACT";
const ROOT_ENV_LOCAL = path.join(__dirname, "..", ".env.local");
const BRADBURY_RPC_DEFAULT = testnetBradbury.rpcUrls.default.http[0];

const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;
const account = createAccount(privateKey);
const effectiveRpc = process.env.RPC_URL || BRADBURY_RPC_DEFAULT;

const client = createClient({
  chain: testnetBradbury,
  endpoint: effectiveRpc,
  account
});

function safeJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested) =>
    typeof nested === "bigint" ? nested.toString() : nested
  );
}

function checkReceiptSuccess(receipt: GenLayerTransaction, context = "Transaction"): void {
  const leader = receipt.consensus_data?.leader_receipt?.[0];
  const result = leader?.execution_result;
  // A missing leader receipt is not necessarily a failure (shapes vary); the
  // post-deploy read of get_checks_count() is the real proof. An explicit
  // failure status is.
  if (result && result.toUpperCase() !== "SUCCESS") {
    throw new Error(
      `${context} failed (${result}). Receipt: ${safeJson(receipt).slice(0, 2000)}`
    );
  }
}

function readContract(filename: string): string {
  return readFileSync(
    path.join(__dirname, "..", "intelligent-contracts", filename),
    "utf8"
  );
}

function extractContractAddress(receipt: GenLayerTransaction): string {
  if (receipt.txDataDecoded && "contractAddress" in receipt.txDataDecoded) {
    const addr = receipt.txDataDecoded.contractAddress;
    if (addr) return addr;
  }
  const fallback = receipt.data?.contract_address;
  if (typeof fallback === "string") return fallback;
  throw new Error(
    `Could not extract contract address from receipt: ${JSON.stringify(receipt)}`
  );
}

function upsertEnvKey(filePath: string, key: string, value: string): void {
  const newLine = `${key}=${value}`;
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${newLine}\n`);
    return;
  }
  const content = readFileSync(filePath, "utf8");
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyPattern = new RegExp(`^${escapedKey}=.*$`, "m");
  if (keyPattern.test(content)) {
    writeFileSync(filePath, content.replace(keyPattern, () => newLine));
  } else {
    const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
    writeFileSync(filePath, `${content}${separator}${newLine}\n`);
  }
}

async function verifyContract(address: string): Promise<void> {
  const readClient = createClient({
    chain: testnetBradbury,
    endpoint: effectiveRpc
  });
  try {
    const checks = await readClient.readContract({
      address: address as `0x${string}`,
      functionName: "get_checks_count",
      args: []
    });
    console.log(`Contract verified — get_checks_count() = ${JSON.stringify(checks)}.`);
  } catch (err) {
    console.warn("Contract verify call failed (deploy still succeeded):", err);
  }
}

const main = async () => {
  console.log(`Deploying TruthGuard via ${effectiveRpc}`);
  if (!privateKey) {
    const isBradbury = effectiveRpc === BRADBURY_RPC_DEFAULT;
    if (isBradbury) {
      console.warn(
        "WARNING: no PRIVATE_KEY set — deploying with an ephemeral account. " +
          "Set PRIVATE_KEY in scripts/.env to deploy from your own Bradbury wallet."
      );
    }
  }

  // CONTRACT_FILE lets us probe alternate contract sources (e.g. a minimal
  // probe) without touching the real contract. PERSIST_ADDRESS=0 skips the
  // app .env.local update for probe runs.
  const contractFilename = process.env.CONTRACT_FILE || "TruthGuard.py";
  const persistAddress = process.env.PERSIST_ADDRESS !== "0";
  const deployArgs = process.env.CONTRACT_ARGS ? JSON.parse(process.env.CONTRACT_ARGS) : [];
  const contractCode = readContract(contractFilename);
  // Resume support: if DEPLOY_TX_HASH is set, reuse the already-submitted
  // deployment tx (e.g. after a previous run crashed) instead of deploying a
  // second instance and spending gas twice.
  const existingTxHash = process.env.DEPLOY_TX_HASH;
  const deployTxHash = existingTxHash
    ? (existingTxHash as TransactionHash)
    : ((await client.deployContract({
        code: contractCode,
        args: deployArgs
      })) as TransactionHash);
  console.log("Deploy tx hash:", deployTxHash);

  const receipt = await client.waitForTransactionReceipt({
    hash: deployTxHash,
    status: TransactionStatus.ACCEPTED,
    retries: 200
  });
  checkReceiptSuccess(receipt, "Contract deployment");

  const address = extractContractAddress(receipt);
  console.log(`Deployed TruthGuard to: ${address}`);

  if (persistAddress) {
    upsertEnvKey(ROOT_ENV_LOCAL, CONTRACT_ENV_KEY, address);
    console.log(`Wrote ${CONTRACT_ENV_KEY}=${address} → ${ROOT_ENV_LOCAL}`);
  } else {
    console.log(`(Skipped writing ${CONTRACT_ENV_KEY} — probe run.)`);
  }

  await verifyContract(address);

  const accountSource = privateKey ? "from PRIVATE_KEY" : "ephemeral";
  console.log("");
  console.log(`✓ TruthGuard: ${address}`);
  console.log(`✓ RPC: ${effectiveRpc}`);
  console.log(`✓ Account: ${account.address} (${accountSource})`);
  console.log(`✓ .env.local updated. Restart the app (or set the env var in your hosting dashboard).`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
