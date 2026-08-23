# Director Splitting

<div class="mw-content-ltr mw-parser-output" lang="en" dir="ltr">

<h1><span class="mw-headline" id="Director_Splitting">Director Splitting</span></h1>
<p><b>Director Splitting</b> is the formal procedure used to determine how <a data-wte-link="wte://rules/Incept">Incepts</a> emerge from a character’s Trait Pools.  It is a core mechanical ritual that governs which traits express, how strongly they manifest, and how lineage and pressure reshape a character’s biology and identity.
</p><p>Director Splitting is <b>not a narrative suggestion</b> or loose guideline.  It is a required system used to ensure fairness, consistency, and emergent identity across all characters.
</p>
<h2><span class="mw-headline" id="Purpose_of_Director_Splitting">Purpose of Director Splitting</span></h2>
<p>Director Splitting exists to answer three questions:
</p>
<ul><li><b>Which Incept manifests now?</b></li>
<li><b>How does this Incept reshape the Trait Pools?</b></li>
<li><b>How do species, lineage, and narrative pressure influence future expressions?</b></li></ul>
<p>By following a clear, repeatable sequence, Directors avoid arbitrary decisions while still curating thematically appropriate outcomes.
</p>
<h2><span id="What_.E2.80.9CSplitting.E2.80.9D_Is"></span><span class="mw-headline" id="What_“Splitting”_Is">What “Splitting” Is</span></h2>
<p>In this system, a <b>Split</b> is the moment when a character’s latent Trait Pool collapses into a <b>single expressed Incept</b>.
</p><p>Mechanically, each Split:
</p>
<ul><li>Selects exactly <b>one Incept</b> from the available Trait Pool.</li>
<li>Recalculates Trait values (Dominance, Recessiveness, Expression State).</li>
<li>Alters Expression States across the entire pool.</li>
<li>Applies <b>Drift</b> to non-selected traits.</li>
<li>Automatically triggers a corresponding <b>Wryde Mutation</b>.</li>
<li>Advances Dormant traits toward later expression.</li></ul>
<p>Splitting is not random, but it is <b>non‑deterministic</b>—the Director guides the outcome within the structure of the rules.
</p>
<h4><span class="mw-headline" id="Director_Splitting_Sequence">Director Splitting Sequence</span></h4>
<p>When a Split occurs (for example, when a character gains a new Incept opportunity), the Director must follow this sequence **in order**.  Skipping or reordering steps breaks the intended balance of the system.
</p>
<h2><span id="Step_1:_Lock_Species_.26_Lineage_Context"></span><span class="mw-headline" id="Step_1:_Lock_Species_&amp;_Lineage_Context">Step 1: Lock Species &amp; Lineage Context</span></h2>
<p>Before any calculations are made, the character’s <b>biological context</b> is locked in.
</p>
<h3><span class="mw-headline" id="Species_Context">Species Context</span></h3>
<p>Each character’s current primary species provides:
</p>
<ul><li><b>Base Dominance (BD)</b></li>
<li><b>Base Recessiveness (BR)</b></li></ul>
<p>These values represent the species’ natural tendency to assert or hide traits.  BD and BR <b>do not change during the Split</b>; they define the static environment in which Incepts are evaluated.
</p>
<h3><span class="mw-headline" id="Lineage_Context">Lineage Context</span></h3>
<p>The character’s <a data-wte-link="wte://rules/Lineage">Lineage</a> provides a <b>Lineage Modifier (LM)</b>, representing generational pressure and ancestral bias.
</p><p>Important lineage effects:
</p>
<ul><li>Ancestors with <b>high Dominance</b> exert upward pressure on related traits.</li>
<li>Even if both parents trend Recessive, a highly dominant grandparent can push traits toward expression.</li>
<li>This causes Dormant traits to drift upward, Recessive-heavy pools to destabilize, and old ancestral traits to “stick out” during Splits.</li></ul>
<p>Lineage does not replace Species context; it modifies how strongly individual Incepts respond to it.
</p>
<h2><span class="mw-headline" id="Step_2:_Identify_the_Trait_Pool">Step 2: Identify the Trait Pool</span></h2>
<p>Next, the Director identifies the <b>Trait Pool</b> relevant to this Split.
</p><p>The Trait Pool contains all possible Incepts the character could express at this moment, based on:
</p>
<ul><li>Template Species</li>
<li>Lineage composition</li>
<li>Heritage (if unlocked)</li>
<li>Current narrative state (High/Low points, thematic arcs)</li></ul>
<p>Each Incept in the pool already has:
</p>
<ul><li><b>Base Dominance</b> (intrinsic to the Incept)</li>
<li><b>Base Recessiveness</b> (intrinsic)</li>
<li><b>Weight Class</b> (Light / Medium / Heavy, or equivalent tiers)</li>
<li>(Optional) fixed Wryde Mutation or Wryde constraints</li></ul>
<p>At this stage, nothing is selected—this is only potential.
</p>
<h2><span class="mw-headline" id="Step_3:_Calculate_Effective_Values">Step 3: Calculate Effective Values</span></h2>
<p>For <b>every</b> Incept in the pool, the Director calculates its effective behavior inside this character’s biology.
</p><p>
For each Incept:</p><pre>Effective Dominance (ED)   = (Incept Dom ÷ Species BD) × Lineage Modifier
Effective Recessiveness (ER) = (Incept Rec ÷ Species BR) × Lineage Modifier
</pre>
<ul><li><b>Incept Dom</b> and <b>Incept Rec</b> are the Incept’s intrinsic values.</li>
<li><b>Species BD/BR</b> come from the current species environment.</li>
<li><b>Lineage Modifier</b> incorporates ancestry and generational pressure.</li></ul>
<p>ED and ER determine:
</p>
<ul><li>Where the Incept lands on LOW → MED → HIGH axes.</li>
<li>Whether it tends toward expression or suppression.</li>
<li>Whether its Expression State is Dormant, Suppressed, Normal, or Stable Active.</li></ul>
<p>These calculations are performed <b>for all Incepts in the pool</b>, even those that will not be selected this Split.
</p>
<h2><span id="Effective_Dominance_.26_Recessiveness_.28ED.2FER.29"></span><span class="mw-headline" id="Effective_Dominance_&amp;_Recessiveness_(ED/ER)">Effective Dominance &amp; Recessiveness (ED/ER)</span></h2>
<p><b>Effective Dominance (ED)</b> and <b>Effective Recessiveness (ER)</b> determine how likely an Incept is to express within a character’s biology.  They are derived from the Incept’s own values, the character’s Species, and their Lineage pressure.
</p>
<h3><span id="ED.2FER_Formula"></span><span class="mw-headline" id="ED/ER_Formula">ED/ER Formula</span></h3><p>
For each Incept in the Trait Pool, the Director calculates:</p><pre>Effective Dominance (ED)   = (Incept Dominance ÷ Species Base Dominance) × Lineage Modifier
Effective Recessiveness (ER) = (Incept Recessiveness ÷ Species Base Recessiveness) × Lineage Modifier
</pre>
<ul><li><b>Incept Dominance / Recessiveness</b> – intrinsic values of the Incept.</li>
<li><b>Species Base Dominance / Recessiveness</b> – the current Template Species’ genetic baseline.</li>
<li><b>Lineage Modifier</b> – total generational pressure from ancestors.</li></ul>
<p>These values are calculated for <b>every</b> Incept in the pool whenever a Split occurs.
</p>
<h3><span class="mw-headline" id="Practical_Ranges">Practical Ranges</span></h3>
<p>To keep the system readable at the table, it is recommended that:
</p>
<ul><li>Incept Dominance / Recessiveness typically range from <b>5–40</b> (up to 50 for extreme cases).</li>
<li>Species Base Dominance / Base Recessiveness range from <b>10–40</b>.</li>
<li>Lineage Modifier ranges from <b>1–5</b> (1 = weak ancestral pull, 5 = very strong).</li></ul>
<p>Within these inputs:
</p>
<ul><li>The lowest meaningful ED/ER values will usually fall around <b>0–1</b> (negligible influence).</li>
<li>The highest ED/ER values will usually fall in the <b>15–25</b> range for extreme combinations.</li></ul>
<p>Directors may cap values (for example, designing so most traits land between 0–16) to keep interpretation simple.
</p>
<h2><span id="Interpreting_ED.2FER:_Expression_Bands"></span><span class="mw-headline" id="Interpreting_ED/ER:_Expression_Bands">Interpreting ED/ER: Expression Bands</span></h2>
<p>ED and ER are used to determine the Incept’s current <b>Expression State</b>.  The Director compares both the absolute values and their relationship to each other.
</p><p>A suggested banding:
</p>
<ul><li><b>Dormant</b>
<ul><li>Conditions: ED &lt; 2 and ED ≤ 0.5 × ER, or ED ≤ 1 regardless of ER.</li>
<li>Meaning: The Incept exists mathematically but has almost no push toward surface expression.</li>
<li>Effect: Cannot be selected during a Split; only affected by Drift and future pressure.</li></ul></li></ul>
<ul><li><b>Suppressed</b>
<ul><li>Conditions: ED between ~2–5, or ED &lt; ER in that range.</li>
<li>Meaning: The Incept is present but unstable or weak; it influences the pool indirectly.</li>
<li>Effect: Not selectable unless special unstable-rules apply, but it is closer to expression than Dormant traits.</li></ul></li></ul>
<ul><li><b>Normal</b>
<ul><li>Conditions: ED between ~5–12 and ED ≥ ER, or ED and ER are roughly equal (for example, ED/ER between 0.75 and 1.25 in that range).</li>
<li>Meaning: The Incept is fully usable.</li>
<li>Effect: This is the main band from which Directors choose Incepts during Splitting.</li></ul></li></ul>
<ul><li><b>Stable Active</b>
<ul><li>Conditions: ED ≥ ~12 (or higher, if using a larger range) and ED ≥ 1.5 × ER.</li>
<li>Meaning: The Incept is robust, thematically central, and very difficult to suppress.</li>
<li>Effect: Always selectable during Splitting and often persists through future recalculations.</li></ul></li></ul>
<p>Directors can adjust the numeric thresholds to match how large ED/ER values typically become in their campaign, but the relative logic (Dormant → Suppressed → Normal → Stable Active) should remain intact.
</p>
<h2><span class="mw-headline" id="Optional_Design_Caps">Optional Design Caps</span></h2>
<p>To keep numbers easy to read on character sheets, a Director may enforce soft caps such as:
</p>
<ul><li>Incept Dominance / Recessiveness: 0–40</li>
<li>Species Base Dominance / Recessiveness: 10–40</li>
<li>Lineage Modifier: 1–4</li></ul>
<p>Under these caps, most ED/ER values will fall between 0–16, which fits cleanly into:
</p>
<ul><li>0–1: Dormant</li>
<li>&gt;1–4: Suppressed</li>
<li>&gt;4–10: Normal</li>
<li>&gt;10–16: Stable Active</li></ul>
<p>This makes it simple to draw a 0–16 bar on the sheet and mark where each Incept sits after recalculation.
</p>
<h3><span class="mw-headline" id="Director_Usage">Director Usage</span></h3>
<p>When performing a Split:
</p>
<ol><li>Lock Species Base Dominance/Recessiveness and the Lineage Modifier for the character.</li>
<li>Calculate ED and ER for every Incept in the Trait Pool.</li>
<li>Assign Expression States based on the bands above.</li>
<li>Only consider Incepts in <b>Normal</b> or <b>Stable Active</b> for manifestation.</li>
<li>Apply Drift to non-selected Incepts, which can later move them from Dormant → Suppressed → Normal.</li></ol>
<p>By consistently using ED/ER bands, Directors can justify which Incepts manifest and show players that their ancestry, species, and story pressure have tangible mechanical weight.
</p>
<h1><span class="mw-headline" id="Incept_Record_Structure">Incept Record Structure</span></h1>
<p>For ease of use, each Incept in the pool can be tracked using a structured record.
</p>
<h2><span class="mw-headline" id="Species_Header">Species Header</span></h2>
<p>At the top of any Split record, capture the current species context:
</p>
<ul><li><b>Species Name</b></li>
<li><b>Base Dominance / Base Recessiveness</b></li>
<li><b>Lineage Modifier</b></li></ul>
<p>These three values define the mathematical environment of the Split.
</p>
<h2><span class="mw-headline" id="Incept_Fields">Incept Fields</span></h2>
<p>Each Incept entry should include:
</p>
<ul><li><b>Incept Name</b></li></ul>
<pre> The biological or metaphysical trait being evaluated.  
</pre>
<ul><li><b>Weight Class</b></li></ul>
<pre> Determines how violently the Incept shifts other traits and how much Drift it generates.  
 * Light traits nudge the pool.  
 * Heavy traits destabilize the pool and strongly resist suppression.
