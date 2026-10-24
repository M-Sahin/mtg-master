# Rules and interactions

Answer like a judge: exact oracle text first, then the rules that apply, then a step-by-step walk of what happens. CR section numbers below are stable anchors, but sub-numbers shift between CR updates — cite the section confidently and the sub-rule only when you're sure.

## Contents
1. Method for any interaction question
2. Core engine: priority, stack, resolution
3. State-based actions
4. Triggered, activated, static abilities
5. Replacement and prevention effects
6. Layers
7. Combat
8. Keywords people get wrong
9. Commander-specific rules
10. Frequently misunderstood interactions
11. Tournament / shortcut issues

## 1. Method

1. Get exact oracle text for every card involved (see lookup.md). Old printed wording is irrelevant; oracle text governs. Check the card's rulings too — they often answer the exact question.
2. Classify each piece: spell, activated ability, triggered ability, static ability, replacement effect, mana ability.
3. Walk the timeline: who has priority, what's cast/activated, what triggers, the order triggers go on the stack (APNAP), what resolves, state-based action checks between.
4. State the result plainly, then any "but if…" branches that matter.

## 2. Core engine (CR 117, 405, 608)

- Players get priority in turn order starting with the active player; the top object resolves only when all players pass in succession with no new actions.
- Casting = announce, choose modes/X/targets, determine and pay total cost (CR 601). Targets are chosen on cast and rechecked on resolution: if *all* targets are illegal, the spell/ability doesn't resolve; if some are, it does what it can to the legal ones.
- Mana abilities don't use the stack (CR 605). Mana empties from the pool between steps and phases.
- Abilities on the stack are independent of their source: killing the source doesn't stop the ability (CR 113.7a). Countering an ability requires something that says "ability" (Stifle-style), not a counterspell.
- Copying a spell is not casting it — no cast triggers, no storm, no "when you cast" (CR 707.10).
- Split second (CR 702.61): players can't cast spells or activate non-mana abilities while it's on the stack; triggers and mana abilities still happen.

## 3. State-based actions (CR 704)

