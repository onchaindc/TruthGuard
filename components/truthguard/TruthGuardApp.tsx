"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink as ExternalLinkIcon,
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
import { truncateMiddle } from "@/lib/utils";

type Evidence = { id: string; url: string };
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
  const [evidence, setEvidence] = useState<Evidence[]>([{ id: cryptoId(), url: "" }]);
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

  const urls = useMemo(
    () => evidence.map((item) => item.url.trim()).filter((url) => url && isValidUrl(url)),
    [evidence]
  );
  const invalidUrls = evidence.filter((item) => item.url.trim() && !isValidUrl(item.url.trim())).length;
  const canVerify = claim.trim().length >= 12 && invalidUrls === 0 && !busy;
  const evidenceUrl = urls[0] || "";

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
    const timer = window.setTimeout(() => setToast(null), 3000);
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

  function disconnectWallet() {
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
    if (invalidUrls) return notify("Fix invalid evidence URLs first.", "bad");
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
  expectedClaim: claim.trim()
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
      if (next.verdict !== "uncertain") confetti(next.verdict === "true" ? ["#5eead4", "#34d399"] : ["#fb7185", "#fda4af"]);
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
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(34,211,238,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,.08)_1px,transparent_1px)] bg-[size:44px_44px] opacity-40" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_50%_0%,rgba(16,185,129,.22),transparent_58%)]" />
      {toast ? <ToastView toast={toast} /> : null}
      {busy ? <Progress step={step} status={status} /> : null}

      <div className="relative z-10 mx-auto flex max-w-7xl flex-col gap-6 px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-200">
              <ShieldCheck size={22} />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[.22em] text-cyan-200">TruthGuard</p>
              <h1 className="text-lg font-black text-white">AI Fact Checker on GenLayer Bradbury</h1>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <IconButton label="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? <Moon size={17} /> : <Sun size={17} />}
            </IconButton>
            <Button onClick={() => void connectWallet()}>
              <Wallet size={17} />
              {wallet ? truncateMiddle(wallet) : "Connect Wallet"}
            </Button>
            {wallet ? (
              <Button variant="muted" onClick={disconnectWallet}>
                Disconnect
              </Button>
            ) : null}
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_23rem]">
          <div className="space-y-6">
            <section className="grid gap-5 py-4 md:grid-cols-[minmax(0,1fr)_18rem] md:items-end">
              <div>
                <Badge>
                  <Sparkles size={14} /> Powered by decentralized AI consensus
                </Badge>
                <h2 className="mt-4 max-w-4xl text-4xl font-black leading-[1.02] text-white sm:text-5xl lg:text-6xl">
                  Verify Any Claim with Decentralized AI Consensus
                </h2>
                <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--tg-muted)] sm:text-lg">
                  Submit a claim, attach evidence, and let GenLayer-style intelligent contracts coordinate independent AI validators on Bradbury Testnet.
                </p>
              </div>
              <Card>
                <p className="font-bold text-white">How it works</p>
                {["Evidence fetched via the GenLayer web oracle", "AI analysis with validator consensus", "Verdict & reasoning stored on-chain"].map((signal) => (
                  <div key={signal} className="mt-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-[var(--tg-muted)]">
                    {signal}
                  </div>
                ))}
              </Card>
            </section>

            <Card>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-bold text-cyan-100">Claim checker</p>
                  <p className="mt-1 text-sm text-[var(--tg-muted)]">Press Cmd/Ctrl + Enter from anywhere to verify.</p>
                </div>
                <Badge>
                  <Gauge size={14} /> {Math.max(0, RATE_LIMIT - rate)}/{RATE_LIMIT} checks left this hour
                </Badge>
              </div>

              <textarea
                className="min-h-40 w-full resize-none rounded-lg border border-white/10 bg-slate-950/60 px-4 py-3 text-base leading-7 text-white outline-none focus:border-cyan-300"
                value={claim}
                maxLength={MAX}
                onChange={(event) => setClaim(event.target.value)}
                placeholder="Paste a claim, headline, product promise, crypto news item, health statement, or public quote..."
              />
              <div className="mt-2 flex justify-between text-xs text-[var(--tg-muted)]">
                <span>{claim.trim().length < 12 ? "Minimum 12 characters." : "Ready for validator review."}</span>
                <span>
                  {claim.length}/{MAX}
                </span>
              </div>

              <div className="mt-5 flex items-center justify-between">
                <p className="text-sm font-bold text-white">Evidence URL</p>
                <span className="text-xs font-semibold text-[var(--tg-muted)]">Optional</span>
              </div>

              <div className="mt-3 space-y-3">
                {evidence.map((item, index) => (
                  <div key={item.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_2.5rem]">
                    <input
                      className="h-11 rounded-md border border-white/10 bg-slate-950/60 px-3 text-sm text-white outline-none focus:border-cyan-300"
                      value={item.url}
                      onChange={(event) => setEvidence((items) => items.map((x) => (x.id === item.id ? { ...x, url: event.target.value } : x)))}
                      placeholder={index === 0 ? "https://source.example/article" : "Add another source URL"}
                    />
                    <IconButton
                      label="Remove"
                      onClick={() => setEvidence((items) => (items.length === 1 ? [{ id: cryptoId(), url: "" }] : items.filter((x) => x.id !== item.id)))}
                    >
                      <X size={16} />
                    </IconButton>
                    {item.url.trim() ? <UrlPreview url={item.url.trim()} /> : null}
                  </div>
                ))}
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="flex flex-wrap gap-2">
                  {exampleClaims.map((example) => (
                    <button
                      key={example}
                      onClick={() => setClaim(example)}
                      className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-left text-xs font-bold text-slate-200 hover:bg-cyan-300/10"
                    >
                      {example.length > 54 ? `${example.slice(0, 54)}...` : example}
                    </button>
                  ))}
                </div>
                <Button big disabled={!canVerify} onClick={() => void verify()}>
                  <SearchCheck size={19} /> Verify with AI Consensus
                </Button>
              </div>
            </Card>

            {result ? (
              <Result item={result} advanced={advanced} setAdvanced={setAdvanced} copy={copy} share={share} reset={() => {
                setClaim("");
                setEvidence([{ id: cryptoId(), url: "" }]);
                setResult(null);
              }} />
            ) : (
              <Card><div className="h-24 animate-pulse rounded-lg bg-white/10" /></Card>
            )}
          </div>

          <aside className="space-y-6">
            <Card>
              <p className="font-bold text-white">Contract</p>
              <p className="mt-1 text-xs text-[var(--tg-muted)]">Use the deployed FactChecker or paste another address.</p>
              <input className="mt-4 h-11 w-full rounded-md border border-white/10 bg-slate-950/60 px-3 font-mono text-xs text-white outline-none" value={contractAddress} onChange={(event) => setContractAddress(event.target.value)} />
            </Card>
            <Card>
              <p className="flex items-center gap-2 font-bold text-white"><Settings size={17} /> Settings</p>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/5 px-3 py-2">
                  <span className="text-[var(--tg-muted)]">Wallet</span>
                  <span className="font-bold text-white">{walletName || "Not connected"}</span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/5 px-3 py-2">
                  <span className="text-[var(--tg-muted)]">Network</span>
                  <span className={`font-bold ${chainId.toLowerCase() === BRADBURY_CHAIN_ID_HEX ? "text-emerald-200" : "text-amber-200"}`}>
                    {formatChainLabel(chainId)}
                  </span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="muted" onClick={() => void switchToBradbury()}>
                  <PlugZap size={16} /> Switch Bradbury
                </Button>
                <Button variant="muted" onClick={disconnectWallet}>
                  Clear Session
                </Button>
              </div>
            </Card>
            <HistoryPanel history={history} setHistory={setHistory} setClaim={setClaim} setResult={setResult} />
          </aside>
        </section>

        <footer className="flex flex-col gap-3 border-t border-white/10 py-6 text-sm text-[var(--tg-muted)] md:flex-row md:items-center md:justify-between">
          <span>TruthGuard verifies claims with decentralized AI consensus.</span>
          <div className="flex flex-wrap gap-3">
            <a href="https://docs.genlayer.com" target="_blank" className="hover:text-white">Docs</a>
            <a href="https://explorer.genlayer.com" target="_blank" className="hover:text-white">GenLayer Explorer</a>
            <a href="https://github.com/genlayerlabs" target="_blank" className="hover:text-white">GitHub</a>
            <a href="https://docs.genlayer.com/developers/testnet" target="_blank" className="hover:text-white">Built for Bradbury Testnet</a>
          </div>
        </footer>
      </div>
      <AuthorCorner />
      {walletModalOpen ? (
        <WalletModal
          wallets={walletOptions}
          onClose={() => setWalletModalOpen(false)}
          onSelect={(walletOption) => void connectSelectedWallet(walletOption)}
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
    <Card className="animate-[verdictReveal_420ms_ease-out]">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div>
          <Badge><CheckCircle2 size={14} /> Consensus reached by GenLayer validators</Badge>
          <h3 className={`mt-3 text-5xl font-black uppercase ${verdictClass(item.verdict)}`}>{label(item.verdict)}</h3>
          <p className="mt-3 text-sm leading-6 text-slate-200">{item.explanation}</p>
          {item.confidence !== undefined ? (
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-[var(--tg-muted)]">
                <span>On-chain consensus confidence</span>
                <span className="font-bold text-white">{item.confidence}%</span>
              </div>
              <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-950/70">
                <div className={item.verdict === "true" ? "h-full bg-emerald-300" : item.verdict === "false" ? "h-full bg-rose-300" : "h-full bg-amber-300"} style={{ width: `${item.confidence}%` }} />
              </div>
            </div>
          ) : (
            <p className="mt-4 text-xs text-[var(--tg-muted)]">Confidence was not recorded by this contract.</p>
          )}
          <a href={genlayerExplorerTxUrl(item.txHash)} target="_blank" className="mt-4 inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs text-slate-200">
            {truncateMiddle(item.txHash, 10, 8)} <ExternalLink size={14} />
          </a>
        </div>
        <div className="space-y-2">
          <Button onClick={() => void share(item)}><Share2 size={16} /> Share Result</Button>
          <Button onClick={() => void copy(item.claim, "Claim")}><Copy size={16} /> Copy Claim</Button>
          <Button onClick={() => void copy(JSON.stringify(item, null, 2), "Full result")}><Copy size={16} /> Copy Full Result</Button>
          <Button onClick={reset}><RefreshCw size={16} /> Verify Another Claim</Button>
        </div>
      </div>
      <div className="mt-5 space-y-3">
        {item.evidence.map((source) => (
          <a key={source.url} href={source.url} target="_blank" className="block rounded-lg border border-white/10 bg-white/5 p-4 hover:bg-cyan-300/10">
            <div className="flex justify-between gap-3">
              <b className="truncate text-white">{source.title || source.url}</b>
              {source.reliability !== undefined ? (
                <span className="text-xs text-cyan-100">{source.reliability}% reliable</span>
              ) : null}
            </div>
            {source.excerpt ? <p className="mt-2 text-sm text-[var(--tg-muted)]">{source.excerpt}</p> : null}
          </a>
        ))}
      </div>
      <button className="mt-5 flex w-full items-center justify-between border-t border-white/10 pt-4 text-sm font-bold text-slate-200" onClick={() => setAdvanced(!advanced)}>
        Advanced raw contract response
      </button>
      {advanced ? <pre className="mt-4 max-h-80 overflow-auto rounded-lg bg-slate-950/75 p-4 text-xs text-cyan-50">{JSON.stringify(item, null, 2)}</pre> : null}
    </Card>
  );
}