</pre>
<ul><li><b>Base Dominance / Base Recessiveness</b></li></ul>
<pre> Intrinsic values of the Incept. They <b>never change</b>—they define the trait itself, not its current expression.
</pre>
<ul><li><b>Effective Dominance / Effective Recessiveness</b></li></ul>
<pre> The calculated values (ED/ER) used for Expression.  
 These place the Incept onto the LOW / MED / HIGH regions of the chart.
</pre>
<ul><li><b>Expression State (ES)</b></li></ul>
<pre> The current functional state of the Incept. Expression State is **derived**, never chosen.
</pre>
<table class="wikitable">
<tbody><tr>
<th>State
</th>
<th>Mechanical Meaning
</th></tr>
<tr>
<td><b>Dormant</b>
</td>
<td>Incept exists but cannot be selected this Split.
</td></tr>
<tr>
<td><b>Suppressed</b>
</td>
<td>Incept exists, is unstable or weak; minor or indirect influence at most.
</td></tr>
<tr>
<td><b>Normal</b>
</td>
<td>Incept is fully usable and selectable during Splitting.
</td></tr>
<tr>
<td><b>Stable Active</b>
</td>
<td>Incept is guaranteed, robust, and often thematically central to the character.
</td></tr></tbody></table>
<p>Expression State is derived from the relationship between ED and ER and the overall pool (for example, ED high / ER low tends toward Normal or Stable Active; high ER with low ED trends toward Dormant or Suppressed).
</p>
<ul><li><b>DDC / Drift</b></li></ul>
<pre> Each non-selected Incept accumulates <b>Drift</b> every time a Split or qualifying narrative event occurs.  
 Drift is tracked via a <b>Dormant Drift Counter (DDC)</b>.
