# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
import json
from genlayer import *

MAX_SPEC_CHARS = 3000
MAX_CODE_CHARS = 5000


# ----------------------------------------------------------------------
# Deterministic verdict logic (module-level, unit-testable, shared by
# leader_fn and validator_fn). No free-form LLM text comparison.
# ----------------------------------------------------------------------
def validate_milestone(m) -> bool:
    if not isinstance(m, dict):
        return False
    name = m.get("name")
    reason = m.get("reason")
    passed = m.get("pass")
    if not isinstance(name, str) or not name.strip():
        return False
    if not isinstance(reason, str) or not reason.strip():
        return False
    # `pass` is a boolean — reject ints/strings masquerading as bool.
    if not isinstance(passed, bool):
        return False
    return True


def derive_overall_pass(milestones, fallback):
    """When milestones exist, overall_pass is exactly all(m['pass'])."""
    if milestones:
        return all(bool(m.get("pass")) for m in milestones)
    return bool(fallback)


def validate_verdict(data) -> bool:
    if not isinstance(data, dict):
        return False
    overall_pass = data.get("overall_pass")
    if not isinstance(overall_pass, bool):
        return False
    score = data.get("score")
    # score is an int in [0, 100]; reject bool (bool is a subclass of int).
    if not isinstance(score, int) or isinstance(score, bool):
        return False
    if score < 0 or score > 100:
        return False
    reasoning = data.get("reasoning")
    if not isinstance(reasoning, str) or not reasoning.strip():
        return False
    milestones = data.get("milestones")
    if not isinstance(milestones, list):
        return False
    for m in milestones:
        if not validate_milestone(m):
            return False
    # Cross-field anchor: when milestones are present, overall_pass MUST equal
    # the conjunction of every milestone's pass flag.
    if milestones:
        if overall_pass != all(bool(m["pass"]) for m in milestones):
            return False
    return True


def normalize_verdict(raw) -> dict:
    if not isinstance(raw, dict):
        raw = {}
    milestones = []
    raw_ms = raw.get("milestones")
    if isinstance(raw_ms, list):
        for m in raw_ms:
            if not isinstance(m, dict):
                continue
            name = m.get("name")
            reason = m.get("reason")
            name = name.strip() if isinstance(name, str) and name.strip() else "milestone"
            reason = reason.strip() if isinstance(reason, str) and reason.strip() else "no reason provided"
            milestones.append({"name": name, "pass": bool(m.get("pass")), "reason": reason})

    score = raw.get("score")
    if not isinstance(score, int) or isinstance(score, bool):
        score = 0
    score = max(0, min(100, score))

    reasoning = raw.get("reasoning")
    if not isinstance(reasoning, str) or not reasoning.strip():
        reasoning = "no reasoning provided"

    # Leader sets overall_pass = all milestone passes (when milestones exist).
    overall_pass = derive_overall_pass(milestones, raw.get("overall_pass", False))
    return {
        "overall_pass": overall_pass,
        "score": score,
        "reasoning": reasoning,
        "milestones": milestones,
    }


