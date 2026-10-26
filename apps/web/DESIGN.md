---
name: Agent chat
description: An agent chat where every tool call is a flight progress strip, and nothing with side effects moves until a human clears it.
colors:
  paper: '#f4f6f8'
  paper-raised: '#ffffff'
  user-tint: '#e3e9ef'
  ink: '#13202b'
  ink-2: '#4a5866'
  rule: '#d3dbe2'
  focus: '#0b63ce'
  danger: '#b42318'
  board: '#1c2530'
  board-2: '#243041'
  board-rule: '#34425a'
  board-ink: '#e6ecf1'
  board-ink-2: '#9daab6'
  board-focus: '#9fd3e6'
  strip-ink: '#10202a'
  lookup: '#9fd3e6'
  lookup-holder: '#7fc0d8'
  action: '#f4d35e'
  action-holder: '#e3bb34'
  rejected: '#f2a7b5'
  rejected-holder: '#e3899b'
typography:
  display:
    fontFamily: 'Barlow Semi Condensed, Arial Narrow, system-ui, sans-serif'
    fontSize: '2.25rem'
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: '-0.01em'
  headline:
    fontFamily: 'Barlow Semi Condensed, Arial Narrow, system-ui, sans-serif'
    fontSize: '1.5rem'
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: 'Barlow Semi Condensed, Arial Narrow, system-ui, sans-serif'
    fontSize: '1.1875rem'
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: 'Atkinson Hyperlegible Next, Segoe UI, system-ui, sans-serif'
    fontSize: '1.0625rem'
    fontWeight: 400
    lineHeight: 1.6
  body-small:
    fontFamily: 'Atkinson Hyperlegible Next, Segoe UI, system-ui, sans-serif'
    fontSize: '0.9375rem'
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: 'Barlow Semi Condensed, Arial Narrow, system-ui, sans-serif'
    fontSize: '0.9375rem'
    fontWeight: 600
  numerals:
    fontFamily: 'Barlow Semi Condensed, Arial Narrow, system-ui, sans-serif'
    fontSize: '0.8125rem'
    fontWeight: 600
    letterSpacing: '0.02em'
    fontFeature: '"tnum" 1'
  code:
    fontFamily: 'ui-monospace, SF Mono, Cascadia Mono, Menlo, monospace'
    fontSize: '0.8125rem'
    fontWeight: 400
rounded:
  chip: '2px'
  base: '3px'
  pill: '999px'
spacing:
  '1': '0.25rem'
  '2': '0.5rem'
  '3': '0.75rem'
  '4': '1rem'
  '5': '1.5rem'
  '6': '2rem'
  '7': '3rem'