</pre>
<pre> Every Split adds Drift to all Incepts that were not chosen.  
 Drift represents pressure pushing Dormant traits toward visibility.
</pre>
<pre> <b>Dormant → Suppressed Rule</b>  
 When an Incept’s DDC reaches the system threshold (default: 5), that Incept automatically shifts from <b>Dormant</b> to <b>Suppressed</b>.  
 No explicit Director permission is required—this is a deterministic rule.
</pre>
<ul><li><b>Narrative Modifier</b></li></ul>
<pre> Narrative context can increase or protect Expression but cannot erase the math.
</pre>
<pre> Narrative may:
 -Accelerate Drift for thematically reinforced traits.  
 -Prevent regression for traits deeply bound to the character’s arc.  
 -Temporarily lock an Expression State.
</pre>
<pre> Narrative cannot directly override ED/ER calculations, but it can adjust when or how Drift is applied and whether a trait regresses.
</pre>
<ul><li><b>Notes / Special Conditions</b></li></ul>
<pre> Used for:
 -Fixed or guaranteed Wryde Mutations.  
 -Conditional unlocks (e.g., only after a specific High Point).  
 -Species or Heritage overrides.  
 -Director flags (such as “must be considered next Split”).
</pre>
<h2><span id="Selecting_the_Incept_.28The_Split.29"></span><span class="mw-headline" id="Selecting_the_Incept_(The_Split)">Selecting the Incept (The Split)</span></h2>
<p>Once all Incepts in the pool have ED, ER, Expression States, and Drift updated, the Director performs the actual Split.
</p>
<h2><span class="mw-headline" id="Selection_Rules">Selection Rules</span></h2>
<p>The Director may choose:
</p>
<ul><li>Any Incept currently in <b>Normal</b> state.</li>
<li>Any Incept currently in <b>Stable Active</b> state.</li></ul>
<p>The Director may not choose:
</p>
<ul><li><b>Dormant</b> Incepts.</li>
<li><b>Suppressed</b> Incepts (unless the game explicitly allows unstable or experimental expression, as a special rule or event).</li></ul>
<p>If multiple viable Incepts exist in Normal/Stable Active, the Director selects the one that:
</p>
<ol><li>Best reflects current biological and narrative pressure.</li>
<li>Produces the most meaningful or interesting change in the Trait Pool.</li>
<li>Aligns with lineage momentum and species logic.</li></ol>
<p>This is **curation, not favoritism**—the Director is not picking a “favorite power,” but choosing which outcome best fits the character’s emerging identity.
</p>
<h1><span class="mw-headline" id="After_the_Split:_Consequences">After the Split: Consequences</span></h1>
<p>Once an Incept is selected and manifests, the Split produces several mandatory outcomes.
</p>
<h2><span class="mw-headline" id="Pool_Recalculation">Pool Recalculation</span></h2>
<p>After selection:
</p>
<ul><li>All other Incepts in the pool gain Drift.</li>
<li>ED/ER values for future Splits may be recalculated if Species, Lineage, or Heritage context has changed.</li>
<li>Dormant traits may tick upward toward Suppressed due to cumulative Drift.</li>
<li>Some Suppressed traits may approach Normal if narrative and lineage pressure continue to favor them.</li></ul>
<p>No Incept exists in isolation—each manifestation reshapes the entire landscape of future possibilities.
</p>
<h2><span class="mw-headline" id="Wryde_Mutation">Wryde Mutation</span></h2>
<p>Every manifested Incept triggers a <b>Wryde Mutation</b>.
</p>
<ul><li>Some Incepts have fixed, pre‑defined Wrydes.</li>
<li>Others generate derived Wrydes determined at the moment of manifestation.</li>
<li>Wrydes are not optional.</li>
<li>Wrydes do not require instability; they are the inherent cost of expression.</li></ul>
<p>A Wryde:
</p>
<ul><li>Alters the character’s body, behavior, senses, or presence.</li>
<li>Never directly alters the external world—only how the character occupies it.</li>
<li>May be cosmetic, psychological, or deeply biological.</li></ul>
<p>The Wryde ties the Incept to visible or experiential change, ensuring that each Split leaves a mark.
</p>
<h1><span id="Drift_.26_Expression_Progression"></span><span class="mw-headline" id="Drift_&amp;_Expression_Progression">Drift &amp; Expression Progression</span></h1>
<p>Director Splitting interacts with a broader Expression system, where traits move along a spectrum:
</p>
<pre>Dormant → Suppressed → Normal → Stable Active
</pre>
<h2><span class="mw-headline" id="Drift_Mechanics">Drift Mechanics</span></h2>
<p>Whenever:
</p>
<ul><li>A character gains a new Incept opportunity, **or**</li>
<li>Experiences a relevant High/Low Point,</li></ul>
<p>each Dormant or Suppressed trait may gain an <b>Expression Drift Tick (EDT)</b>.
</p><p>
A common model:</p><pre>EDT Gain = 1 (Baseline)
         + Lineage Bias
         + Species Alignment
         + Narrative Reinforcement
         − Trait Conflict
