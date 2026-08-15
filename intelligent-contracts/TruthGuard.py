# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""TruthGuard — decentralized AI fact checker for GenLayer Bradbury Testnet.

Every `verify_claim(claim, url)` transaction:
  1. fetches the evidence URL through GenLayer's web oracle (if one is given),
  2. runs an independent LLM analysis inside a non-deterministic block,
  3. applies the equivalence principle so the network's validators must agree
     on the verdict, confidence, and evidence reliability before anything is
     recorded,
  4. stores the agreed result on-chain (verdict, confidence, reasoning,
     evidence analysis, requester, block number).

Nothing displayed by the frontend is fabricated: the app reads it back with
`get_last_result()`, which returns exactly what validators agreed on.
"""

import json
import re

from genlayer import *

# Verdicts / flags and all numeric values are stored as plain strings:
# GenVM persistent storage rejects bare `int` annotations (use bigint/u* or
# strings), and strings keep the schema portable across runtimes. The
# frontend parses the numeric strings for display.
_VERDICT_TRUE = "true"
_VERDICT_FALSE = "false"
_VERDICT_UNCERTAIN = "uncertain"
_YES = "true"
_NO = "false"

_MAX_CLAIM_LENGTH = 2000
_MAX_URL_LENGTH = 2048


def _is_http_url(value: str) -> bool:
    lowered = value.strip().lower()
    return lowered.startswith("http://") or lowered.startswith("https://")


def _parse_json_dict(json_str: str) -> dict:
    """Sanitize LLM JSON output.

    Keeps only the substring between the first `{` and the last `}`, drops
    trailing commas before closing braces/brackets, then parses.
    """
    if isinstance(json_str, dict):
        return json_str
    if not isinstance(json_str, str):
        return {}
    first_brace = json_str.find("{")
    last_brace = json_str.rfind("}")
    if first_brace == -1 or last_brace == -1:
        return {}
    json_str = json_str[first_brace : last_brace + 1]
    json_str = re.sub(r",(?!\s*?[\{\[\"\'\\w])", "", json_str)
    try:
        return json.loads(json_str)
    except Exception:
        return {}


def _clamp_score(value) -> str:
    """Normalize an LLM numeric score (0-100, rounded to the nearest 10)."""
    try:
        score = int(float(value))
    except Exception:
        return "0"
    score = min(100, max(0, score))
    return str(round(score / 10) * 10)


class TruthGuard(gl.Contract):
    # Persistent storage fields (strings only — see module docstring).
    last_claim: str
    last_url: str
    last_verdict: str
    last_confidence: str
    last_reasoning: str
    last_evidence_title: str
    last_evidence_excerpt: str
    last_evidence_reliability: str
    last_evidence_loaded: str
    last_requester: str
    last_verified_block: str
    checks_count: str

    def __init__(self):
        self.last_claim = ""
        self.last_url = ""
        self.last_verdict = ""
        self.last_confidence = "0"
        self.last_reasoning = ""
        self.last_evidence_title = ""
        self.last_evidence_excerpt = ""
        self.last_evidence_reliability = "0"
        self.last_evidence_loaded = _NO
        self.last_requester = ""
        self.last_verified_block = ""
        self.checks_count = "0"

    @gl.public.write
    def verify_claim(self, claim: str, url: str = "") -> None:
        claim = claim.strip()
        url = url.strip()

        if len(claim) < 12:
            raise gl.vm.UserError(
                "Claim is too short. Provide a specific, verifiable claim (minimum 12 characters)."
            )
        if len(claim) > _MAX_CLAIM_LENGTH:
            raise gl.vm.UserError("Claim is too long.")
        if url and not _is_http_url(url):
            raise gl.vm.UserError("Evidence URL must start with http:// or https://.")
        if len(url) > _MAX_URL_LENGTH:
            raise gl.vm.UserError("Evidence URL is too long.")

        def evaluate() -> str:
            # Non-deterministic block: each validator renders the evidence
            # independently and runs the analysis prompt.
            web_data = ""
            if url:
                web_data = gl.nondet.web.render(url, mode="text") or ""

            evidence_section = (
                f"<evidence_url>\n{url}\n</evidence_url>\n"
                f"<webpage_content>\n{web_data[:6000]}\n</webpage_content>"
                if url
                else (
                    "<evidence_url>\n(none provided)\n</evidence_url>\n"
                    "<webpage_content>\n(no evidence URL was submitted with this claim)\n</webpage_content>"
                )
            )

            task = f"""
