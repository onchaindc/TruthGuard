"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Gauge,
  History,
  Link2,
  Loader2,
  Moon,
  PlugZap,
  RefreshCw,
  SearchCheck,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Wallet,
  X
} from "lucide-react";
import {
  VerificationResult,
  createVerificationResult,
  exampleClaims,
  genlayerExplorerTxUrl,
  isValidUrl,
  verificationSteps
} from "@/lib/truthguard";
import {
  FactCheckerResult,
  FACT_CHECKER_CONTRACT_ADDRESS,
  formatContractError,
  verifyClaimWithContract,
  getGenLayerTransactionState,
  readLastResult
} from "@/lib/genlayer";
import {
  SELECTED_WALLET_KEY,
  WalletOption,
  BRADBURY_CHAIN_ID_HEX,
  ensureBradburyNetwork,
  formatChainLabel,
  getLegacyInjectedWallets,
  requestWalletAccounts,
  walletFromEip6963
} from "@/lib/wallet";
import {
  createWalletConnectProvider,
  disconnectWalletConnect,
  isWalletConnectConfigured
} from "@/lib/walletconnect";
import { truncateMiddle } from "@/lib/utils";

type Toast = { text: string; tone: "good" | "bad" | "info" } | null;

const MAX = 700;
const RATE_LIMIT = 20;
const HISTORY_KEY = "truthguard:history";
const RATE_KEY = "truthguard:rate";
const DEFAULT_CONTRACT = FACT_CHECKER_CONTRACT_ADDRESS;
const AUTHOR_LINKS = [
  { label: "X", href: "https://x.com/onchaindc" },
  { label: "GitHub", href: "https://github.com/onchaindc" },
  { label: "Telegram", href: "https://t.me/onchaindc" }
];