</pre><p>Typical modifiers might include:
</p><ul><li>+1 per ancestor with Normal/Stable Active version of the trait.</li>
<li>+2 if an ancestor’s Dominance for that trait ≥ 30.</li>
<li>+1 if species strongly aligns with that trait’s nature.</li>
<li>+1 if recent play heavily reinforces the trait’s theme.</li>
<li>−1 per conflicting active trait (up to a cap).</li></ul>
<p>When DDC (for Dormant traits) reaches the threshold (usually 5), the trait becomes <b>Suppressed</b>.  Suppressed traits can, over time and via continued Drift, reach <b>Normal</b> and then <b>Stable Active</b>.
</p><p>Director Splitting is the discrete event where these slow pressures are resolved into concrete manifestations.
</p>
<h1><span class="mw-headline" id="Why_This_System_Works">Why This System Works</span></h1>
<p>Director Splitting is designed as a <b>pressure-based evolution engine</b>, not a perk menu.
</p><p><i><b>It works because:</b></i>
</p>
<ul><li>Directors follow a clear procedure instead of instinct alone.</li>
<li>Players are not locked behind arbitrary permission; traits emerge through math and story.</li>
<li>Dormant traits naturally drift toward expression over time.</li>
<li>Lineage, Species, and Heritage always matter in a visible way.</li>
<li>Every Split reshapes the trait landscape, making future choices feel connected.</li></ul>
<p>Characters do not simply “pick powers.”  They undergo biologically and narratively coherent transformation.
</p>
<h2><span id="Quick_Director_Rules_.28Non.E2.80.91Negotiable.29"></span><span class="mw-headline" id="Quick_Director_Rules_(Non‑Negotiable)">Quick Director Rules (Non‑Negotiable)</span></h2>
<p>For every Split:
</p>
<ol><li>Always calculate or update <b>all Incepts</b> in the pool.</li>
<li>Never assign Expression States manually; always derive them from ED/ER and Drift.</li>
<li>A Wryde Mutation always occurs when an Incept manifests.</li>
<li>Drift always accumulates for non-selected traits when conditions apply.</li>
<li>Lineage and Species context always apply to calculations.</li>
<li>Exactly one Incept manifests per Split.</li></ol>
<p>If these rules are followed, Director Splitting remains consistent, fair, and thematically powerful across campaigns.
</p>
<h2><span id="Example_Walkthrough_.28Reference.29"></span><span class="mw-headline" id="Example_Walkthrough_(Reference)">Example Walkthrough (Reference)</span></h2>
<p><b>Character:</b> Sentauri warrior with strong ancestral Strength traits.  <b>Context:</b> New Incept opportunity after a brutal combat arc.
</p>
<ul><li>Species: Sentauri – high Recessiveness support.</li>
<li>Ancestor: Grandparent with Dominance 40 and Stable Active Strength Incept.</li>
<li>Candidate Incepts in pool:</li></ul>
<pre> * Crushing Force (Dormant)  
 * Twisted Body (Dormant)  
 * Minor Reflex Shift (Normal)
