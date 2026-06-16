"""Deterministic-invariant tests for the BountyJudge contract.

ANCHOR: when milestones non-empty, overall_pass == all(m['pass']);
score in [0,100]; each milestone shaped (name+reason non-empty, pass bool).
"""


def test_derived_anchor_matches(contract):
    ms_all_pass = [{"name": "a", "pass": True, "reason": "ok"},
                   {"name": "b", "pass": True, "reason": "ok"}]
    ms_one_fail = [{"name": "a", "pass": True, "reason": "ok"},
                   {"name": "b", "pass": False, "reason": "no"}]
    assert contract.derive_overall_pass(ms_all_pass, False) is True
    assert contract.derive_overall_pass(ms_one_fail, True) is False
    # no milestones -> falls back to provided flag
    assert contract.derive_overall_pass([], True) is True
    assert contract.derive_overall_pass([], False) is False


def test_normalized_output_always_passes(contract):
    samples = [
        {"score": 50, "reasoning": "x", "milestones": [
            {"name": "a", "pass": True, "reason": "ok"},
            {"name": "b", "pass": False, "reason": "no"}]},
        {"score": 999, "reasoning": "", "milestones": "bad", "overall_pass": True},
        {"score": True, "milestones": [{"name": "", "pass": 1, "reason": ""}]},
        {},
        "not a dict",
        None,
    ]
    for raw in samples:
        v = contract.normalize_verdict(raw)
        assert contract.validate_verdict(v), raw
        if v["milestones"]:
            assert v["overall_pass"] == all(m["pass"] for m in v["milestones"])


def test_anchor_mismatch_rejected(contract):
    # milestones all pass but overall_pass False => fail
    assert not contract.validate_verdict({
        "overall_pass": False, "score": 90, "reasoning": "x",
        "milestones": [{"name": "a", "pass": True, "reason": "ok"}],
    })
    # one milestone fails but overall_pass True => fail
    assert not contract.validate_verdict({
        "overall_pass": True, "score": 50, "reasoning": "x",
        "milestones": [{"name": "a", "pass": True, "reason": "ok"},
                       {"name": "b", "pass": False, "reason": "no"}],
    })


def test_score_out_of_range_rejected(contract):
    base = {"overall_pass": True, "reasoning": "x", "milestones": []}
    assert not contract.validate_verdict({**base, "score": -1})
    assert not contract.validate_verdict({**base, "score": 101})


def test_bool_score_rejected(contract):
    assert not contract.validate_verdict(
        {"overall_pass": True, "score": True, "reasoning": "x", "milestones": []}
    )


def test_bad_milestone_shape_rejected(contract):
    # empty name
    assert not contract.validate_verdict({
        "overall_pass": True, "score": 10, "reasoning": "x",
        "milestones": [{"name": "", "pass": True, "reason": "ok"}],
    })
    # non-bool pass
    assert not contract.validate_verdict({
        "overall_pass": True, "score": 10, "reasoning": "x",
        "milestones": [{"name": "a", "pass": 1, "reason": "ok"}],
    })
    # empty reason
    assert not contract.validate_verdict({
        "overall_pass": True, "score": 10, "reasoning": "x",
        "milestones": [{"name": "a", "pass": True, "reason": "  "}],
    })


def test_empty_reasoning_rejected(contract):
    assert not contract.validate_verdict(
        {"overall_pass": True, "score": 10, "reasoning": "   ", "milestones": []}
    )
