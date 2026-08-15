import { EthereumProvider } from "@walletconnect/ethereum-provider";
import type { Eip1193Provider } from "ethers";
import { GENLAYER_RPC_URL } from "@/lib/genlayer";
import { BRADBURY_CHAIN_ID_DECIMAL } from "@/lib/wallet";

/**
 * WalletConnect v2 (QR pairing) for TruthGuard.
 *
 * The app's wallet flow works with any EIP-1193 provider, so WalletConnect
 * plugs straight in: `createWalletConnectProvider()` returns a provider that
 * shows the WalletConnect QR modal on first use and forwards
 * `eth_requestAccounts` / `wallet_switchEthereumChain` /
 * `wallet_addEthereumChain` to the paired mobile wallet.
 *
 * Requires a free WalletConnect Cloud project id:
 *   NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<projectId>
 */

export const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

export function isWalletConnectConfigured() {
  return typeof window !== "undefined" && WALLETCONNECT_PROJECT_ID.length > 0;
}

export async function createWalletConnectProvider(): Promise<Eip1193Provider> {
  if (!WALLETCONNECT_PROJECT_ID) {
    throw new Error(
      "WalletConnect is not configured yet. Add NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID (free from cloud.walletconnect.com) and redeploy."
    );
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "https://truthguard.app";

  // Propose Ethereum mainnet as the required chain so every WalletConnect
  // wallet can approve the session, then switch/add GenLayer Bradbury
  // (4221) right after — same flow as the injected-wallet path.
  const provider = await EthereumProvider.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    chains: [1],
    optionalChains: [1, BRADBURY_CHAIN_ID_DECIMAL],
    rpcMap: {
      1: "https://ethereum-rpc.publicnode.com",
      [BRADBURY_CHAIN_ID_DECIMAL]: GENLAYER_RPC_URL
    },
    showQrModal: true,
    metadata: {
      name: "TruthGuard",
      description: "Decentralized AI fact-checking on GenLayer Bradbury Testnet",
      url: origin,
      icons: [`${origin}/icon.svg`]
    }
  });

  return provider;
}

export async function disconnectWalletConnect(provider: unknown) {
  const wcProvider = provider as { disconnect?: () => Promise<void> } | null;
  try {
    await wcProvider?.disconnect?.();
  } catch {
    // Session may already be closed — treat as success.
  }
}
