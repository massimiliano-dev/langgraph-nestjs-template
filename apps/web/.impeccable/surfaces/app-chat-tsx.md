---
version: 1
slug: 'app-chat-tsx'
primary_target: 'app/chat.tsx'
related_targets: ['app/page.tsx', 'app/layout.tsx']
---

# Agent chat surface

Scope: the single chat screen (`app/page.tsx`, `app/chat.tsx`). Visitor mode: Operate.

Audience and job: day-to-day operators ask the agent for help and must decide, in seconds and with full understanding, whether each side-effect action may run. Developers need tool arguments and ids one step away.

States that must exist: empty thread with suggested prompts, streaming answer, read-only tool running/done, action awaiting clearance, cleared, rejected, tool error, API error, composer blocked while a decision is pending, long answers, narrow screens.

Constraints: standard web controls only; strings centralised for translation (English default); WCAG 2.2 AA; CSP allows only self-hosted fonts and no external hosts.

Chosen direction: Clearance Strips (picked over the rolled Identity Program).

## Direction contract

THESIS: Every action the agent wants to take is a strip on a board, and nothing with side effects moves until a human clears it. Refuses the category default of a centred bubble column with an approval modal or inline card.

OWN-WORLD: Light working ground for the conversation; the strip board is a dark slate shell (#1C2530). Strips are flat coloured bodies by class: cyan for read-only lookups, yellow for actions with side effects, rose for rejected. Condensed numerals for strip number and time; a highly legible humanist sans for reading. States are marks drawn on the strip: a tick for cleared, a struck diagonal for rejected.

STORY: The operator asks, reads the streamed answer, sees each lookup land as a cyan strip, and when the agent wants to act, a yellow strip arrives in "Awaiting clearance" with the action in plain words and its exact arguments; they clear or reject it and watch it move to the log.

FIRST VIEWPORT: Top bar with product name, thread and tenant. Left: conversation, measure about 68ch, composer pinned at the bottom. Right, 380px: the dark strip board with the "Awaiting clearance" bay on top and the strip log below. On narrow screens the pending strip docks above the composer and the log opens from a "Strips" button.

FORM: Air-traffic flight progress strips, position 1 on the ordered list; seed key 56c03e07. Signature interaction: clearing a strip draws its tick and slides it from the bay into the log (reduced motion: instant).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