class BountyJudge(gl.Contract):
    owner: str
    bounties: TreeMap[str, str]       # key -> JSON bounty
    submissions: TreeMap[str, str]    # "bountyKey:submitter" -> JSON submission
    bounty_count: u256
    judgments_made: u256

    def __init__(self):
        self.owner = str(gl.message.sender_address)
        self.bounty_count = u256(0)
        self.judgments_made = u256(0)

    # ------------------------------------------------------------------
    # Bounty lifecycle
    # ------------------------------------------------------------------

    @gl.public.write
    def create_bounty(
        self, title: str, spec: str, repo_required: bool, milestones: str
    ) -> str:
        """
        Create a bounty with a spec and optional milestones.
        milestones: JSON array like ["Setup repo","Core logic","Tests pass"]
        """
        title = str(title).strip()
        spec = str(spec).strip()
        if not title or not spec:
            raise Exception("title and spec required")
        if len(spec) > MAX_SPEC_CHARS:
            raise Exception(f"spec too long (max {MAX_SPEC_CHARS})")

        # Parse milestones
        try:
            ms = json.loads(str(milestones)) if milestones else []
        except Exception:
            ms = []
        if not isinstance(ms, list):
            ms = []

        key = str(int(self.bounty_count))
        bounty = {
            "poster": str(gl.message.sender_address),
            "title": title,
            "spec": spec,
            "repo_required": bool(repo_required),
            "milestones": ms,
            "milestone_count": len(ms),
            "status": "open",  # open, judging, completed, disputed
            "winner": "",
        }
        self.bounties[key] = json.dumps(bounty)
        self.bounty_count += u256(1)
        return key

    @gl.public.write
    def submit_work(self, bounty_key: str, github_url: str, notes: str) -> None:
        """Worker submits their deliverable (GitHub repo/PR URL + notes)."""
        bounty_key = str(bounty_key)
        if bounty_key not in self.bounties:
            raise Exception("unknown bounty")
        bounty = json.loads(self.bounties[bounty_key])
        if bounty["status"] != "open":
            raise Exception("bounty not open")

        submitter = str(gl.message.sender_address)
        sub_key = f"{bounty_key}:{submitter}"
        submission = {
            "submitter": submitter,
            "github_url": str(github_url).strip(),
            "notes": str(notes).strip()[:1000],
            "verdict": None,
            "milestone_results": [],
        }
        self.submissions[sub_key] = json.dumps(submission)

    # ------------------------------------------------------------------
    # AI Judgment — the core differentiator
    # ------------------------------------------------------------------

    @gl.public.write
    def judge(self, bounty_key: str, submitter: str) -> None:
        """
        Trigger AI judgment: fetch code from GitHub, compare against spec,
        score each milestone individually.
        """
        bounty_key = str(bounty_key)
        submitter = str(submitter)
        if bounty_key not in self.bounties:
            raise Exception("unknown bounty")
        bounty = json.loads(self.bounties[bounty_key])

        sub_key = f"{bounty_key}:{submitter}"
        if sub_key not in self.submissions:
            raise Exception("no submission from this address")
        submission = json.loads(self.submissions[sub_key])

        verdict = self._run_judgment(bounty, submission)

        submission["verdict"] = verdict
        submission["milestone_results"] = verdict.get("milestones", [])
        self.submissions[sub_key] = json.dumps(submission)

        # If passed, mark bounty completed
        if verdict["overall_pass"]:
            bounty["status"] = "completed"
            bounty["winner"] = submitter
            self.bounties[bounty_key] = json.dumps(bounty)

        self.judgments_made += u256(1)

    def _run_judgment(self, bounty: dict, submission: dict) -> dict:
        spec = bounty["spec"]
        milestones = bounty["milestones"]
        github_url = submission["github_url"]
        notes = submission["notes"]

        def leader_fn() -> str:
            # Fetch deliverable from GitHub
            code_content = "(no code fetched)"
            if github_url and github_url.startswith("http"):
                try:
                    # Try raw content (for single file) or README
                    fetch_url = github_url
                    if "github.com" in github_url and "/blob/" not in github_url:
                        # Repo root → fetch README
                        fetch_url = github_url.rstrip("/") + "/raw/main/README.md"
                        if "/raw/" not in fetch_url:
                            fetch_url = github_url.replace(
                                "github.com", "raw.githubusercontent.com"
                            ) + "/main/README.md"
                    raw = gl.nondet.web.get(fetch_url)
                    code_content = raw.body.decode("utf-8")[:MAX_CODE_CHARS]
                except Exception:
                    try:
                        # Fallback: render the repo page
                        rendered = gl.nondet.web.render(github_url, mode="text")
                        code_content = rendered[:MAX_CODE_CHARS]
                    except Exception:
                        code_content = "(GitHub fetch failed)"

            milestone_block = ""
            if milestones:
                milestone_block = "MILESTONES TO EVALUATE (judge each individually):\n"
                for i, ms in enumerate(milestones):
                    milestone_block += f"  {i+1}. {ms}\n"

            prompt = f"""You are a bounty judge. A poster created a bounty with a specification. A worker submitted deliverables. Your job: determine if the work meets the spec.

BOUNTY SPECIFICATION:
{spec[:MAX_SPEC_CHARS]}

{milestone_block}

WORKER'S NOTES:
{notes[:500]}

DELIVERABLE CODE/README (fetched from GitHub):
{code_content}

JUDGMENT RULES:
1. Compare deliverable against EACH requirement in the spec.
2. If milestones exist, score each one: pass/fail with reason.
3. Be strict but fair. Partial work = fail unless spec allows it.
4. If code fetch failed, judge based on available notes only (likely fail).

Reply ONLY valid JSON:
{{"score": <0-100>, "reasoning": "<summary>", "milestones": [{{"name": "<milestone>", "pass": true/false, "reason": "<why>"}}]}}
No markdown, no code fences."""

            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            if not isinstance(raw, dict):
                try:
                    raw = json.loads(str(raw))
                except Exception:
                    raw = {}
            # Leader derives overall_pass = all milestone passes deterministically.
            return json.dumps(normalize_verdict(raw))

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            try:
                data = json.loads(leader_result.calldata)
            except Exception:
                return False
            return validate_verdict(data)

        result_str = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        return json.loads(result_str)

    # ------------------------------------------------------------------
    # Dispute: poster or worker can request re-judgment
    # ------------------------------------------------------------------

    @gl.public.write
    def dispute(self, bounty_key: str, submitter: str) -> None:
        """Re-judge a submission (fresh AI evaluation with new validator set)."""
        bounty_key = str(bounty_key)
        sub_key = f"{bounty_key}:{submitter}"
        if sub_key not in self.submissions:
            raise Exception("no submission found")
        bounty = json.loads(self.bounties[bounty_key])
        submission = json.loads(self.submissions[sub_key])

        caller = str(gl.message.sender_address)
        if caller != bounty["poster"] and caller != submitter:
            raise Exception("only poster or submitter can dispute")

        verdict = self._run_judgment(bounty, submission)
        submission["verdict"] = verdict
        submission["milestone_results"] = verdict.get("milestones", [])
        self.submissions[sub_key] = json.dumps(submission)

        if verdict["overall_pass"]:
            bounty["status"] = "completed"
            bounty["winner"] = submitter
        else:
            bounty["status"] = "disputed"
            bounty["winner"] = ""
        self.bounties[bounty_key] = json.dumps(bounty)
        self.judgments_made += u256(1)

    # ------------------------------------------------------------------
    # Views
    # ------------------------------------------------------------------

    @gl.public.view
    def get_bounty(self, key: str) -> dict:
        key = str(key)
        if key not in self.bounties:
            return {"exists": False}
        return json.loads(self.bounties[key])

    @gl.public.view
    def get_submission(self, bounty_key: str, submitter: str) -> dict:
        sub_key = f"{str(bounty_key)}:{str(submitter)}"
        if sub_key not in self.submissions:
            return {"exists": False}
        return json.loads(self.submissions[sub_key])

    @gl.public.view
    def read_payout(self, bounty_key: str) -> dict:
        """Escrow resolver reads this to release funds."""
        bounty_key = str(bounty_key)
        if bounty_key not in self.bounties:
            return {"payable": False}
        bounty = json.loads(self.bounties[bounty_key])
        return {
            "payable": bounty["status"] == "completed",
            "winner": bounty["winner"],
            "poster": bounty["poster"],
            "bounty_key": bounty_key,
        }

    @gl.public.view
    def stats(self) -> dict:
        return {
            "total_bounties": int(self.bounty_count),
            "judgments_made": int(self.judgments_made),
        }