You are an AI Validator in a decentralized fact-checking network running on GenLayer.
Your goal is to independently judge whether a claim is true, false, or uncertain,
based on the evidence provided and, if no evidence was submitted, your general knowledge.

### Inputs
<claim>
{claim}
</claim>
{evidence_section}

### Your Task
1. Read the claim and the evidence.
2. Judge the claim:
   - "true" if the evidence (or, without evidence, reliable general knowledge) supports it.
   - "false" if the evidence contradicts it.
   - "uncertain" if the evidence is missing, irrelevant, ambiguous, or contradictory.
3. If no evidence URL was provided, always judge as "uncertain" unless the claim is
   trivially verifiable from widely-known fact, and never report a confidence above 50.
4. Provide concise, specific reasoning that cites what you actually saw in the evidence.
5. Describe the evidence source itself: a short title, a short verbatim-ish excerpt,
   and how reliable you judge the source to be for this claim.

### Output Format
Return ONLY a valid JSON object with this exact structure (no markdown, no trailing commas):
{{
  "verdict": "true" | "false" | "uncertain",
  "confidence": <integer 0-100 rounded to the nearest 10>,
  "reasoning": "your detailed reasoning",
  "evidence_title": "short source title, or empty string",
  "evidence_excerpt": "short quote from the source, or empty string",
  "evidence_reliability": <integer 0-100 rounded to the nearest 10, 0 when no evidence>,
  "evidence_loaded": "true" | "false"
}}

### Constraints
- Be accurate and objective. Do not hedge into "uncertain" when the evidence is decisive.
- Round confidence and reliability to the nearest 10 so independent validators agree.
- "evidence_loaded" must be "false" when no evidence URL was provided.
- Output must be valid JSON without trailing commas.
"""

            return gl.nondet.exec_prompt(task)

        result = gl.eq_principle.prompt_comparative(
            evaluate,
            principle=(
                "`verdict` and `evidence_loaded` must be exactly the same across all "
                "validator outputs. `confidence` and `evidence_reliability` may differ "
                "by at most 10 points. `reasoning`, `evidence_title`, and "
                "`evidence_excerpt` must be similar in substance."
            ),
        )

        parsed = _parse_json_dict(result)
        verdict = str(parsed.get("verdict", "")).strip().lower()
        if verdict not in (_VERDICT_TRUE, _VERDICT_FALSE, _VERDICT_UNCERTAIN):
            verdict = _VERDICT_UNCERTAIN

        confidence = _clamp_score(parsed.get("confidence"))
        reliability = _clamp_score(parsed.get("evidence_reliability"))
        evidence_loaded = str(parsed.get("evidence_loaded", "")).strip().lower()
        evidence_loaded = _YES if evidence_loaded == _YES else _NO

        # Record the agreed consensus result on-chain.
        self.last_claim = claim
        self.last_url = url
        self.last_verdict = verdict
        self.last_confidence = confidence
        self.last_reasoning = str(parsed.get("reasoning", "")).strip()
        self.last_evidence_title = str(parsed.get("evidence_title", "")).strip()
        self.last_evidence_excerpt = str(parsed.get("evidence_excerpt", "")).strip()
        self.last_evidence_reliability = reliability
        self.last_evidence_loaded = evidence_loaded
        self.last_requester = str(gl.message.sender_address.as_hex)
        self.last_verified_block = str(gl.block.number)
        self.checks_count = str(int(self.checks_count) + 1)

    @gl.public.view
    def get_last_result(self) -> dict:
        return {
            "claim": self.last_claim,
            "url": self.last_url,
            "verdict": self.last_verdict,
            "confidence": self.last_confidence,
            "reasoning": self.last_reasoning,
            "evidence_title": self.last_evidence_title,
            "evidence_excerpt": self.last_evidence_excerpt,
            "evidence_reliability": self.last_evidence_reliability,
            "evidence_loaded": self.last_evidence_loaded,
            "requester": self.last_requester,
            "verified_block": self.last_verified_block,
            "checks_count": self.checks_count,
        }

    @gl.public.view
    def get_checks_count(self) -> str:
        return self.checks_count