function HistoryPanel({ history, setHistory, setClaim, setResult }: {
  history: VerificationResult[];
  setHistory: (items: VerificationResult[]) => void;
  setClaim: (claim: string) => void;
  setResult: (item: VerificationResult) => void;
}) {
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <p className="flex items-center gap-2 font-bold text-white"><History size={17} /> My Checks</p>
        <IconButton label="Clear history" onClick={() => { setHistory([]); writeHistory([]); }}><Trash2 size={16} /></IconButton>
      </div>
      {history.length ? (
        <div className="space-y-2">
          {history.map((item) => (
            <button key={item.id} onClick={() => { setResult(item); setClaim(item.claim); }} className="w-full rounded-lg border border-white/10 bg-white/5 p-3 text-left hover:bg-cyan-300/10">
              <div className="flex justify-between text-xs"><b className={verdictClass(item.verdict)}>{label(item.verdict)}</b><span>{item.confidence !== undefined ? `${item.confidence}%` : "—"}</span></div>
              <p className="mt-2 line-clamp-2 text-sm font-bold text-white">{item.claim}</p>
            </button>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-white/10 p-4 text-sm text-[var(--tg-muted)]">Recent verifications stay in localStorage on this device.</p>
      )}
    </Card>
  );
}

function UrlPreview({ url }: { url: string }) {
  const valid = isValidUrl(url);
  return (
    <div className={`sm:col-span-2 rounded-md border px-3 py-2 text-xs ${valid ? "border-cyan-300/20 bg-cyan-300/10 text-cyan-100" : "border-rose-300/25 bg-rose-300/10 text-rose-100"}`}>
      <Link2 className="mr-2 inline" size={14} />
      {valid ? new URL(url).host : "Invalid URL"}
    </div>
  );
}

function Progress({ step, status }: { step: number; status: string }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xl">
      <Card className="w-full max-w-2xl">
        <div className="flex gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10">
            <Loader2 className="animate-spin text-cyan-100" size={26} />
          </div>
          <div>
            <p className="text-sm font-bold uppercase tracking-[.22em] text-cyan-200">Verification in Progress</p>
            <h2 className="mt-2 text-2xl font-black text-white">GenLayer validators are reaching consensus</h2>
            <p className="mt-2 text-sm text-[var(--tg-muted)]">{status}</p>
          </div>
        </div>
        <div className="mt-7 space-y-3">
          {verificationSteps.map((item, index) => (
            <div key={item.title} className="flex gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-md border border-cyan-300/25 text-cyan-100">
                {index < step ? <Check size={16} /> : index + 1}
              </div>
              <div><p className="font-bold text-white">{item.title}</p><p className="text-sm text-[var(--tg-muted)]">{item.detail}</p></div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function ToastView({ toast }: { toast: NonNullable<Toast> }) {
  const tone = toast.tone === "bad" ? "border-rose-300/25 bg-rose-300/10" : toast.tone === "good" ? "border-emerald-300/25 bg-emerald-300/10" : "border-cyan-300/25 bg-cyan-300/10";
  return <div className={`fixed right-4 top-4 z-50 rounded-lg border px-4 py-3 text-sm font-bold backdrop-blur ${tone}`}>{toast.text}</div>;
}

function WalletModal({ wallets, onClose, onSelect }: { wallets: WalletOption[]; onClose: () => void; onSelect: (wallet: WalletOption) => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xl">
      <Card className="w-full max-w-md">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-black text-white">Select Wallet</p>
            <p className="mt-1 text-sm text-[var(--tg-muted)]">TruthGuard detected {wallets.length} available wallet{wallets.length === 1 ? "" : "s"}.</p>
          </div>
          <IconButton label="Close wallet selector" onClick={onClose}><X size={16} /></IconButton>
        </div>
        <div className="mt-5 space-y-2">
          {wallets.map((walletOption) => (
            <button
              key={walletOption.id}
              type="button"
              onClick={() => onSelect(walletOption)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 p-3 text-left transition hover:border-cyan-300/35 hover:bg-cyan-300/10"
            >
              <span className="flex min-w-0 items-center gap-3">
                {walletOption.icon ? <img src={walletOption.icon} alt="" className="h-8 w-8 rounded-md" /> : <Wallet size={24} className="text-cyan-100" />}
                <span>
                  <span className="block font-bold text-white">{walletOption.name}</span>
                  {walletOption.rdns ? <span className="block text-xs text-[var(--tg-muted)]">{walletOption.rdns}</span> : null}
                </span>
              </span>
              <ExternalLinkIcon size={15} className="shrink-0 text-[var(--tg-muted)]" />
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

function AuthorCorner() {
  return (
    <div className="fixed bottom-3 right-3 z-20 rounded-md border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-[var(--tg-muted)] backdrop-blur-xl">
      <span className="mr-2 text-white">onchaindc</span>
      {AUTHOR_LINKS.map((link) => (
        <a key={link.label} href={link.href} target="_blank" rel="noreferrer" className="ml-2 hover:text-cyan-100">
          {link.label}
        </a>
      ))}
    </div>
  );
}

function Button({ children, big, variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { big?: boolean; variant?: "primary" | "muted" }) {
  const tone = variant === "muted" ? "bg-white/10 text-white hover:bg-white/15" : "bg-cyan-300 text-slate-950 hover:bg-cyan-200";

  return <button {...props} className={`${big ? "min-h-12 px-5" : "min-h-10 px-4"} inline-flex items-center justify-center gap-2 rounded-md border border-white/10 text-sm font-bold disabled:opacity-45 ${tone} ${props.className || ""}`}>{children}</button>;
}

function IconButton({ children, label, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button aria-label={label} title={label} {...props} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/10 text-white hover:bg-white/15">{children}</button>;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-white/10 bg-white/[.075] p-5 shadow-[0_24px_90px_rgba(0,0,0,.28)] backdrop-blur-xl ${className}`}>{children}</div>;
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-2.5 py-1 text-xs font-bold text-cyan-100">{children}</span>;
}

function label(value: string) {
  return value === "true" ? "True" : value === "false" ? "False" : "Uncertain";
}

function verdictClass(value: string) {
  return value === "true" ? "text-emerald-200" : value === "false" ? "text-rose-200" : "text-amber-200";
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
  expectedClaim
}: {
  txHash: string;
  contractAddress: string;
  expectedClaim: string;
}) {
  let lastError = "Timed out waiting for Bradbury consensus.";

  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const tx = await getGenLayerTransactionState(txHash);
      console.log(`Attempt ${attempt}: Status =`, tx.status);

      // Accept any finalized state: ACCEPTED, FINALIZED, or failed
      if (tx.status === "ACCEPTED" || tx.status === "FINALIZED" || !tx.pending || tx.failed) {
        if (tx.failed) {
          throw new Error("Transaction failed on Bradbury.");
        }

        const result = await readLastResult(contractAddress);
        console.log("✅ Got result:", result);
        
        if (result.verdict && ["true", "false", "uncertain"].includes(result.verdict.toLowerCase())) {
          return result;
        }
      }
    } catch (err) {
      if (err instanceof Error) {
        lastError = err.message;
      }
    }

    await delay(2000);
  }

  throw new Error(lastError);
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function cryptoId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
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