components:
  button-primary:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.paper-raised}'
    rounded: '{rounded.base}'
    padding: '0 1rem'
    height: '2.5rem'
  button-approve:
    backgroundColor: '{colors.strip-ink}'
    textColor: '{colors.paper-raised}'
    rounded: '{rounded.base}'
    padding: '0 1rem'
    height: '2.5rem'
  button-reject:
    backgroundColor: '{colors.action}'
    textColor: '{colors.strip-ink}'
    rounded: '{rounded.base}'
    padding: '0 1rem'
    height: '2.5rem'
  button-quiet:
    backgroundColor: '{colors.board}'
    textColor: '{colors.board-ink}'
    rounded: '{rounded.base}'
    padding: '0 1rem'
    height: '2.5rem'
  button-quiet-hover:
    backgroundColor: '{colors.board-2}'
  input-composer:
    backgroundColor: '{colors.paper-raised}'
    textColor: '{colors.ink}'
    rounded: '{rounded.base}'
    padding: '0.75rem 1rem'
    height: '3rem'
  input-composer-disabled:
    backgroundColor: '{colors.user-tint}'
  row-user:
    backgroundColor: '{colors.user-tint}'
    textColor: '{colors.ink}'
    typography: '{typography.body}'
    rounded: '{rounded.base}'
    padding: '0.75rem 1rem'
  suggestion:
    backgroundColor: '{colors.paper-raised}'
    textColor: '{colors.ink}'
    rounded: '{rounded.base}'
    padding: '0.75rem 1rem'
  strip-lookup:
    backgroundColor: '{colors.lookup}'
    textColor: '{colors.strip-ink}'
    typography: '{typography.title}'
    rounded: '{rounded.base}'
  strip-lookup-holder:
    backgroundColor: '{colors.lookup-holder}'
    textColor: '{colors.strip-ink}'
    typography: '{typography.numerals}'
    width: '3.75rem'
  strip-action:
    backgroundColor: '{colors.action}'
    textColor: '{colors.strip-ink}'
    typography: '{typography.title}'
    rounded: '{rounded.base}'
  strip-action-holder:
    backgroundColor: '{colors.action-holder}'
    textColor: '{colors.strip-ink}'
    width: '3.75rem'
  strip-rejected:
    backgroundColor: '{colors.rejected}'
    textColor: '{colors.strip-ink}'
    rounded: '{rounded.base}'
  strip-failed-holder:
    backgroundColor: '{colors.danger}'
    textColor: '{colors.paper-raised}'
    width: '3.75rem'
  strip-pending:
    backgroundColor: '{colors.action}'
    textColor: '{colors.strip-ink}'
    typography: '{typography.headline}'
    rounded: '{rounded.base}'
    padding: '1rem'
  count-pill:
    backgroundColor: '{colors.board-2}'
    textColor: '{colors.board-ink}'
    rounded: '{rounded.pill}'
    height: '1.5rem'
---

# Design System: Agent chat

## Overview

**Creative North Star: "Clearance Strips"**

The interface borrows the air-traffic controller's flight progress strip board. The conversation is a light working ground where the operator reads; beside it stands a dark slate strip board where every tool the agent uses becomes a printed strip in a holder. Lookups land as cyan strips and are logged. An action with side effects arrives as a yellow strip in the approval bay and does not move until the operator clears or rejects it. Then a mark is drawn on the strip and it slides into the log.

Density is moderate and calm. Reading comes first: a single measure of about 34rem at 1.0625rem body in a highly legible humanist sans. The strips are condensed, numeric and ruled like the printed form they imitate. Colour carries meaning and nothing else: every hue on the board names a class of tool or a state, and the light side stays neutral so the strips are the only saturated objects on screen.

The identity lives entirely in the `:root` tokens of `app/globals.css`. Adopters rebrand by editing those tokens. Components read only the tokens, never literal hues.

**Key Characteristics:**

- Two grounds: light paper for the conversation, dark slate board for the strips.
- Strips are flat coloured bodies with a darker holder stub on the left and a status mark on the right.
- Colour is semantic and strict: cyan for lookups, yellow for actions, rose for human rejection, a red holder for system failure.
- The plain-language action name leads. The tool id comes second, as a smaller line in the code face.
- States are drawn marks (tick, diagonal strike, warning triangle, turning dashed ring), not badges.
- One signature motion: on clearance the tick draws and the strip slides from the bay into the log.

## Colors

A cool slate-and-paper neutral system that carries three semantic strip hues, plus one functional blue for focus and one red for failure.

### Primary

- **Clearance Yellow** (action): the body of every action strip, the strip with side effects that waits for a human. The pending strip, the docked strip on narrow screens and their sticky decision bar all use it. It also marks the product mark's strip.
- **Holder Ochre** (action-holder): the left holder stub of an action strip. Its only other use is the yellow half of the reference chip.

### Secondary

- **Lookup Cyan** (lookup): the body of read-only lookup strips and of the lookup reference chip in the conversation. Also the text-selection highlight.
- **Holder Teal** (lookup-holder): the holder stub of lookup strips.

### Tertiary

- **Rejection Rose** (rejected) and **Rose Holder** (rejected-holder): only for a strip the human rejected. The tool name is struck through.
- **Failure Red** (danger): system failures. It colours the holder of a failed strip (white text), failure notices in the conversation, and the warning-triangle mark.

### Neutral

