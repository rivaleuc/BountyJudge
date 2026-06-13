# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
import json
from genlayer import *

MAX_SPEC_CHARS = 3000
MAX_CODE_CHARS = 5000


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
3. Overall pass requires ALL milestones passed (or spec fully met if no milestones).
4. Be strict but fair. Partial work = fail unless spec allows it.
5. If code fetch failed, judge based on available notes only (likely fail).

Reply ONLY valid JSON:
{{"overall_pass": true/false, "score": <0-100>, "reasoning": "<summary>", "milestones": [{{"name": "<milestone>", "pass": true/false, "reason": "<why>"}}]}}
No markdown, no code fences."""

            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            if isinstance(raw, dict):
                return json.dumps(raw)
            return str(raw).strip()

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            try:
                data = json.loads(leader_result.calldata)
                if not isinstance(data.get("overall_pass"), bool):
                    return False
                score = data.get("score")
                if not isinstance(score, int) or score < 0 or score > 100:
                    return False
                if not isinstance(data.get("reasoning"), str):
                    return False
                if not isinstance(data.get("milestones"), list):
                    return False
                return True
            except Exception:
                return False

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