export function TruthGuardApp() {
  const [claim, setClaim] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [contractAddress, setContractAddress] = useState(DEFAULT_CONTRACT);
  const [wallet, setWallet] = useState("");
  const [walletName, setWalletName] = useState("");
  const [walletProvider, setWalletProvider] = useState<WalletOption["provider"] | null>(null);
  const [walletOptions, setWalletOptions] = useState<WalletOption[]>([]);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [chainId, setChainId] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [history, setHistory] = useState<VerificationResult[]>([]);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState("Ready for a claim.");
  const [advanced, setAdvanced] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [rate, setRate] = useState(0);

  const evidenceInvalid = evidenceUrl.trim().length > 0 && !isValidUrl(evidenceUrl.trim());
  const canVerify = claim.trim().length >= 12 && !evidenceInvalid && !busy;
  const checksRemaining = Math.max(0, RATE_LIMIT - rate);

  useEffect(() => {
    document.documentElement.classList.toggle("theme-light", theme === "light");
  }, [theme]);

  useEffect(() => {
    const saved = readHistory();
    setHistory(saved);
    setRate(readRate());
    const id = new URLSearchParams(window.location.search).get("result");
    const shared = id ? saved.find((item) => item.id === id) : null;
    if (shared) setResult(shared);
  }, []);

  useEffect(() => {
    const wallets = new Map<string, WalletOption>();
    const syncWallets = () => setWalletOptions(Array.from(wallets.values()));

    for (const walletOption of getLegacyInjectedWallets()) {
      wallets.set(walletOption.id, walletOption);
    }
    syncWallets();

    const onAnnounce = (event: WindowEventMap["eip6963:announceProvider"]) => {
      const walletOption = walletFromEip6963(event.detail);
      wallets.set(walletOption.id, walletOption);
      syncWallets();
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);

  useEffect(() => {
    if (!walletProvider) return;

    const providerWithEvents = walletProvider as WalletOption["provider"] & {
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };

    const onAccountsChanged = (accounts: unknown) => {
      const nextAccounts = Array.isArray(accounts) ? (accounts as string[]) : [];
      if (!nextAccounts[0]) {
        disconnectWallet();
        return;
      }
      setWallet(nextAccounts[0]);
    };

    const onChainChanged = (nextChainId: unknown) => {
      if (typeof nextChainId === "string") {
        setChainId(nextChainId);
      }
    };

    providerWithEvents.on?.("accountsChanged", onAccountsChanged);
    providerWithEvents.on?.("chainChanged", onChainChanged);

    return () => {
      providerWithEvents.removeListener?.("accountsChanged", onAccountsChanged);
      providerWithEvents.removeListener?.("chainChanged", onChainChanged);
    };
  }, [walletProvider]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void verify();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  function notify(text: string, tone: NonNullable<Toast>["tone"] = "info") {
    setToast({ text, tone });
  }

  async function connectWallet() {
    if (walletOptions.length === 0) return notify("No wallet found. Install a GenLayer-compatible browser wallet.", "bad");
    setWalletModalOpen(true);
  }

  async function connectSelectedWallet(walletOption: WalletOption) {
    try {
      const accounts = await requestWalletAccounts(walletOption.provider);
      const address = accounts[0];
      if (!address) throw new Error("Wallet connection did not return an account.");

      const nextChainId = await ensureBradburyNetwork(walletOption.provider);
      setWallet(address);
      setWalletName(walletOption.name);
      setWalletProvider(walletOption.provider);
      setChainId(nextChainId);
      localStorage.setItem(SELECTED_WALLET_KEY, walletOption.id);
      setWalletModalOpen(false);
      notify(`Connected ${walletOption.name}.`, "good");
    } catch (error) {
      notify(formatContractError(error), "bad");
    }
  }

  async function connectWalletConnect() {
    setWalletModalOpen(false);
    try {
      const provider = await createWalletConnectProvider();
      const accounts = await requestWalletAccounts(provider);
      const address = accounts[0];
      if (!address) throw new Error("WalletConnect did not return an account.");

      const nextChainId = await ensureBradburyNetwork(provider);
      setWallet(address);
      setWalletName("WalletConnect");
      setWalletProvider(provider);
      setChainId(nextChainId);
      localStorage.setItem(SELECTED_WALLET_KEY, "walletconnect");
      notify("Connected via WalletConnect.", "good");
    } catch (error) {
      notify(formatContractError(error), "bad");
    }
  }

  function disconnectWallet() {
    if (walletProvider) {
      void disconnectWalletConnect(walletProvider);
    }
    setWallet("");
    setWalletName("");
    setWalletProvider(null);
    setChainId("");
    localStorage.removeItem(SELECTED_WALLET_KEY);
    notify("Wallet disconnected from TruthGuard.", "info");
  }

  async function switchToBradbury() {
    if (!walletProvider) return notify("Connect a wallet first.", "bad");
    try {
      const nextChainId = await ensureBradburyNetwork(walletProvider);
      setChainId(nextChainId);
      notify("Switched to GenLayer Bradbury.", "good");
    } catch (error) {
      notify(formatContractError(error), "bad");
    }
  }

  async function verify() {
    if (!claim.trim()) return notify("Add a claim first.", "bad");
    if (claim.trim().length < 12) return notify("Use a more specific claim.", "bad");
    if (evidenceInvalid) return notify("Fix the evidence URL first.", "bad");
    if (!wallet || !walletProvider) return notify("Connect your wallet before verifying a claim.", "bad");
    if (readRate() >= RATE_LIMIT) return notify("Rate limit reached for this hour.", "bad");

    setBusy(true);
    setResult(null);
    setAdvanced(false);

    try {
      setStep(0);
      setStatus("Checking facts...");
      const nextChainId = await ensureBradburyNetwork(walletProvider);
      setChainId(nextChainId);
      const contractResponse = await verifyClaimWithContract({
        claim: claim.trim(),
        url: evidenceUrl,
        from: wallet,
        provider: walletProvider,
        contractAddress
      });
      setStep(1);
      setStatus("Transaction submitted. Waiting for Bradbury consensus...");

const contractResult = await waitForContractResult({
  txHash: contractResponse.txHash,
  contractAddress,
  expectedClaim: claim.trim(),
  onStatus: (status) => setStatus(status)
});

      setStep(2);
      setStatus("Reading contract result...");
      const next = createVerificationResult({
        contractResult,
        txHash: contractResponse.txHash,
        contractAddress,
        evidenceUrl
      });
      const nextHistory = [next, ...history.filter((item) => item.id !== next.id)].slice(0, 12);
      setHistory(nextHistory);
      setResult(next);
      writeHistory(nextHistory);
      writeRate(readRate() + 1);
      setRate(readRate());
      setStatus("Consensus complete.");
      notify("Verification complete.", "good");
      if (next.verdict !== "uncertain") confetti(next.verdict === "true" ? ["#34d399", "#2dd4bf"] : ["#fb7185", "#fda4af"]);
    } catch (error) {
      setStatus("Verification failed.");
      notify(formatContractError(error), "bad");
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    notify(`${label} copied.`, "good");
  }

  async function share(item: VerificationResult) {
    await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?result=${item.id}`);
    notify("Share link copied.", "good");
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--tg-bg)] text-[var(--tg-text)]">
      {/* Ambient background */}
      <div aria-hidden className="pointer-events-none fixed inset-0" style={{ background: "var(--tg-glow)" }} />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-60"
        style={{
          backgroundImage:
            "linear-gradient(var(--tg-grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--tg-grid-line) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(80% 60% at 50% 0%, black, transparent)",
          WebkitMaskImage: "radial-gradient(80% 60% at 50% 0%, black, transparent)"
        }}
      />
      {toast ? <ToastView toast={toast} /> : null}
      {busy ? <Progress step={step} status={status} /> : null}

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--tg-accent-line)] bg-[var(--tg-accent-soft)] text-[var(--tg-accent)]">
              <ShieldCheck size={20} strokeWidth={2.2} />
            </div>
            <div className="leading-tight">
              <p className="text-[15px] font-extrabold tracking-tight text-[var(--tg-text)]">TruthGuard</p>
              <p className="text-xs text-[var(--tg-muted)]">Decentralized fact-checking</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {wallet ? (
              <span className={`tg-chip ${chainId.toLowerCase() === BRADBURY_CHAIN_ID_HEX ? "text-[var(--tg-true)]" : "text-[var(--tg-uncertain)]"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${chainId.toLowerCase() === BRADBURY_CHAIN_ID_HEX ? "bg-[var(--tg-true)]" : "bg-[var(--tg-uncertain)]"}`} />
                {formatChainLabel(chainId)}
              </span>
            ) : null}
            <IconButton label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </IconButton>
            {wallet ? (
              <Button variant="ghost" onClick={disconnectWallet}>
                Disconnect
              </Button>
            ) : null}
            <Button onClick={() => void connectWallet()}>
              <Wallet size={16} />
              {wallet ? truncateMiddle(wallet) : "Connect Wallet"}
            </Button>
          </div>
        </header>

        {/* Hero */}
        <section className="py-12 sm:py-16">
          <div className="max-w-2xl animate-[fadeUp_500ms_ease-out]">
            <span className="tg-chip mb-5 border-[var(--tg-accent-line)] text-[var(--tg-accent)]">
              <Sparkles size={12} /> GenLayer intelligent contracts · Bradbury Testnet
            </span>
            <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight text-[var(--tg-text)] sm:text-5xl">
              Verify any claim with{" "}
              <span className="text-[var(--tg-accent)]">decentralized AI consensus.</span>
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-[var(--tg-text-soft)] sm:text-lg">
              Submit a claim, attach evidence, and let independent AI validators fetch the sources,
              analyze them, and agree before a verdict is recorded on-chain. No browser-side guesswork — ever.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {["Evidence fetched on-chain", "Validators must agree", "Verdict stored immutably"].map((signal) => (
                <span key={signal} className="tg-chip">
                  <Check size={12} className="text-[var(--tg-accent)]" /> {signal}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Main grid */}
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="space-y-6">
            {/* Claim checker */}
            <div className="tg-card p-5 sm:p-6">
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-[var(--tg-text)]">New verification</h2>
                  <p className="mt-0.5 text-sm text-[var(--tg-muted)]">Tip: press <kbd className="rounded border border-[var(--tg-line)] bg-[var(--tg-surface-raised)] px-1.5 py-0.5 font-sans text-[11px] text-[var(--tg-text-soft)]">⌘/Ctrl</kbd> + <kbd className="rounded border border-[var(--tg-line)] bg-[var(--tg-surface-raised)] px-1.5 py-0.5 font-sans text-[11px] text-[var(--tg-text-soft)]">Enter</kbd> to verify.</p>
                </div>
                <span className="tg-chip shrink-0">
                  <Gauge size={13} className="text-[var(--tg-accent)]" />
                  {checksRemaining} checks left this hour
                </span>
              </div>

              <textarea
                className="min-h-40 w-full resize-none rounded-xl border border-[var(--tg-line)] bg-[var(--tg-surface-raised)] px-4 py-3.5 text-[15px] leading-7 text-[var(--tg-text)] outline-none transition placeholder:text-[var(--tg-muted)] focus:border-[var(--tg-accent-line)]"
                value={claim}
                maxLength={MAX}
                onChange={(event) => setClaim(event.target.value)}
                placeholder="Paste a claim, headline, product promise, crypto news item, health statement, or public quote..."
              />
              <div className="mt-2 flex justify-between text-xs text-[var(--tg-muted)]">
                <span className={claim.trim().length >= 12 ? "text-[var(--tg-text-soft)]" : ""}>
                  {claim.trim().length < 12 ? "Minimum 12 characters." : "Ready for validator review."}
                </span>
                <span className="tabular-nums">
                  {claim.length}/{MAX}
                </span>
              </div>

              <div className="mt-6 flex items-center justify-between">
                <p className="text-sm font-semibold text-[var(--tg-text)]">Evidence URL</p>
                <span className="tg-chip">Optional</span>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_2.75rem]">
                <input
                  className="h-11 w-full rounded-xl border border-[var(--tg-line)] bg-[var(--tg-surface-raised)] px-3.5 text-sm text-[var(--tg-text)] outline-none transition placeholder:text-[var(--tg-muted)] focus:border-[var(--tg-accent-line)]"
                  value={evidenceUrl}
                  onChange={(event) => setEvidenceUrl(event.target.value)}
                  placeholder="https://source.example/article"
                />
                <IconButton label="Clear" onClick={() => setEvidenceUrl("")}>
                  <X size={16} />
                </IconButton>
                {evidenceUrl.trim() ? <UrlPreview url={evidenceUrl.trim()} /> : null}
              </div>

              <div className="mt-6 border-t border-[var(--tg-line)] pt-5">
                <p className="tg-label mb-3">Try an example</p>
                <div className="flex flex-wrap gap-2">
                  {exampleClaims.map((example) => (
                    <button
                      key={example}
                      onClick={() => setClaim(example)}
                      className="rounded-lg border border-[var(--tg-line)] bg-[var(--tg-surface-raised)] px-3 py-2 text-left text-xs font-medium text-[var(--tg-text-soft)] transition hover:border-[var(--tg-accent-line)] hover:text-[var(--tg-text)]"
                    >
                      {example.length > 54 ? `${example.slice(0, 54)}...` : example}
                    </button>
                  ))}
                </div>
              </div>

              <Button
                big
                className="mt-6 w-full"
                disabled={!canVerify}
                onClick={() => void verify()}
              >
                <SearchCheck size={18} /> Verify with AI Consensus
                <ArrowRight size={17} className="ml-1 opacity-70" />
              </Button>
            </div>

            {/* Result */}
            {result ? (
              <Result item={result} advanced={advanced} setAdvanced={setAdvanced} copy={copy} share={share} reset={() => {
                setClaim("");
                setEvidenceUrl("");
                setResult(null);
              }} />
            ) : (
              <div className="tg-card p-6">
                <div className="h-24 animate-pulse rounded-lg bg-[var(--tg-surface-raised)]" />
              </div>
            )}
          </div>

          {/* Sidebar */}
          <aside className="space-y-6">
            <div className="tg-card p-5">
              <p className="flex items-center gap-2 font-bold tracking-tight text-[var(--tg-text)]">
                <Settings size={16} className="text-[var(--tg-accent)]" /> Session
              </p>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--tg-line)] bg-[var(--tg-surface-raised)] px-3 py-2.5">
                  <span className="text-[var(--tg-muted)]">Wallet</span>
                  <span className="font-semibold text-[var(--tg-text)]">{walletName || "Not connected"}</span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--tg-line)] bg-[var(--tg-surface-raised)] px-3 py-2.5">
                  <span className="text-[var(--tg-muted)]">Network</span>
                  <span className={`font-semibold ${chainId.toLowerCase() === BRADBURY_CHAIN_ID_HEX ? "text-[var(--tg-true)]" : "text-[var(--tg-uncertain)]"}`}>
                    {formatChainLabel(chainId)}
                  </span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => void switchToBradbury()}>
                  <PlugZap size={15} /> Switch to Bradbury
                </Button>
                <Button variant="ghost" onClick={disconnectWallet}>
                  Clear session
                </Button>
              </div>
            </div>

            <div className="tg-card p-5">
              <p className="font-bold tracking-tight text-[var(--tg-text)]">Contract</p>
              <p className="mt-1 text-xs leading-5 text-[var(--tg-muted)]">
                Live TruthGuard deployment on Bradbury. Paste another address to point the app elsewhere.
              </p>
              <input
                className="mt-4 h-11 w-full rounded-xl border border-[var(--tg-line)] bg-[var(--tg-surface-raised)] px-3 font-mono text-xs text-[var(--tg-text)] outline-none transition focus:border-[var(--tg-accent-line)]"
                value={contractAddress}
                onChange={(event) => setContractAddress(event.target.value)}
              />
            </div>

            <HistoryPanel history={history} setHistory={setHistory} setClaim={setClaim} setResult={setResult} />
          </aside>
        </section>

        {/* Footer */}
        <footer className="mt-12 flex flex-col gap-4 border-t border-[var(--tg-line)] py-8 text-sm text-[var(--tg-muted)] md:flex-row md:items-center md:justify-between">
          <span>TruthGuard · Decentralized AI fact-checking on GenLayer Bradbury Testnet.</span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <a href="https://docs.genlayer.com" target="_blank" className="transition hover:text-[var(--tg-text)]">Docs</a>
            <a href="https://explorer-bradbury.genlayer.com" target="_blank" className="transition hover:text-[var(--tg-text)]">Explorer</a>
            <a href="https://github.com/genlayerlabs" target="_blank" className="transition hover:text-[var(--tg-text)]">GitHub</a>
            <a href="https://docs.genlayer.com/developers/testnet" target="_blank" className="transition hover:text-[var(--tg-text)]">Built for Bradbury Testnet</a>
          </div>
        </footer>
      </div>

      <AuthorCorner />
      {walletModalOpen ? (
        <WalletModal
          wallets={walletOptions}
          walletConnectAvailable={isWalletConnectConfigured()}
          onClose={() => setWalletModalOpen(false)}
          onSelect={(walletOption) => void connectSelectedWallet(walletOption)}
          onWalletConnect={() => void connectWalletConnect()}
        />
      ) : null}
    </main>
  );
}

function Result({ item, advanced, setAdvanced, copy, share, reset }: {
  item: VerificationResult;
  advanced: boolean;
  setAdvanced: (value: boolean) => void;
  copy: (text: string, label: string) => void;
  share: (item: VerificationResult) => void;
  reset: () => void;
}) {
  return (
    <div className="tg-card animate-[verdictReveal_420ms_ease-out] p-5 sm:p-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <span className="tg-chip mb-3 border-[var(--tg-accent-line)] text-[var(--tg-accent)]">
            <CheckCircle2 size={13} /> Consensus reached on-chain
          </span>
          <h3 className={`text-4xl font-extrabold uppercase tracking-tight ${verdictTextClass(item.verdict)}`}>{label(item.verdict)}</h3>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--tg-text-soft)]">{item.explanation}</p>

          {item.confidence !== undefined ? (
            <div className="mt-5 max-w-md">
              <div className="flex items-center justify-between text-xs text-[var(--tg-muted)]">
                <span>Consensus confidence</span>
                <span className="font-bold text-[var(--tg-text)]">{item.confidence}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--tg-surface-raised)]">
                <div className={`h-full rounded-full ${verdictBarClass(item.verdict)}`} style={{ width: `${item.confidence}%` }} />
              </div>
            </div>
          ) : (
            <p className="mt-4 text-xs text-[var(--tg-muted)]">Confidence was not recorded by this contract.</p>
          )}

          <a href={genlayerExplorerTxUrl(item.txHash)} target="_blank" className="mt-5 inline-flex items-center gap-2 rounded-lg border border-[var(--tg-line)] px-3 py-2 text-xs font-medium text-[var(--tg-text-soft)] transition hover:border-[var(--tg-accent-line)] hover:text-[var(--tg-text)]">
            {truncateMiddle(item.txHash, 10, 8)} <ExternalLink size={13} />
          </a>
        </div>
        <div className="flex flex-row flex-wrap gap-2 lg:flex-col lg:items-stretch">
          <Button onClick={() => void share(item)}><Share2 size={15} /> Share result</Button>
          <Button variant="ghost" onClick={() => void copy(item.claim, "Claim")}><Copy size={15} /> Copy claim</Button>
          <Button variant="ghost" onClick={() => void copy(JSON.stringify(item, null, 2), "Full result")}><Copy size={15} /> Copy JSON</Button>
          <Button variant="ghost" onClick={reset}><RefreshCw size={15} /> New check</Button>
        </div>
      </div>

      {item.evidence.length ? (
        <div className="mt-6 space-y-3 border-t border-[var(--tg-line)] pt-5">
          <p className="tg-label">Evidence analyzed</p>
          {item.evidence.map((source) => (
            <a key={source.url} href={source.url} target="_blank" className="block rounded-lg border border-[var(--tg-line)] bg-[var(--tg-surface-raised)] p-4 transition hover:border-[var(--tg-accent-line)]">
              <div className="flex items-center justify-between gap-3">
                <b className="truncate text-sm text-[var(--tg-text)]">{source.title || source.url}</b>
                {source.reliability !== undefined ? (
                  <span className="shrink-0 text-xs font-semibold text-[var(--tg-accent)]">{source.reliability}% reliable</span>
                ) : null}
              </div>
              {source.excerpt ? <p className="mt-2 text-sm leading-6 text-[var(--tg-muted)]">{source.excerpt}</p> : null}
            </a>
          ))}
        </div>
      ) : null}

      <button className="mt-5 flex w-full items-center justify-between border-t border-[var(--tg-line)] pt-4 text-xs font-semibold text-[var(--tg-muted)] transition hover:text-[var(--tg-text)]" onClick={() => setAdvanced(!advanced)}>
        Raw contract response
        <span className={`transition-transform ${advanced ? "rotate-180" : ""}`}>▾</span>
      </button>
      {advanced ? <pre className="mt-4 max-h-80 overflow-auto rounded-xl border border-[var(--tg-line)] bg-[var(--tg-surface-raised)] p-4 text-xs leading-5 text-[var(--tg-text-soft)]">{JSON.stringify(item, null, 2)}</pre> : null}
    </div>
  );
}

function HistoryPanel({ history, setHistory, setClaim, setResult }: {
  history: VerificationResult[];
  setHistory: (items: VerificationResult[]) => void;
  setClaim: (claim: string) => void;
  setResult: (item: VerificationResult) => void;
}) {
  return (
    <div className="tg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="flex items-center gap-2 font-bold tracking-tight text-[var(--tg-text)]">
          <History size={16} className="text-[var(--tg-accent)]" /> Recent checks
        </p>
        {history.length ? (
          <IconButton label="Clear history" onClick={() => { setHistory([]); writeHistory([]); }}><Trash2 size={15} /></IconButton>
        ) : null}
      </div>
      {history.length ? (
        <div className="space-y-2">
          {history.map((item) => (
            <button key={item.id} onClick={() => { setResult(item); setClaim(item.claim); }} className="w-full rounded-lg border border-[var(--tg-line)] bg-[var(--tg-surface-raised)] p-3 text-left transition hover:border-[var(--tg-accent-line)]">
              <div className="flex items-center justify-between gap-2 text-xs">
                <b className={verdictTextClass(item.verdict)}>{label(item.verdict)}</b>
                <span className="text-[var(--tg-muted)]">{item.confidence !== undefined ? `${item.confidence}%` : "—"}</span>
              </div>
              <p className="mt-1.5 line-clamp-2 text-sm font-medium text-[var(--tg-text)]">{item.claim}</p>
            </button>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-[var(--tg-line)] p-4 text-sm leading-6 text-[var(--tg-muted)]">
          Verifications you run are stored privately in this browser.
        </p>
      )}
    </div>
  );
}

function UrlPreview({ url }: { url: string }) {
  const valid = isValidUrl(url);
  return (
    <div className={`sm:col-span-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${valid ? "border-[var(--tg-accent-line)] bg-[var(--tg-accent-soft)] text-[var(--tg-accent)]" : "border-[var(--tg-false-soft)] bg-[var(--tg-false-soft)] text-[var(--tg-false)]"}`}>
      <Link2 size={13} />
      {valid ? new URL(url).host : "Invalid URL"}
    </div>
  );
}

function Progress({ step, status }: { step: number; status: string }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-4 backdrop-blur-md">
      <div className="tg-card w-full max-w-2xl animate-[modalIn_220ms_ease-out] p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[var(--tg-accent-line)] bg-[var(--tg-accent-soft)]">
            <Loader2 className="animate-spin text-[var(--tg-accent)]" size={24} />
          </div>
          <div>
            <p className="tg-label">Verification in progress</p>
            <h2 className="mt-1.5 text-xl font-bold tracking-tight text-[var(--tg-text)] sm:text-2xl">Validators are reaching consensus</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--tg-text-soft)]">{status}</p>
          </div>
        </div>
        <div className="mt-7 space-y-3">
          {verificationSteps.map((item, index) => (
            <div key={item.title} className={`flex items-start gap-3 rounded-xl border p-3.5 ${index <= step ? "border-[var(--tg-accent-line)] bg-[var(--tg-accent-soft)]" : "border-[var(--tg-line)] bg-[var(--tg-surface-raised)]"}`}>
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm font-bold ${index < step ? "border-[var(--tg-accent-line)] bg-[var(--tg-accent-soft)] text-[var(--tg-accent)]" : index === step ? "border-[var(--tg-accent-line)] bg-[var(--tg-accent)] text-[var(--tg-accent-ink)]" : "border-[var(--tg-line)] text-[var(--tg-muted)]"}`}>
                {index < step ? <Check size={15} /> : index + 1}
              </div>
              <div>
                <p className="font-semibold text-[var(--tg-text)]">{item.title}</p>
                <p className="mt-0.5 text-sm leading-5 text-[var(--tg-muted)]">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ToastView({ toast }: { toast: NonNullable<Toast> }) {
  const tone = toast.tone === "bad"
    ? "border-[var(--tg-false)]/40 bg-[var(--tg-false-soft)] text-[var(--tg-false)]"
    : toast.tone === "good"
      ? "border-[var(--tg-true)]/40 bg-[var(--tg-true-soft)] text-[var(--tg-true)]"
      : "border-[var(--tg-accent-line)] bg-[var(--tg-accent-soft)] text-[var(--tg-accent)]";
  return (
    <div className={`fixed right-4 top-4 z-50 max-w-sm animate-[toastIn_200ms_ease-out] rounded-xl border px-4 py-3 text-sm font-semibold shadow-[var(--tg-shadow)] backdrop-blur-xl ${tone}`}>
      {toast.text}
    </div>
  );
}

function WalletModal({ wallets, walletConnectAvailable, onClose, onSelect, onWalletConnect }: {
  wallets: WalletOption[];
  walletConnectAvailable: boolean;
  onClose: () => void;
  onSelect: (wallet: WalletOption) => void;
  onWalletConnect: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-md">
      <div className="tg-card w-full max-w-md animate-[modalIn_220ms_ease-out] p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-bold tracking-tight text-[var(--tg-text)]">Connect a wallet</p>
            <p className="mt-1 text-sm text-[var(--tg-muted)]">
              Pick a detected wallet, or scan a QR code with your mobile wallet.
            </p>
          </div>
          <IconButton label="Close wallet selector" onClick={onClose}><X size={16} /></IconButton>
        </div>
        <div className="mt-5 space-y-2">
          {wallets.map((walletOption) => (
            <button
              key={walletOption.id}
              type="button"
              onClick={() => onSelect(walletOption)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--tg-line)] bg-[var(--tg-surface-raised)] p-3.5 text-left transition hover:border-[var(--tg-accent-line)] hover:bg-[var(--tg-accent-soft)]"
            >
              <span className="flex min-w-0 items-center gap-3">
                {walletOption.icon ? <img src={walletOption.icon} alt="" className="h-8 w-8 rounded-lg" /> : <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--tg-accent-line)] bg-[var(--tg-accent-soft)] text-[var(--tg-accent)]"><Wallet size={17} /></span>}
                <span className="min-w-0">
                  <span className="block font-semibold text-[var(--tg-text)]">{walletOption.name}</span>
                  {walletOption.rdns ? <span className="block truncate text-xs text-[var(--tg-muted)]">{walletOption.rdns}</span> : null}
                </span>
              </span>
              <ArrowRight size={15} className="shrink-0 text-[var(--tg-muted)]" />
            </button>
          ))}

          {wallets.length ? (
            <div className="flex items-center gap-3 py-1">
              <span className="h-px flex-1 bg-[var(--tg-line)]" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--tg-muted)]">or</span>
              <span className="h-px flex-1 bg-[var(--tg-line)]" />
            </div>
          ) : null}

          <button
            type="button"
            onClick={onWalletConnect}
            disabled={!walletConnectAvailable}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--tg-line)] bg-[var(--tg-surface-raised)] p-3.5 text-left transition hover:border-[var(--tg-accent-line)] hover:bg-[var(--tg-accent-soft)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--tg-accent-line)] bg-[var(--tg-accent-soft)]">
                <WalletConnectLogo />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-[var(--tg-text)]">WalletConnect</span>
                <span className="block truncate text-xs text-[var(--tg-muted)]">
                  {walletConnectAvailable ? "Scan a QR code with your mobile wallet" : "Configure NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to enable"}
                </span>
              </span>
            </span>
            <ArrowRight size={15} className="shrink-0 text-[var(--tg-muted)]" />
          </button>
        </div>
      </div>
    </div>
  );
}

function WalletConnectLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.91 7.51c4.76-4.66 12.42-4.66 17.18 0l.57.56c.24.23.24.6 0 .83l-1.96 1.92a.29.29 0 0 1-.41 0l-.79-.77c-3.31-3.24-8.7-3.24-12.01 0l-.84.83a.29.29 0 0 1-.41 0L4.34 8.96a.59.59 0 0 1 0-.83l.57-.62Zm21.22 3.98 1.74 1.71c.24.23.24.6 0 .83l-7.86 7.7a.58.58 0 0 1-.83 0l-5.58-5.47a.15.15 0 0 0-.2 0l-5.58 5.47a.58.58 0 0 1-.83 0l-7.86-7.7a.59.59 0 0 1 0-.83l1.74-1.71c.24-.23.62-.23.86 0l5.58 5.47c.06.05.14.05.2 0l5.58-5.47c.24-.23.62-.23.86 0l5.58 5.47c.06.05.14.05.2 0l5.58-5.47a.59.59 0 0 1 .86 0Z"
        transform="translate(1.5 0)"
        fill="#3396FF"
      />
    </svg>
  );
}

function AuthorCorner() {
  return (
    <div className="fixed bottom-3 right-3 z-20 hidden items-center gap-1 rounded-lg border border-[var(--tg-line)] bg-[var(--tg-surface)]/90 px-3 py-2 text-xs font-medium text-[var(--tg-muted)] shadow-[var(--tg-shadow)] backdrop-blur-xl sm:flex">
      <span className="text-[var(--tg-text)]">onchaindc</span>
      {AUTHOR_LINKS.map((link) => (
        <a key={link.label} href={link.href} target="_blank" rel="noreferrer" className="ml-2 transition hover:text-[var(--tg-accent)]">
          {link.label}
        </a>
      ))}
    </div>
  );
}