- **Working Paper** (paper): the conversation ground.
- **Clean Sheet** (paper-raised): the composer field and suggestion cards. Also the white text on dark buttons.
- **Operator Tint** (user-tint): the operator's own message panels and the disabled composer.
- **Slate Ink** (ink) and **Muted Ink** (ink-2): primary and secondary text on paper. Ink also fills the Send button.
- **Paper Rule** (rule): field borders and the dock divider.
- **Strip Board Slate** (board), **Board Raised** (board-2), **Board Rule** (board-rule): the board shell and top bar, its hover and slot fill, and its dividers. Board also sets the browser theme colour.
- **Board Ink** (board-ink) and **Board Muted Ink** (board-ink-2): text on the board.
- **Strip Ink** (strip-ink): all text and marks on any strip, whatever its colour. On strips, translucent strip-ink (18 to 80 percent) draws the rules, secondary lines and argument labels.
- **Focus Blue** (focus) on paper and **Board Focus Cyan** (board-focus) on the slate: the 3px focus outline. On strips the outline switches to strip ink.

### Named Rules

**The Strict Semantics Rule.** Cyan means a read-only lookup. Yellow means an action with side effects. Rose means a human rejected it. A red holder means the system failed: the strip keeps its class colour and only the holder turns red. Never use these hues for decoration, emphasis or branding outside these meanings.

**The Single Source Rule.** Every colour a component uses comes from a `:root` token or a translucent derivative of one. Rebranding means editing `:root` only.

**The Quiet Paper Rule.** The conversation side carries no saturated colour except the small reference chips that point to a strip and the red of a failure. The board owns the colour.

## Typography

**Display / Heading / Numerals Font:** Barlow Semi Condensed 500 to 700 (with Arial Narrow, system-ui), self-hosted via next/font
**Body Font:** Atkinson Hyperlegible Next (with Segoe UI, system-ui), self-hosted via next/font
**Code Font:** system monospace stack (ui-monospace, SF Mono, Cascadia Mono, Menlo)

**Character:** The condensed face is the strip's printed form: it sets callsigns, times, headings and labels in tight, tabular numerals. Atkinson Hyperlegible carries everything the operator has to read, so a long answer never strains the eye. Monospace appears only where the exact machine value matters.

### Hierarchy

- **Display** (condensed 600, 2.25rem, 1.1, −0.01em): the empty-state title only. It drops to 1.5rem on narrow screens.
- **Headline** (condensed 700, 1.5rem, 1.2): the action name on the pending strip.
- **Title** (condensed 700, 1.1875rem, 1.2): action names on logged strips. In weight 600 it also sets the brand name and the "Strip board" heading.
- **Body** (Atkinson 400, 1.0625rem, 1.6): conversation text, with a measure of about 34rem. The empty-state lead uses 1.1875rem at 1.5.
- **Body small** (Atkinson 400, 0.9375rem, 1.45): strip descriptions, argument values, notices, board notes, reference rows.
- **Label** (condensed 600, 0.9375rem): speaker names, bay and log section headings, the "What it will use" heading. Argument keys use 0.8125rem, and status-mark labels and the holder class word use 0.75rem.
- **Numerals** (condensed with tabular figures, 0.02em): strip callsigns (S-01, bold 1rem), times, thread id, character count, the count pill.
- **Code** (mono 0.8125rem; 0.875rem in the JSON editor): the raw tool id under the action name, and the editable arguments.

### Named Rules

**The Plain Words First Rule.** A strip's heading is the plain-language action ("Send an email") from `lib/i18n.ts`. The tool id (`send_email`) follows as a secondary code-face line. Never lead with the id, and never drop it.

**The Stub Holds the Class Rule.** The class word (Action / Lookup) appears only in the holder stub, under the callsign and time. Never set it as an eyebrow or kicker above the action name.

**The Numerals Rule.** Every number that identifies or times something uses the condensed face with tabular figures, so strips in the log line up.

## Layout

