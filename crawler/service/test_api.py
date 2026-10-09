"""Step selection for crawl jobs. Run: cd crawler && ../.venv/bin/python -m pytest service -q"""

import pytest
from fastapi import HTTPException

from service.api import plan_for
from service.steps import PLANS, STEPS


def test_every_planned_step_exists():
    assert all(s["name"] in STEPS for s in PLANS["refresh"])


def test_default_plan_runs_every_crawler():
    names = [s["name"] for s in plan_for("refresh", None)]
    assert {"regulatory", "clinical", "publications", "conferences", "patents", "company_site", "company_news",
            "news", "industry_news"} <= set(names)
    assert names.index("industry_news") < names.index("journey") < names.index("ai_events")


def test_selected_steps_keep_plan_order():
    assert [s["name"] for s in plan_for("refresh", ["journey", "patents"])] == ["patents", "journey"]


@pytest.mark.parametrize("steps", [[], ["patents", "bogus"]])
def test_unknown_or_empty_step_lists_are_rejected(steps):
    with pytest.raises(HTTPException) as e:
        plan_for("refresh", steps)
    assert e.value.status_code == 400 and e.value.detail["code"] == "UNKNOWN_STEP"
    assert "Available: regulatory" in e.value.detail["message"]


CONTRACT_PLANS = {
    "onboard": ["regulatory", "clinical", "publications", "conferences", "company_site", "company_news", "news",
                "industry_news", "journey", "ai_triage", "ai_events", "index", "competitors", "patents", "finalize"],
    # Patents too: their expiries are the competitor's loss-of-exclusivity dates.
    "competitor": ["regulatory", "clinical", "publications", "conferences", "news", "patents", "journey", "ai_triage",
                   "ai_events", "index", "finalize"],
}


@pytest.mark.parametrize("job_type", ["refresh", "onboard", "competitor"])
def test_every_job_type_plans_existing_steps(job_type):
    assert all(s["name"] in STEPS and s["label"] for s in plan_for(job_type, None))


def test_new_job_types_follow_the_contract():
    assert {t: [s["name"] for s in PLANS[t]] for t in CONTRACT_PLANS} == CONTRACT_PLANS
    refresh = [s["name"] for s in PLANS["refresh"]]
    assert refresh.index("index") < refresh.index("competitors") and refresh[-1] == "finalize"


def test_competitor_jobs_cannot_run_company_steps():
    with pytest.raises(HTTPException) as e:
        plan_for("competitor", ["company_site", "company_news"])
    assert e.value.detail["code"] == "UNKNOWN_STEP"
