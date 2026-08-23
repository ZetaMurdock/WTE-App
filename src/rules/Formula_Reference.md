# Formula Reference

<div class="mw-content-ltr mw-parser-output" lang="en" dir="ltr"><div style="background:#0d0d0d;padding:28px 32px;border:1px solid #1e1e1e;font-family:'Segoe UI',sans-serif;color:#dedede;max-width:960px;margin:0 auto;"><div style="font-family:monospace;font-size:10px;letter-spacing:3px;color:#4e7fa5;margin-bottom:22px;">
<p><a data-wte-link="wte://rules/Wonderland_of_The_Enigma_Wiki">WTE WIKI</a> · <a data-wte-link="wte://rules/Mechanics">MECHANICS</a> · FORMULA REFERENCE
</p>
</div><div style="font-size:26px;font-weight:700;color:#9b79d4;letter-spacing:1px;border-bottom:2px solid #6e50a0;padding-bottom:12px;margin-bottom:24px;">
<p>FORMULA REFERENCE
</p>
</div><div style="background:#121212;border:1px solid #1e1e1e;border-left:4px solid #6e50a0;padding:16px 20px;margin-bottom:24px;">
<p>This page is for players who want to understand the math fully. Every formula in WTE is here, with worked examples and edge case notes. <b>Nothing here is required reading</b> — the game plays without it — but understanding it opens the system up completely.
</p>
</div><div style="background:#121212;border:1px solid #1e1e1e;border-top:3px solid #6e50a0;padding:18px 22px;margin-bottom:16px;"><div style="font-size:9.5px;text-transform:uppercase;letter-spacing:2px;color:#6e50a0;font-weight:700;border-bottom:1px solid #1e1e1e;padding-bottom:8px;margin-bottom:14px;">FORMULA 1 — FINAL AAV (CORE RESOLUTION)</div><div style="background:#0d0d0d;border:1px solid #1e1e1e;padding:14px 18px;font-family:monospace;font-size:14px;color:#c09a30;margin-bottom:16px;text-align:center;letter-spacing:1px;">
<p>Final AAV = (1d40 + Specialty + Attribute Modifier + Final Complexity) × Rank Multiplier
</p>
</div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px;"><div style="background:#0d0d0d;border:1px solid #1e1e1e;padding:12px 14px;"><div style="font-size:10px;letter-spacing:1.5px;color:#4e7fa5;font-weight:700;margin-bottom:6px;">A · 1d40</div><div style="font-size:12px;color:#909090;line-height:1.65;">The baseline randomizer. Range 1–40. Every character uses the same die. Creates meaningful spread without making randomness dominant. A max-skilled Rank 9 character has a pre-roll ceiling around 180+ — d40 adds variance without making low rolls catastrophic.</div></div><div style="background:#0d0d0d;border:1px solid #1e1e1e;padding:12px 14px;"><div style="font-size:10px;letter-spacing:1.5px;color:#4e7fa5;font-weight:700;margin-bottom:6px;">B · SPECIALTY (threshold 25)</div><div style="font-size:12px;color:#909090;line-height:1.65;">
<p>Rated 1–40. At or above 25: <span style="color:#3a8050;">add full value</span>. Below 25: <span style="color:#a03535;">subtract full value</span>.
</p><p>Specialty 30 → +30 to AAV
</p><p>Specialty 22 → <b>−22</b> to AAV
</p><p>Specialty 25 → +25 (threshold adds)
</p>
</div></div><div style="background:#0d0d0d;border:1px solid #1e1e1e;padding:12px 14px;"><div style="font-size:10px;letter-spacing:1.5px;color:#4e7fa5;font-weight:700;margin-bottom:6px;">C · ATTRIBUTE MODIFIER (threshold 15)</div><div style="font-size:12px;color:#909090;line-height:1.65;">
<p>Rated 1–40. Formula:
</p><p>≥15 → +(Attr − 15)
</p><p>&lt;15 → −(15 − Attr)
</p><p>STR 22 → +7 | STR 15 → ±0
</p><p>STR 10 → −5 | STR 32 → +17
</p><p>Director selects most relevant attribute; players may argue an alternative.
</p>
</div></div></div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px;"><div style="background:#0d0d0d;border:1px solid #1e1e1e;padding:12px 14px;"><div style="font-size:10px;letter-spacing:1.5px;color:#4e7fa5;font-weight:700;margin-bottom:6px;">D · FINAL COMPLEXITY</div><div style="font-size:12px;color:#909090;line-height:1.65;margin-bottom:8px;">
<p><span style="font-family:monospace;color:#c09a30;">Final Complexity = (Tier Value ÷ 2) + Complexity Modifier</span>
</p>
</div>
<table style="width:100%;border-collapse:collapse;font-size:11.5px;">
<tbody><tr>
<th style="padding:4px 8px;text-align:left;color:#4e7fa5;">Tier
</th>
<th style="padding:4px 8px;color:#4e7fa5;">Raw
</th>
<th style="padding:4px 8px;color:#4e7fa5;">After ÷2
</th></tr>
<tr>
<td style="padding:4px 8px;color:#909090;">Simple
</td>
<td style="padding:4px 8px;color:#909090;">4
</td>
<td style="padding:4px 8px;color:#3a8050;">+2
</td></tr>
<tr style="background:#161616;">
<td style="padding:4px 8px;color:#909090;">Layered
</td>
<td style="padding:4px 8px;color:#909090;">10
</td>
<td style="padding:4px 8px;color:#3a8050;">+5
</td></tr>
<tr>
<td style="padding:4px 8px;color:#909090;">Masterwork
</td>
<td style="padding:4px 8px;color:#909090;">18
</td>
<td style="padding:4px 8px;color:#3a8050;">+9
</td></tr></tbody></table>
</div><div style="background:#0d0d0d;border:1px solid #1e1e1e;padding:12px 14px;"><div style="font-size:10px;letter-spacing:1.5px;color:#a03535;font-weight:700;margin-bottom:6px;">E · TAX BURDEN</div><div style="font-size:12px;color:#909090;line-height:1.65;margin-bottom:8px;">
<p><span style="font-family:monospace;color:#c09a30;font-size:11px;">Tax Burden = Σ floor(Specialty ÷ 3) per reducing specialty</span>
</p><p><span style="font-family:monospace;color:#c09a30;font-size:11px;">Complexity Modifier = Inspiration − Tax Burden</span>
</p>
</div><div style="font-size:11.5px;color:#565656;font-style:italic;">Example: Precision 30 + Weight 30 + Cunning 24 → TB = 10 + 10 + 8 = 28. If Inspiration = 20: Complexity Modifier = −8. Even Masterwork (+9) only nets +1.</div></div><div style="background:#0d0d0d;border:1px solid #1e1e1e;padding:12px 14px;"><div style="font-size:10px;letter-spacing:1.5px;color:#4e7fa5;font-weight:700;margin-bottom:6px;">F · RANK MULTIPLIER</div>
<table style="width:100%;border-collapse:collapse;font-size:11.5px;">
<tbody><tr>
<th style="padding:4px 8px;text-align:left;color:#4e7fa5;">Rank
</th>
<th style="padding:4px 8px;color:#4e7fa5;">×
</th></tr>
<tr>
<td style="padding:4px 8px;color:#909090;">0
</td>
<td style="padding:4px 8px;color:#909090;">×1.00
</td></tr>
<tr style="background:#161616;">
<td style="padding:4px 8px;color:#909090;">1
</td>
<td style="padding:4px 8px;color:#909090;">×1.20
</td></tr>
<tr>
<td style="padding:4px 8px;color:#909090;">2
</td>
<td style="padding:4px 8px;color:#909090;">×1.40
</td></tr>
<tr style="background:#161616;">
<td style="padding:4px 8px;color:#c09a30;font-weight:700;">3
</td>
<td style="padding:4px 8px;color:#c09a30;font-weight:700;">×1.45
</td></tr>
<tr>
<td style="padding:4px 8px;color:#909090;">4
</td>
<td style="padding:4px 8px;color:#909090;">×1.50
</td></tr>
<tr style="background:#161616;">
<td style="padding:4px 8px;color:#909090;">5
</td>
<td style="padding:4px 8px;color:#909090;">×1.55
</td></tr>
<tr>
<td style="padding:4px 8px;color:#909090;">6
</td>
<td style="padding:4px 8px;color:#909090;">×1.60
</td></tr>
<tr style="background:#161616;">
<td style="padding:4px 8px;color:#909090;">7
</td>
<td style="padding:4px 8px;color:#909090;">×1.65
</td></tr>
<tr>
<td style="padding:4px 8px;color:#909090;">8
</td>
<td style="padding:4px 8px;color:#909090;">×1.70
</td></tr>
<tr style="background:#161616;">
<td style="padding:4px 8px;color:#3a8050;font-weight:700;">9
</td>
<td style="padding:4px 8px;color:#3a8050;font-weight:700;">×1.75
</td></tr></tbody></table>
<div style="font-size:11px;color:#565656;margin-top:6px;font-style:italic;">Rank 2→3 jump is intentional. Early ranks grow fast; then smooth scaling.</div></div></div><div style="background:#0d0d0d;border:1px solid #6e50a0;padding:14px 18px;"><div style="font-size:10px;letter-spacing:1.5px;color:#6e50a0;font-weight:700;margin-bottom:10px;">WORKED EXAMPLE — FULL FINAL AAV</div><div style="font-size:12px;color:#909090;line-height:1.7;margin-bottom:8px;">
<p><b>Character:</b> Rank 4 · STR 24 · Combat Technique Specialty 32 · Inspiration 18 · Tax Burden 14 · Layered complexity declared and approved.
</p>
</div><div style="font-family:monospace;font-size:12px;color:#c09a30;line-height:1.8;">
<p>1d40 roll: 22
</p><p>+ Specialty (32 ≥ 25): +32
</p><p>+ Attribute Modifier (STR 24 − 15): +9
</p><p>+ Final Complexity: Complexity Modifier = 18 − 14 = +4 → Layered (10 ÷ 2) + 4 = +9
</p><p>Pre-multiplier total: 22 + 32 + 9 + 9 = <b>72</b>
</p><p>× Rank 4 multiplier (×1.50) = <b>Final AAV: 108</b>
</p>
</div><div style="font-size:12px;color:#3a8050;margin-top:8px;font-weight:700;">BP = 95 → SUCCESS (108 &gt; 95)</div></div></div><div style="background:#121212;border:1px solid #1e1e1e;border-top:3px solid #4e7fa5;padding:18px 22px;margin-bottom:16px;"><div style="font-size:9.5px;text-transform:uppercase;letter-spacing:2px;color:#4e7fa5;font-weight:700;border-bottom:1px solid #1e1e1e;padding-bottom:8px;margin-bottom:14px;">FORMULA 2 — GROUP ACTION</div><div style="background:#0d0d0d;border:1px solid #1e1e1e;padding:12px 16px;font-family:monospace;font-size:12.5px;color:#c09a30;margin-bottom:12px;">
<p>Group Final AAV = (Lead pre-rank total + Σ Supporter Specialties ÷ 2) × Lead Rank Multiplier
</p>
</div><div style="font-size:12.5px;color:#909090;line-height:1.7;margin-bottom:12px;">
<p>One character is the <b>Lead</b> — they make the full roll. Each Supporter declares a contribution; Director approves or denies. Approved Supporters add their relevant Specialty ÷ 2 (round down) to the Lead's <i>pre-rank</i> total. Lead Rank Multiplier applies to the entire combined total.
</p>
</div><div style="background:#0d0d0d;border:1px solid #1e1e1e;padding:12px 16px;margin-bottom:10px;"><div style="font-size:10px;letter-spacing:1.5px;color:#4e7fa5;font-weight:700;margin-bottom:8px;">WORKED EXAMPLE</div><div style="font-family:monospace;font-size:12px;color:#c09a30;line-height:1.7;">
<p>Lead pre-rank: 65 · Rank 4 (×1.50)
</p><p>Supporter A: Combat 30 → contributes 15
</p><p>Supporter B: Perception 26 → contributes 13
</p><p>Group pre-rank = 65 + 15 + 13 = 93
</p><p>Group Final AAV = 93 × 1.50 = <b>139</b>
</p>
</div><div style="font-size:12px;color:#3a8050;margin-top:8px;font-weight:700;">BP = 130 → SUCCESS</div></div><div style="font-size:11.5px;color:#565656;font-style:italic;">Why ÷2? Supporter contributions are contextual assists, not full parallel actions. Halving prevents group actions from trivializing high BP encounters.</div></div><div style="background:#121212;border:1px solid #1e1e1e;border-top:3px solid #c09a30;padding:18px 22px;margin-bottom:16px;"><div style="font-size:9.5px;text-transform:uppercase;letter-spacing:2px;color:#c09a30;font-weight:700;border-bottom:1px solid #1e1e1e;padding-bottom:8px;margin-bottom:14px;">FORMULA 3 — BP RANGE DERIVATION (SOLO CEILING)</div><div style="background:#0d0d0d;border:1px solid #1e1e1e;padding:12px 16px;font-family:monospace;font-size:12px;color:#c09a30;margin-bottom:12px;line-height:1.7;">
<p>1d40 max = 40
</p><p>Max Specialty = 40 → +40
</p><p>Max Attribute Modifier = +25 (Attribute 40)
</p><p>Max Final Complexity = Masterwork +9 + zero Tax Burden = +9
</p><p>Pre-rank max = 40 + 40 + 25 + 9 = <b>114</b>
</p><p>× Rank 9 (×1.75) → <b>≈200 practical solo cap</b>
</p>
</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;"><div style="background:#0d0d0d;border:1px solid #1e1e1e;border-left:3px solid #3a8050;padding:10px 14px;"><div style="font-size:11px;color:#3a8050;font-weight:700;margin-bottom:4px;">BP ≤ 226</div><div style="font-size:12px;color:#909090;">Solo-achievable with perfect build, Rank 9, favorable roll</div></div><div style="background:#0d0d0d;border:1px solid #1e1e1e;border-left:3px solid #a03535;padding:10px 14px;"><div style="font-size:11px;color:#a03535;font-weight:700;margin-bottom:4px;">BP 227–375</div><div style="font-size:12px;color:#909090;">Requires Group Action or extraordinary ability effects</div></div></div></div><div style="background:#121212;border:1px solid #1e1e1e;padding:18px 22px;margin-bottom:16px;"><div style="font-size:9.5px;text-transform:uppercase;letter-spacing:2px;color:#6e50a0;font-weight:700;border-bottom:1px solid #1e1e1e;padding-bottom:8px;margin-bottom:14px;">FORMULAS 4 &amp; 5 — INCEPT DOMINANCE / EXPRESSION DRIFT</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;"><div style="background:#0d0d0d;border:1px solid #1e1e1e;padding:12px 14px;"><div style="font-size:10px;letter-spacing:1.5px;color:#6e50a0;font-weight:700;margin-bottom:8px;">EFFECTIVE DOMINANCE / RECESSIVENESS</div><div style="font-family:monospace;font-size:11.5px;color:#c09a30;line-height:1.7;margin-bottom:8px;">
<p>Eff. Dom = (Incept Base Dom + Species Base Dom) × Lineage Modifier
</p><p>Eff. Rec = (Incept Base Rec + Species Base Rec) × Lineage Modifier
</p>
</div><div style="font-size:11.5px;color:#565656;font-style:italic;">Example: Incept Dom 15, Species Dom 45, Lineage ×2 → Eff. Dom = 120. High Dom vs low Rec → trait starts Suppressed, reaches Normal quickly.</div></div><div style="background:#0d0d0d;border:1px solid #1e1e1e;padding:12px 14px;"><div style="font-size:10px;letter-spacing:1.5px;color:#6e50a0;font-weight:700;margin-bottom:8px;">EXPRESSION DRIFT TICK (EDT)</div><div style="font-family:monospace;font-size:11.5px;color:#c09a30;line-height:1.7;margin-bottom:8px;">
<p>EDT = 1 + Lineage Bias + Species Alignment + Narrative Reinforcement − Trait Conflict
</p>
</div>
<table style="width:100%;border-collapse:collapse;font-size:11.5px;">
<tbody><tr>
<th style="padding:4px 8px;text-align:left;color:#4e7fa5;">Modifier
</th>
<th style="padding:4px 8px;color:#4e7fa5;">Value
</th></tr>
<tr>
<td style="padding:4px 8px;color:#909090;">Baseline
</td>
<td style="padding:4px 8px;color:#3a8050;">+1 always
</td></tr>
<tr style="background:#161616;">
<td style="padding:4px 8px;color:#909090;">Lineage Bias
</td>
<td style="padding:4px 8px;color:#909090;">+1 or +2
</td></tr>
<tr>
<td style="padding:4px 8px;color:#909090;">Species Alignment
</td>
<td style="padding:4px 8px;color:#909090;">+1 or +2
</td></tr>
<tr style="background:#161616;">
<td style="padding:4px 8px;color:#909090;">Narrative Reinforce
</td>
<td style="padding:4px 8px;color:#909090;">+1 or −1
</td></tr>
<tr>
<td style="padding:4px 8px;color:#909090;">Trait Conflict
</td>
<td style="padding:4px 8px;color:#a03535;">−1 per conflict (max −2)
</td></tr></tbody></table>
<div style="font-size:11px;color:#565656;margin-top:6px;font-style:italic;">DDC ≥ 5 → trait becomes Suppressed</div></div></div></div><div style="background:#121212;border:1px solid #1e1e1e;border-top:3px solid #a03535;padding:18px 22px;margin-bottom:16px;"><div style="font-size:9.5px;text-transform:uppercase;letter-spacing:2px;color:#a03535;font-weight:700;border-bottom:1px solid #1e1e1e;padding-bottom:8px;margin-bottom:14px;">FORMULA 8 — DAMAGE RESOLUTION</div><div style="background:#0d0d0d;border:1px solid #1e1e1e;padding:12px 16px;font-family:monospace;font-size:12px;color:#c09a30;margin-bottom:12px;line-height:1.8;">
<p>Physical attacks: Incoming Damage → DHP first → HP second
</p><p>Mental attacks:  Incoming Damage → MHP first → HP second
</p><p>Neural keyword:  Split half to DHP, half to MHP → both deplete before HP
</p><p>Void damage:     Bypasses DHP entirely → goes directly to HP
</p>
</div><div style="font-size:12.5px;color:#909090;line-height:1.7;">DHP and MHP are <b>reduction buffers</b>, not separate HP pools. Once DHP is depleted, incoming physical damage hits HP directly. DHP replenishes on long rest; short rest restores 50%. Standard crits: roll all damage dice twice, take the higher total.</div></div><div style="background:#121212;border:1px solid #1e1e1e;border-top:3px solid #c09a30;padding:18px 22px;margin-bottom:16px;"><div style="font-size:9.5px;text-transform:uppercase;letter-spacing:2px;color:#c09a30;font-weight:700;border-bottom:1px solid #1e1e1e;padding-bottom:8px;margin-bottom:14px;">FORMULA 10 — BP SETTING FOR CUSTOM ENCOUNTERS</div><div style="background:#0d0d0d;border:1px solid #1e1e1e;padding:10px 14px;font-family:monospace;font-size:12.5px;color:#c09a30;margin-bottom:12px;">
<p>Target BP = Expected Party AAV × Desired Outcome Factor
</p>
</div>
<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px;">
<tbody><tr>
<th style="text-align:left;padding:8px 12px;color:#4e7fa5;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;">Outcome Factor
</th>
<th style="text-align:left;padding:8px 12px;color:#4e7fa5;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;">Scenario
</th></tr>
<tr style="border-bottom:1px solid #1e1e1e;">
<td style="padding:7px 12px;color:#3a8050;">0.60–0.70
</td>
<td style="padding:7px 12px;color:#909090;">Guaranteed success (training / low stakes)
</td></tr>
<tr style="background:#161616;border-bottom:1px solid #1e1e1e;">
<td style="padding:7px 12px;color:#3a8050;">0.75–0.85
</td>
<td style="padding:7px 12px;color:#909090;">Likely success (standard mission)
</td></tr>
<tr style="border-bottom:1px solid #1e1e1e;">
<td style="padding:7px 12px;color:#c09a30;">0.90–1.00
</td>
<td style="padding:7px 12px;color:#909090;">Challenging (real tension)
</td></tr>
<tr style="background:#161616;border-bottom:1px solid #1e1e1e;">
<td style="padding:7px 12px;color:#a03535;">1.05–1.15
</td>
<td style="padding:7px 12px;color:#909090;">Likely failure (high stakes push)
</td></tr>
<tr>
<td style="padding:7px 12px;color:#7a1a1a;font-weight:700;">1.20+
</td>
<td style="padding:7px 12px;color:#909090;">Near-impossible (legendary)
</td></tr></tbody></table>
<div style="background:#0d0d0d;border:1px solid #1e1e1e;padding:12px 16px;"><div style="font-size:10px;letter-spacing:1.5px;color:#c09a30;font-weight:700;margin-bottom:8px;">WORKED EXAMPLE — RANK 5 PARTY OF 4</div><div style="font-family:monospace;font-size:12px;color:#c09a30;line-height:1.7;">
<p>Average 1d40 roll: 20 · Primary Specialty avg: 28 · Attribute Modifier avg: +8 · Final Complexity avg: +6
</p><p>Pre-rank: 20 + 28 + 8 + 6 = 62 · × Rank 5 (×1.55) = <b>96</b>
</p><p>Challenging encounter BP: 96 × 0.95 ≈ <b>~91</b>
</p><p>Group-required (4 characters): scale to <b>110–130</b>
</p>
</div></div></div><div style="background:#121212;border:1px solid #1e1e1e;padding:18px 22px;margin-bottom:24px;"><div style="font-size:9.5px;text-transform:uppercase;letter-spacing:2px;color:#6e50a0;font-weight:700;border-bottom:1px solid #1e1e1e;padding-bottom:8px;margin-bottom:14px;">SUMMARY TABLE — ALL FORMULAS</div>
<table style="width:100%;border-collapse:collapse;font-size:12.5px;">
<tbody><tr>
<th style="text-align:left;padding:7px 12px;color:#4e7fa5;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;width:30%;">Formula
</th>
<th style="text-align:left;padding:7px 12px;color:#4e7fa5;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;">Expression
</th></tr>
<tr style="border-bottom:1px solid #1e1e1e;">
<td style="padding:7px 12px;color:#dedede;font-weight:700;">Final AAV
</td>
<td style="padding:7px 12px;color:#c09a30;font-family:monospace;font-size:11.5px;">(1d40 + Specialty + Attr Mod + Final Complexity) × Rank Multiplier
</td></tr>
<tr style="background:#161616;border-bottom:1px solid #1e1e1e;">
<td style="padding:7px 12px;color:#dedede;font-weight:700;">Group Final AAV
</td>
<td style="padding:7px 12px;color:#c09a30;font-family:monospace;font-size:11.5px;">(Lead pre-rank + Σ Supporter Specialty÷2) × Lead Rank Multiplier
</td></tr>
<tr style="border-bottom:1px solid #1e1e1e;">
<td style="padding:7px 12px;color:#dedede;font-weight:700;">Attribute Modifier
</td>
<td style="padding:7px 12px;color:#c09a30;font-family:monospace;font-size:11.5px;">≥15: +(Attr−15) / &lt;15: −(15−Attr)
</td></tr>
<tr style="background:#161616;border-bottom:1px solid #1e1e1e;">
<td style="padding:7px 12px;color:#dedede;font-weight:700;">Final Complexity
</td>
<td style="padding:7px 12px;color:#c09a30;font-family:monospace;font-size:11.5px;">(Tier Value ÷ 2) + Complexity Modifier
</td></tr>
<tr style="border-bottom:1px solid #1e1e1e;">
<td style="padding:7px 12px;color:#dedede;font-weight:700;">Complexity Modifier
</td>
<td style="padding:7px 12px;color:#c09a30;font-family:monospace;font-size:11.5px;">Inspiration − Tax Burden
</td></tr>
<tr style="background:#161616;border-bottom:1px solid #1e1e1e;">
<td style="padding:7px 12px;color:#dedede;font-weight:700;">Tax Burden
</td>
<td style="padding:7px 12px;color:#c09a30;font-family:monospace;font-size:11.5px;">Σ floor(Specialty÷3) per reducing specialty
</td></tr>
<tr style="border-bottom:1px solid #1e1e1e;">
<td style="padding:7px 12px;color:#dedede;font-weight:700;">EDT Gain
</td>
<td style="padding:7px 12px;color:#c09a30;font-family:monospace;font-size:11.5px;">1 + Lineage Bias + Species Alignment + Narrative Reinforce − Trait Conflict
</td></tr>
<tr style="background:#161616;border-bottom:1px solid #1e1e1e;">
<td style="padding:7px 12px;color:#dedede;font-weight:700;">Effective Dom
</td>
<td style="padding:7px 12px;color:#c09a30;font-family:monospace;font-size:11.5px;">(Incept Base Dom + Species Base Dom) × Lineage Modifier
</td></tr>
<tr style="border-bottom:1px solid #1e1e1e;">
<td style="padding:7px 12px;color:#dedede;font-weight:700;">Effective Rec
</td>
<td style="padding:7px 12px;color:#c09a30;font-family:monospace;font-size:11.5px;">(Incept Base Rec + Species Base Rec) × Lineage Modifier
</td></tr>
<tr style="background:#161616;border-bottom:1px solid #1e1e1e;">
<td style="padding:7px 12px;color:#dedede;font-weight:700;">Derived Stat Reduction
</td>
<td style="padding:7px 12px;color:#c09a30;font-family:monospace;font-size:11.5px;">−1 per 3 pts assigned to a reducing specialty
</td></tr>
<tr>
<td style="padding:7px 12px;color:#dedede;font-weight:700;">BP Design Target
</td>
<td style="padding:7px 12px;color:#c09a30;font-family:monospace;font-size:11.5px;">Expected AAV × Desired Outcome Factor
</td></tr></tbody></table>
</div><div style="background:#121212;border:1px solid #1e1e1e;padding:14px 18px;margin-bottom:24px;"><div style="font-size:9.5px;text-transform:uppercase;letter-spacing:2px;color:#4e7fa5;font-weight:700;border-bottom:1px solid #1e1e1e;padding-bottom:8px;margin-bottom:12px;">SEE ALSO</div><div style="font-size:12.5px;color:#7ab2d8;line-height:1.9;">
<p><a data-wte-link="wte://rules/Pressure_Engine">Pressure Engine</a> · <a data-wte-link="wte://rules/Attributes">Attributes</a> · <a data-wte-link="wte://rules/Derived_Statistics">Derived Statistics</a> · <a data-wte-link="wte://rules/Combat">Combat</a> · <a data-wte-link="wte://rules/Character_Creation">Character Creation</a> · <a data-wte-link="wte://rules/Incept">Incept</a>
</p>
</div></div><div style="border-top:1px solid #1e1e1e;padding-top:14px;font-family:monospace;font-size:10px;letter-spacing:3px;color:#565656;text-align:center;">
<p>WTE · YEAR 3261 · <a data-wte-link="wte://rules/Wonderland_of_The_Enigma_Wiki">← RETURN TO HOME</a>
</p>
</div></div>
<ul><li class="mw-empty-elt"></li></ul>
<!-- 
NewPP limit report
Cached time: 20260706103807
Cache expiry: 2592000
Reduced expiry: false
Complications: []
CPU time usage: 0.013 seconds
Real time usage: 0.018 seconds
Preprocessor visited node count: 85/1000000
Post‐expand include size: 0/2097152 bytes
Template argument size: 0/2097152 bytes
Highest expansion depth: 1/100
Expensive parser function count: 0/100
Unstrip recursion depth: 0/20
Unstrip post‐expand size: 0/5000000 bytes
-->
<!--
Transclusion expansion time report (%,ms,calls,template)
100.00%    0.000      1 -total
-->

<!-- Saved in parser cache with key 1.43.8_prod_wonderlandoftheenigma:pcache:idhash:514-0!sseVary=RegularPage!FandomDesktop!LegacyGalleries and timestamp 20260706103807 and revision id 2230. Rendering was triggered because: api-parse
 -->
</div>