On desktop the desk is a two-column grid under a full-width slate top bar. The conversation takes the flexible left column. The strip board is a fixed 24rem column on the right that scrolls on its own. The transcript and the empty state are centred at a 34rem maximum width. The composer sits pinned at the bottom of the conversation column at the same measure (34rem plus its side padding), with Send and the character count to its right.

The board stacks a heading, the approval bay ("Waiting for your approval") and the strip log, with 2rem between sections. Each section is headed by a condensed label over a board-rule underline. Log strips stack at 0.5rem, newest first.

Below 900px the board leaves the grid and becomes a right-hand drawer (min(26rem, 92vw)) behind a scrim. A "Strips" button with a count pill opens it. Thread and tenant move from the top bar into the drawer. A pending strip docks above the composer in a scrollable dock (max 58dvh), and the bay shows a slot saying where it went. New thread and Send fall back to icon-only buttons that keep accessible text.

Spacing follows a 0.25rem-based scale (0.25, 0.5, 0.75, 1, 1.5, 2, 3rem). Conversation rows sit 1.5rem apart. Strip interiors use 0.75rem, and 1rem on the pending strip.

### Named Rules

**The Physical Bay Rule.** The bay is a slot in the rack even when nothing waits. When empty it shows a dashed holder outline with a filled stub area and one plain sentence. It never collapses or disappears.

**The Reading Measure Rule.** Conversation text stays at about 34rem at 1.0625rem body. The board's width never squeezes it.

## Elevation & Depth

Depth here is material, not atmospheric. The paper side is flat: panels are tinted or bordered, never shadowed. Strips alone carry a shadow, because they are physical cards lying in the rack. That shadow is a 1px contact line plus a soft, tight drop below. The mobile drawer gets its depth from a 50 percent slate scrim, not a shadow.

### Shadow Vocabulary

- **Strip contact** (`box-shadow: 0 1px 0 rgb(0 0 0 / 0.3), 0 8px 16px -10px rgb(0 0 0 / 0.7)`): every strip on the board, pending or logged.
- **Holder stub inset** (`box-shadow: inset 0.5rem 0 0 <holder>`): not elevation. It draws the holder stub on the small reference chips.

### Named Rules

**The Only Strips Rule.** Only strips cast shadows. Buttons, fields, suggestion cards and message panels stay flat.

## Shapes

Corners are nearly square (3px) throughout, like printed card stock. Reference chips use 2px. The only full round is the count pill. Every strip uses a three-part horizontal silhouette: a 3.75rem holder stub, a flexible body and a 3.5rem mark column divided by a hairline. The pending strip drops the mark column. Arguments sit in ruled boxes (1px translucent strip-ink grid), like the fields printed on a flight strip. Long or multi-line values span the full width. The product mark and favicon repeat the strip-in-holder silhouette.

Icons are an authored set on a 20px grid with a 1.75 stroke and round caps and joins. Status marks are drawn at 28px with a 2.5 stroke.

## Components

### Buttons

Square, firm, weight 600 at 0.9375rem, at least 2.5rem tall, with a 20px icon before the label.

- **Shape:** near-square corners (3px).
- **Primary (Send):** slate ink fill with white text, darkening on hover. On mobile it becomes a 3rem icon-only button.
- **Approve and run:** strip-ink fill with white text and a tick icon. It is the first of the two decision buttons and always full-width-flexible.
- **Reject:** transparent on the strip, 55 percent strip-ink border, with a cross icon. On hover it gets an 8 percent strip-ink wash.
- **Quiet (board / top bar):** transparent, board-rule border, board ink. Board Raised on hover.
- **Link (Undo edits):** underlined text with a 3px offset, weight 600, at least 2rem tall.
- **Hover / Focus:** 160ms colour transitions on the expo-out ease. A 3px focus outline at a 2px offset, in focus blue on paper, cyan on the board and strip ink on strips.
- **Disabled:** 55 percent opacity, not-allowed cursor.

### Inputs / Fields