</pre>
<p>1. Lock Species &amp; Lineage
</p>
<pre>  * BD, BR from Sentauri set.  
  * LM increased due to dominant ancestor.
</pre>
<p>2. Identify Trait Pool
</p>
<pre>  * All three Incepts are valid candidates.
</pre>
<p>3. Calculate ED/ER
</p>
<pre>  * Crushing Force gains high ED from ancestor and narrative.  
  * Twisted Body remains lower priority.  
  * Minor Reflex Shift remains Normal.
</pre>
<p>4. Drift Application
</p>
<pre>  * Both Dormant traits gain EDT from combat: baseline + lineage + species + narrative − conflict.  
  * Crushing Force’s DDC hits threshold → moves from Dormant to Suppressed or even Normal, depending on math.
</pre>
<p>5. Selection
</p>
<pre>  * Director may now choose between Minor Reflex Shift (Normal) and a newly Normal Crushing Force.  
  * Combat-focused narrative and lineage strongly favor Crushing Force → it is selected.
</pre>
<p>6. Aftermath
</p>
<pre>  * Crushing Force manifests (Normal or Stable Active depending on ED/ER).  
  * A Wryde Mutation tied to brute physicality appears.  
  * Other traits gain Drift for future Splits.
</pre>
<p>Over time, the character’s Inherence tells a coherent story: not of arbitrary upgrades, but of pressure‑shaped evolution.
</p><p>---
</p>
<!-- 
NewPP limit report
Cached time: 20260706103755
Cache expiry: 2592000
Reduced expiry: false
Complications: [show‐toc]
CPU time usage: 0.028 seconds
Real time usage: 0.033 seconds
Preprocessor visited node count: 101/1000000
Post‐expand include size: 0/2097152 bytes
Template argument size: 0/2097152 bytes
Highest expansion depth: 2/100
Expensive parser function count: 0/100
Unstrip recursion depth: 0/20
Unstrip post‐expand size: 528/5000000 bytes
-->
<!--
Transclusion expansion time report (%,ms,calls,template)
100.00%    0.000      1 -total
-->

<!-- Saved in parser cache with key 1.43.8_prod_wonderlandoftheenigma:pcache:idhash:366-0!sseVary=RegularPage!FandomDesktop!LegacyGalleries and timestamp 20260706103755 and revision id 1842. Rendering was triggered because: api-parse
 -->
</div>