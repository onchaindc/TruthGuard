import { Eip1193Provider } from "ethers";

export const BRADBURY_CHAIN_ID_HEX = "0x107d";
export const BRADBURY_CHAIN_ID_DECIMAL = 4221;
export const SELECTED_WALLET_KEY = "truthguard:selected-wallet";

export type WalletOption = {
  id: string;
  name: string;
  icon?: string;
  rdns?: string;
  provider: Eip1193Provider;
};

type Eip6963ProviderDetail = {
  info: {
    uuid: string;
    name: string;
    icon?: string;
    rdns?: string;
  };
  provider: Eip1193Provider;
};

type LegacyEthereumProvider = Eip1193Provider & {
  providers?: Eip1193Provider[];
  isMetaMask?: boolean;
  isRabby?: boolean;
  isCoinbaseWallet?: boolean;
  isPhantom?: boolean;
};

export function getLegacyInjectedWallets(): WalletOption[] {
  if (typeof window === "undefined") {
    return [];
  }

  const ethereum = (window as unknown as { ethereum?: LegacyEthereumProvider }).ethereum;
  if (!ethereum) {
    return [];
  }

  const providers = ethereum.providers?.length ? ethereum.providers : [ethereum];

  return providers.map((provider, index) => ({
    id: legacyWalletId(provider, index),
    name: legacyWalletName(provider),
    provider
  }));
}

export function walletFromEip6963(detail: Eip6963ProviderDetail): WalletOption {
  return {
    id: detail.info.uuid || detail.info.rdns || detail.info.name,
    name: detail.info.name,
    icon: detail.info.icon,
    rdns: detail.info.rdns,
    provider: detail.provider
  };
}

export async function getWalletAccounts(provider: Eip1193Provider) {
  return (await provider.request({ method: "eth_accounts" })) as string[];
}

export async function requestWalletAccounts(provider: Eip1193Provider) {
  return (await provider.request({ method: "eth_requestAccounts" })) as string[];
}

export async function getWalletChainId(provider: Eip1193Provider) {
  return (await provider.request({ method: "eth_chainId" })) as string;
}

export async function ensureBradburyNetwork(provider: Eip1193Provider) {
  const chainId = await getWalletChainId(provider);

  if (chainId.toLowerCase() === BRADBURY_CHAIN_ID_HEX) {
    return chainId;
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BRADBURY_CHAIN_ID_HEX }]
    });
  } catch (error) {
    const code = (error as { code?: number | string })?.code;

    if (code !== 4902 && code !== "4902") {
      throw error;
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: BRADBURY_CHAIN_ID_HEX,
          chainName: "GenLayer Bradbury Testnet",
          nativeCurrency: {
            name: "GenLayer",
            symbol: "GEN",
            decimals: 18
          },
          rpcUrls: [process.env.NEXT_PUBLIC_GENLAYER_RPC_URL || "https://rpc-bradbury.genlayer.com"],
          blockExplorerUrls: [process.env.NEXT_PUBLIC_GENLAYER_EXPLORER || "https://explorer-bradbury.genlayer.com"]
        }
      ]
    });
  }

  return getWalletChainId(provider);
}

export function formatChainLabel(chainId: string) {
  if (!chainId) {
    return "Not connected";
  }

  if (chainId.toLowerCase() === BRADBURY_CHAIN_ID_HEX) {
    return `Bradbury (${BRADBURY_CHAIN_ID_DECIMAL})`;
  }

  return `Chain ${Number.parseInt(chainId, 16) || chainId}`;
}

function legacyWalletId(provider: LegacyEthereumProvider, index: number) {
  if (provider.isRabby) return "legacy-rabby";
  if (provider.isCoinbaseWallet) return "legacy-coinbase";
  if (provider.isPhantom) return "legacy-phantom";
  if (provider.isMetaMask) return "legacy-metamask";
  return `legacy-injected-${index}`;
}

function legacyWalletName(provider: LegacyEthereumProvider) {
  if (provider.isRabby) return "Rabby";
  if (provider.isCoinbaseWallet) return "Coinbase Wallet";
  if (provider.isPhantom) return "Phantom";
  if (provider.isMetaMask) return "MetaMask";
  return "Browser Wallet";
}

declare global {
  interface WindowEventMap {
    "eip6963:announceProvider": CustomEvent<Eip6963ProviderDetail>;
    "eip6963:requestProvider": Event;
  }
}
