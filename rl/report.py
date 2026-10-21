"""Render an rl.evaluate JSON report as Markdown tables (so docs quote the data, not hand-copied numbers).

    python -m rl.report docs/results/rl_eval.json > docs/results/rl_eval.md
"""
from __future__ import annotations

import json
import sys


def render(report: dict) -> str:
    lines = [f"Held-out seeds {report['seeds'][0]}…{report['seeds'][1]} ({report['episodes']} episodes per row), "
             f"self-play opponents: `{report.get('selfplayOpponent')}`. Values are means ± 95 % CI.", ""]
    for scenario, entries in report["results"].items():
        lines += [f"### {scenario}", "", "| policy | return | final mass | survival (s) | death rate | win rate | kills |", "|---|---:|---:|---:|---:|---:|---:|"]
        for name, s in entries.items():
            lines.append(f"| {name} | {s['r']:.2f} ± {s['r_ci']:.2f} | {s['final_mass']:.1f} ± {s['final_mass_ci']:.1f} | "
                         f"{s['survival']:.1f} ± {s['survival_ci']:.1f} | {s['death_rate']:.2f} | {s['win_rate']:.2f} | {s['kills']:.2f} |")
        agreement = report.get("agreement", {}).get(scenario)
        if agreement:
            lines.append(f"\nPyTorch vs TypeScript inference: {agreement['identical_episodes']}/{agreement['episodes']} episodes identical.")
        lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    with open(sys.argv[1], encoding="utf-8") as f:
        print(render(json.load(f)))