function Button({ children, big, variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { big?: boolean; variant?: "primary" | "ghost" }) {
  const tone = variant === "ghost"
    ? "border-[var(--tg-line)] bg-transparent text-[var(--tg-text-soft)] hover:border-[var(--tg-accent-line)] hover:text-[var(--tg-text)]"
    : "border-transparent bg-[var(--tg-accent)] text-[var(--tg-accent-ink)] hover:opacity-90";

  return <button {...props} className={`${big ? "min-h-12 px-5 text-[15px]" : "min-h-10 px-4 text-sm"} inline-flex items-center justify-center gap-2 rounded-xl border font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${tone} ${props.className || ""}`}>{children}</button>;
}

function IconButton({ children, label, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button aria-label={label} title={label} {...props} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--tg-line)] bg-transparent text-[var(--tg-text-soft)] transition hover:border-[var(--tg-accent-line)] hover:text-[var(--tg-text)]">{children}</button>;
}

function label(value: string) {
  return value === "true" ? "True" : value === "false" ? "False" : "Uncertain";
}

function verdictTextClass(value: string) {
  return value === "true" ? "text-[var(--tg-true)]" : value === "false" ? "text-[var(--tg-false)]" : "text-[var(--tg-uncertain)]";
}

function verdictBarClass(value: string) {
  return value === "true" ? "bg-[var(--tg-true)]" : value === "false" ? "bg-[var(--tg-false)]" : "bg-[var(--tg-uncertain)]";
}

function readHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") as VerificationResult[]; } catch { return []; }
}

function writeHistory(items: VerificationResult[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
}

function hourKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
}

function readRate() {
  try {
    const item = JSON.parse(localStorage.getItem(RATE_KEY) || "null") as { hour: string; count: number } | null;
    return item?.hour === hourKey() ? item.count : 0;
  } catch {
    return 0;
  }
}

function writeRate(count: number) {
  localStorage.setItem(RATE_KEY, JSON.stringify({ hour: hourKey(), count }));
}

async function waitForContractResult({
  txHash,
  contractAddress,
  expectedClaim,
  onStatus
}: {
  txHash: string;
  contractAddress: string;
  expectedClaim: string;
  onStatus?: (status: string) => void;
}) {
  // Bradbury consensus on a web-fetching, LLM-running contract can take
  // several minutes (validators independently fetch the evidence and must
  // reach equivalence). Poll up to ~8 minutes and only report a failure when
  // the network actually decided — never when it is still working.
  const MAX_ATTEMPTS = 190;
  let lastError = "Timed out waiting for Bradbury consensus.";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const tx = await getGenLayerTransactionState(txHash);
      onStatus?.(`Waiting for validator consensus (${Math.round(((attempt + 1) / MAX_ATTEMPTS) * 100)}%) — validators are independently reviewing the evidence...`);

      // Accept any finalized state: ACCEPTED, FINALIZED, or failed
      if (tx.status === "ACCEPTED" || tx.status === "FINALIZED" || !tx.pending || tx.failed) {
        if (tx.failed) {
          throw new Error("Transaction failed on Bradbury.");
        }

        const result = await readLastResult(contractAddress);
        const matchesClaim =
          result.claim?.trim().toLowerCase() === expectedClaim.trim().toLowerCase();
        const validVerdict =
          result.verdict && ["true", "false", "uncertain"].includes(result.verdict.toLowerCase());

        if (matchesClaim && validVerdict) {
          return result;
        }

        // The network finalized but the latest recorded result is not ours
        // (e.g. another verification landed in between). Surface the real
        // state instead of inventing a result.
        throw new Error(
          `Bradbury finalized the transaction, but the contract's latest recorded result does not match this claim. ` +
            `Track the transaction here: ${genlayerExplorerTxUrl(txHash)}.`
        );
      }
    } catch (err) {
      if (err instanceof Error) {
        lastError = err.message;
      }
    }

    await delay(2500);
  }

  // The transaction never finalized. Say exactly that, with a link, instead
  // of a generic failure.
  throw new Error(
    `Bradbury validators are still reviewing this claim — the transaction is pending after several minutes. ` +
      `You can track it here: ${genlayerExplorerTxUrl(txHash)}.`
  );
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function confetti(colors: string[]) {
  const layer = document.createElement("div");
  layer.className = "confetti-layer";
  document.body.appendChild(layer);
  for (let index = 0; index < 42; index += 1) {
    const piece = document.createElement("span");
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[index % colors.length];
    piece.style.animationDelay = `${Math.random() * 180}ms`;
    piece.style.setProperty("--fall-x", `${Math.random() * 160 - 80}px`);
    layer.appendChild(piece);
  }
  setTimeout(() => layer.remove(), 1800);
}
