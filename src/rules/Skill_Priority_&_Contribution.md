# Skill Priority & Contribution

<div class="mw-content-ltr mw-parser-output" lang="en" dir="ltr">

<h1><span id="Action_Point_.28AP.29_and_Contribution_System_Breakdown"></span><span class="mw-headline" id="Action_Point_(AP)_and_Contribution_System_Breakdown"><b>Action Point (AP) and Contribution System Breakdown</b></span></h1>
<h2><span class="mw-headline" id="AP_System">AP System</span></h2>
<h3><span class="mw-headline" id="._Base_AP_Per_Turn"><b>. Base AP Per Turn</b></span></h3>
<ul><li>Every character starts their turn with a base amount of AP, determined by: <b>Base AP = Contribution / 2</b> (rounded down)</li>
<li>Example: A character with <b>Contribution 12</b> would start each turn with <b>6 AP</b>.</li></ul>
<hr>
<h3><span class="mw-headline" id="._Regeneration_Per_Turn"><b>. Regeneration Per Turn</b></span></h3>
<ul><li>Characters regenerate AP at the <b>start of their turn</b>, potentially scaling with their level or stamina.</li>
<li>Possible formulas:
<ul><li><b>Flat Regeneration</b> → +2 or +3 AP per turn.</li>
<li><b>Scaling Regeneration</b> → AP Regen = <b>⌊Contribution / 4⌋</b> per turn.</li></ul></li></ul>
<hr>
<h3><span id="._AP_Carryover_.26_Overclocking"></span><span class="mw-headline" id="._AP_Carryover_&amp;_Overclocking"><b>. AP Carryover &amp; Overclocking</b></span></h3>
<ul><li><b>Unused AP</b> from one turn can be <b>carried over</b> to the next, up to a limit (e.g., max carryover = <b>Contribution / 3</b>).</li>
<li><b>Overclocking:</b> A character can <b>push beyond their AP limit</b> by burning Fatigue Points (e.g., gain +2 AP but take +3 FP).</li></ul>
<h2><span class="mw-headline" id="1._Contribution_System"><b>1. Contribution System</b></span></h2>
<p>The <b>Contribution</b> system determines how Action Points (AP) scale for each character. As a character's Contribution increases, they can use more Action Points per action.
</p>
<h3><span class="mw-headline" id="Contribution_Formula:"><b>Contribution Formula:</b></span></h3>
<table class="fandom-table">
<tbody><tr>
<th><b>Formula</b>
</th>
<th><b>Description</b>
</th></tr>
<tr>
<td>Contribution = ⌊(Level × 1.5) / Scale + Base Contribution⌋
</td>
<td>Calculates the amount of Contribution based on the character's level, scale, and base contribution.
</td></tr></tbody></table>
<h3><span class="mw-headline" id="Example_Calculation:"><b>Example Calculation:</b></span></h3>
<table class="fandom-table">
<tbody><tr>
<th><b>Level</b>
</th>
<th><b>Scale</b>
</th>
<th><b>Base Contribution</b>
</th>
<th><b>Contribution</b> Formula
</th>
<th><b>Contribution</b> Result
</th></tr>
<tr>
<td>50
</td>
<td>10
</td>
<td>5
</td>
<td>(50 × 1.5) / 10 + 5 = 12
</td>
<td>12
</td></tr>
<tr>
<td>150
</td>
<td>10
</td>
<td>5
</td>
<td>(150 × 1.5) / 10 + 5 = 27
</td>
<td>27
</td></tr></tbody></table>
<hr>
<h2><span id="2._Action_Points_.28AP.29_System"></span><span class="mw-headline" id="2._Action_Points_(AP)_System"><b>2. Action Points (AP) System</b></span></h2>
<p>The <b>AP Cost</b> for each skill is determined by its <b>Priority Value (PV)</b> and the character's <b>Contribution</b>. <b>Lower Priority Skills</b> are more powerful and cost more AP, while <b>Higher Priority Skills</b> are simpler and cost less AP.
</p>
<h3><span class="mw-headline" id="AP_Cost_Formula:"><b>AP Cost Formula:</b></span></h3>
<table class="fandom-table">
<tbody><tr>
<th><b>Formula</b>
</th>
<th><b>Description</b>
</th></tr>
<tr>
<td>AP Cost = ⌈PV / Contribution⌉
</td>
<td>This calculates how many Action Points a skill will cost.
</td></tr></tbody></table>
<h3><span id="AP_Cost_Breakdown_by_Priority_Value_.28PV.29:"></span><span class="mw-headline" id="AP_Cost_Breakdown_by_Priority_Value_(PV):"><b>AP Cost Breakdown by Priority Value (PV):</b></span></h3>
<table class="fandom-table">
<tbody><tr>
<th><b>Priority Value (PV)</b>
</th>
<th><b>Action Points (AP) Cost</b>
</th>
<th><b>Description</b>
</th></tr>
<tr>
<td>81–100+
</td>
<td>5+
</td>
<td>High priority skills (powerful).
</td></tr>
<tr>
<td>21–80
</td>
<td>2–4
</td>
<td>Mid priority skills (balanced).
</td></tr>
<tr>
<td>1–20
</td>
<td>1
</td>
<td>Low priority skills (basic, quick).
</td></tr></tbody></table>
<h3><span class="mw-headline" id="Example_Calculation:_2"><b>Example Calculation:</b></span></h3>
<table class="fandom-table">
<tbody><tr>
<th><b>Skill</b>
</th>
<th><b>Priority Value (PV)</b>
</th>
<th><b>Contribution</b>
</th>
<th><b>AP Cost Formula</b>
</th>
<th><b>AP Cost</b>
</th></tr>
<tr>
<td>Forsaken Touch
</td>
<td>100
</td>
<td>12
</td>
<td>⌈100 / 12⌉
</td>
<td>9
</td></tr>
<tr>
<td>Echoing Torment
</td>
<td>30
</td>
<td>12
</td>
<td>⌈30 / 12⌉
</td>
<td>3
</td></tr>
<tr>
<td>Forsaken Vow
</td>
<td>60
</td>
<td>12
</td>
<td>⌈60 / 12⌉
</td>
<td>5
</td></tr></tbody></table>
<hr>
<h2><span class="mw-headline" id="3._Priority_Bonus"><b>3. Priority Bonus</b></span></h2>
<p>The <b>Priority Bonus</b> is based on the <b>Sublet Priority Total (SPT)</b>. A <b>higher SPT</b> (which corresponds to <b>lower priority skills</b>) means the character has a higher <b>Priority Bonus</b>, which affects <b>Initiative</b> and <b>action flow</b> within combat.
</p>
<h3><span class="mw-headline" id="Priority_Bonus_Formula:"><b>Priority Bonus Formula:</b></span></h3>
<table class="fandom-table">
<tbody><tr>
<th><b>Formula</b>
</th>
<th><b>Description</b>
</th></tr>
<tr>
<td>Priority Bonus = ⌈SPT / 10⌉
</td>
<td>This calculates the bonus added to the character’s initiative and action priority.
</td></tr></tbody></table>
<h3><span class="mw-headline" id="Example_Calculation_for_SPT_and_Priority_Bonus:"><b>Example Calculation for SPT and Priority Bonus:</b></span></h3>
<table class="fandom-table">
<tbody><tr>
<th><b>Sublet</b>
</th>
<th><b>Skill 1</b>
</th>
<th><b>Skill 2</b>
</th>
<th><b>Skill 3</b>
</th>
<th><b>SPT</b> (Total of PVs)
</th>
<th><b>Priority Bonus</b> Formula
</th>
<th><b>Priority Bonus</b>
</th></tr>
<tr>
<td>Forsaken
</td>
<td>100
</td>
<td>30
</td>
<td>60
</td>
<td>190
</td>
<td>⌈190 / 10⌉
</td>
<td>19
</td></tr></tbody></table>
<hr>
<h2><span class="mw-headline" id="4._Fatigue_and_Balancing"><b>4. Fatigue and Balancing</b></span></h2>
<p>Fatigue Points (FP) are accumulated based on the AP cost of skills. Characters must manage their FP to avoid penalties. <b>Higher priority skills</b> (lower PV) will cost more FP and will accumulate more quickly, requiring careful management.
</p>
<h3><span id="Fatigue_Points_.28FP.29_System:"></span><span class="mw-headline" id="Fatigue_Points_(FP)_System:"><b>Fatigue Points (FP) System:</b></span></h3>
<table class="fandom-table">
<tbody><tr>
<th><b>Skill Priority</b>
</th>
<th><b>Fatigue Cost (FP)</b>
</th>
<th><b>Description</b>
</th></tr>
<tr>
<td>Low Priority (PV 1–20)
</td>
<td>+1 FP
</td>
<td>Basic, quick actions.
</td></tr>
<tr>
<td>Mid Priority (PV 21–80)
</td>
<td>+2–3 FP
</td>
<td>Balanced actions.
</td></tr>
<tr>
<td>High Priority (PV 81–100+)
</td>
<td>+4+ FP
</td>
<td>Powerful actions with a higher cost.
</td></tr></tbody></table>
<h3><span class="mw-headline" id="Fatigue_Threshold:"><b>Fatigue Threshold:</b></span></h3>
<table class="fandom-table">
<tbody><tr>
<th><b>Condition</b>
</th>
<th><b>Effect</b>
</th></tr>
<tr>
<td>FP exceeds Stamina Score
</td>
<td>Initiative drops by 5 per FP over the threshold.
</td></tr>
<tr>
<td>FP exceeds Stamina Score
</td>
<td>Skill effectiveness decreases by 10% per FP over the threshold.
</td></tr></tbody></table>
<!-- 
NewPP limit report
Cached time: 20260706103856
Cache expiry: 2592000
Reduced expiry: false
Complications: [show‐toc]
CPU time usage: 0.017 seconds
Real time usage: 0.025 seconds
Preprocessor visited node count: 54/1000000
Post‐expand include size: 0/2097152 bytes
Template argument size: 0/2097152 bytes
Highest expansion depth: 2/100
Expensive parser function count: 0/100
Unstrip recursion depth: 0/20
Unstrip post‐expand size: 0/5000000 bytes
-->
<!--
Transclusion expansion time report (%,ms,calls,template)
100.00%    0.000      1 -total
-->

<!-- Saved in parser cache with key 1.43.8_prod_wonderlandoftheenigma:pcache:idhash:253-0!sseVary=RegularPage!FandomDesktop!LegacyGalleries and timestamp 20260706103856 and revision id 1106. Rendering was triggered because: api-parse
 -->
</div>