- **Composer:** clean-sheet fill, paper-rule border, 3px corners, at least 3rem tall, grows with content up to 12rem. The placeholder states the keyboard contract.
- **Blocked:** while an approval waits, the composer turns operator tint and its placeholder says what to do ("Approve or reject the waiting action first.").
- **JSON editor:** inside an "Edit arguments as JSON" disclosure on the pending strip. Monospace 0.875rem on a pale cream field with a translucent strip-ink border. Invalid JSON shows a bold warning line with an alert icon.

### Conversation rows

- **Operator message:** an operator-tint panel with 0.75rem by 1rem padding.
- **Agent message:** plain text on paper, no panel.
- Each message has a condensed speaker name and a tabular time.
- **Reference row:** a small cyan or yellow chip with its holder stub, the done-tense action ("Searched the documents") and the strip callsign ("strip S-01") at the right. It links the conversation to the board without repeating the strip.
- **Notice:** a muted line with an icon recording a decision. Failures turn it red.

### Navigation

- **Top bar:** slate, carrying the product mark in clearance yellow, the condensed product name, and the thread and tenant as a description list (muted term, bold tabular value). The New thread quiet button sits at the right. On mobile it shows only the brand, Strips and New thread.

### Suggestions (empty state)

Full-width clean-sheet cards with a paper-rule border that darkens to muted ink on hover. Each card has the prompt text and below it a reference chip plus a plain description of what it will do ("Looks something up" / "Needs your approval"). The chip's colour previews the class.

### Strip (signature component)

- **Holder stub:** the class's holder colour, carrying the callsign (bold numerals), the time and the class word.
- **Body:** the plain-language action name in condensed bold. Under it, the tool id in the code face at 78 percent strip ink, and the description when present.
- **Mark column:** a drawn status mark over a condensed label. The marks are a tick for Done or Approved, a diagonal strike for Rejected, a warning triangle for Failed and a slowly turning dashed ring for Waiting. The tick and strike draw in over 420ms.
- **States:** a rejected strip turns rose and strikes through its name. A failed strip keeps its class colour, and its holder turns red with white text.
- **Pending strip:** yellow, with a headline-size action name, the description, "What it will use" with ruled argument boxes, the JSON edit disclosure, and the decision bar.
- **Decision bar:** sticky at the bottom of the strip in both the bay and the dock. It has a yellow fill, a hairline top rule and a fade above it, so Approve and Reject stay in reach while long arguments scroll. "Scroll for all details" appears when content is hidden.
- **Motion:** on a decision the strip moves from the bay to the log through a 460ms view transition on the expo-out curve. With reduced motion it is instant.

### Count pill

A round slate chip with tabular numerals, showing how many strips the board holds. It appears in the mobile Strips button.

## Do's and Don'ts

### Do:

- **Do** lead every strip and reference row with the plain-language action from `lib/i18n.ts`, and keep the raw tool id as a secondary code-face line.
- **Do** put the class word (Action / Lookup) in the holder stub, under the callsign and time.
- **Do** keep colour semantics strict: cyan = lookup, yellow = action with side effects, rose = human rejection only, red holder = system failure.
- **Do** keep the bay visible as a dashed, stubbed slot when nothing waits.
- **Do** keep Approve and Reject sticky at the bottom of the pending strip, in the bay and in the dock.
- **Do** hold conversation text at about 34rem and 1.0625rem body.
- **Do** set every callsign, time, id and count in the condensed face with tabular figures.
- **Do** show state as a drawn mark on the strip, and switch the focus outline to strip ink on strips.
- **Do** rebrand by editing `:root` tokens only.

### Don't:

- **Don't** set the class word, or any other label, as an eyebrow or kicker above a strip's action name or a heading.
- **Don't** use rose for a system error or red for a human rejection.
- **Don't** colour a failed strip red all over. It keeps its class colour and only the holder turns red.
- **Don't** add status badges or pills to strips. The mark column carries state.
- **Don't** shadow anything except strips.
- **Don't** use an approval modal or an inline approval card in the conversation. Approval happens on the board, or in the dock on narrow screens.
- **Don't** hard-code a hue in a component. Add or edit a `:root` token instead.