Checked whenever a player would receive priority, all simultaneously, repeated until none apply; then triggers go on the stack. Key ones: 0 or less life loses; drawing from an empty library loses (at next check); 10+ poison; creature with toughness ≤0 goes to graveyard (not destruction — indestructible doesn't help); lethal damage or deathtouch damage destroys; planeswalker with 0 loyalty; legend rule (controller chooses one, rest go to graveyard — they do "die"); auras attached illegally; +1/+1 and -1/-1 counters annihilate; 21+ commander damage from one commander.

## 4. Abilities (CR 113, 602, 603)

- Triggered abilities ("when/whenever/at") go on the stack the next time a player would get priority. APNAP order (CR 101.4): active player puts all of theirs on the stack first in the order they choose, then each other player in turn order — so the non-active player's triggers resolve first.
- Leaves-the-battlefield and "dies" triggers "look back in time" (CR 603.10) — they see the game as it was before the event, so a creature that dies with a sweeper sees the other creatures dying alongside it.
- Intervening "if" clauses (CR 603.4) are checked both on trigger and on resolution.
- "Enters" triggers and replacement effects ("enters with", "as … enters") are different: the latter modify the event and can't be responded to.
- Summoning sickness (CR 302.6) stops attacking and any {T}/{Q} ability of a creature, including mana abilities, unless it's been continuously controlled since the start of the controller's most recent turn.

## 5. Replacement and prevention (CR 614–616)

- They modify an event as it happens; they don't use the stack and can't be responded to.
- Each replacement applies only once to a given event. If several could apply, the affected player (or controller of the affected object) chooses the order (CR 616.1), with self-replacement effects and "enters" control-changing ones first.
- Classic consequences: Rest in Peace / Leyline of the Void style exile means creatures never hit the graveyard, so "dies" triggers don't happen. "Instead" is the replacement signal word.

## 6. Layers (CR 613)

Continuous effects apply in layer order:
1. Copy effects (1a), face-down (1b)
2. Control-changing
3. Text-changing
4. Type-changing
5. Color-changing
6. Ability adding/removing (incl. "can't have" abilities)
7. Power/toughness: 7a characteristic-defining abilities, 7b effects that set P/T, 7c effects that modify P/T **including counters**, 7d switching P/T

Within a layer: dependency first (CR 613.8 — if A changes what B applies to or does, B waits for A), otherwise timestamp order (CR 613.7). Famous test cases: Blood Moon + Urborg, Humility + Opalescence, Opalescence + a P/T-setting effect, a creature losing abilities after a +X/+X anthem (the anthem still applies because it's a separate effect).

## 7. Combat (CR 506–511)

Steps: beginning of combat → declare attackers (attackers tap unless vigilance; "attacks" triggers) → declare blockers → (first-strike damage step if any creature has first/double strike) → combat damage → end of combat.

- Attacking and blocking requirements/restrictions: maximize requirements without breaking restrictions (CR 508.1d/509.1c).
- Damage assignment order was removed (2024 update, CR 510): the attacking player divides damage among blockers as they choose at damage time. With trample, assign lethal (deathtouch makes 1 lethal) to all blockers before trampling over. Verify this against the current CR if the user's question hinges on older rules.
- Removing a blocker doesn't make the attacker unblocked; it deals no damage unless it has trample (then all can go to the player).
- Double strike deals damage in both steps; first strike only in the first. In the regular step, damage is dealt by creatures that had neither first strike nor double strike when the first-strike step began, plus anything that currently has double strike (CR 510.4). So giving a creature first strike after the first-strike step doesn't stop it dealing regular damage, and removing first strike from one that already struck doesn't let it strike again.
- Damage stays marked until cleanup (CR 514.2).

## 8. Keywords people get wrong

- **Protection** (CR 702.16) — DEBT: can't be Damaged (prevented), Enchanted/Equipped, Blocked, Targeted by things with that quality. Doesn't stop sweepers or "each opponent" effects.
- **Hexproof** — only opponents can't target. **Shroud** — no one can. **Ward** — counter unless the cost is paid. It's a triggered ability, so it still works against split second (split second doesn't stop triggers), but a spell that "can't be countered" ignores it.
- **Indestructible** — not destroyed by lethal damage or "destroy". Still dies to -X/-X / toughness 0, sacrifice, exile, legend rule.
- **Deathtouch** — any nonzero damage is lethal, including from noncombat damage sources.
- **Lifelink** — damage dealt causes life gain simultaneously; not a trigger.
- **Flash, Vigilance, Menace, Reach, Haste** — straightforward, but check for "can't be blocked except by…" interactions with menace.
- **Cascade / Discover** — cast the found card without paying its mana cost; X is 0.
- **Mutate, Adventure, MDFC, Room, Prototype, Station/new mechanics** — always pull the reminder text and rulings; these have specific zone/characteristic rules and newer mechanics may postdate your training.

## 9. Commander rules (CR 903)

- 100 cards including commander(s), singleton except basic lands and cards that say otherwise. Color identity = all mana symbols in cost and rules text (not reminder text), plus color indicator; hybrid counts as both colors.
- 40 starting life (multiplayer). 21 combat damage from a single commander → loss. Commander tax: {2} more per previous cast from the command zone.
- If a commander would go to hand or library, owner may move it to the command zone instead (replacement). If it goes to graveyard or exile, owner may move it to the command zone the next time state-based actions are checked — so "dies" triggers still happen.
- First mulligan in multiplayer is free (CR 103.5c).
- Format ownership and banned list now sit with Wizards (since late 2024); brackets and Game Changers are managed there — look up the current versions.

## 10. Frequently misunderstood interactions

- Tokens "die" and trigger death triggers, then cease to exist.
- Countering a creature spell prevents ETB; "flickering" (exile and return) makes a new object with no memory of the old one — counters, auras and damage are gone.
- Cards that say "can't be countered" can still be fizzled by illegal targets.
- Sacrifice is a cost if it's before the colon or in "As an additional cost" — you can't respond to stop it.
- "Whenever you cast" triggers resolve before the spell (they go on top of it).
- Infinite combos: if a loop is optional, the player names a number of iterations; if it's mandatory and no one can break it, the game is a draw (CR 104.4b, 732).
- Last known information: if an ability needs info about an object that left, it uses the object's last-known state.
- "Destroy target creature. Its controller gains life equal to its power" — still uses LKI if it died.

## 11. Tournament play

At Competitive REL the Magic Tournament Rules and Infraction Procedure Guide apply (shortcuts, hidden information, missed triggers). For "who's responsible for this trigger / what's the penalty" questions, say which REL you're assuming and point to the MTR/IPG; don't invent penalties.
