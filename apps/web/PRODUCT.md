# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: day-to-day operators of a product built on this template (non-technical staff, e.g. an office or a professional practice) who ask the agent for help and must understand what the agent is about to do before they approve it. They use the chat repeatedly during a working day, not once.

Secondary: developers evaluating or forking the template. They reuse this UI largely as shipped and need the technical detail (tool arguments, ids) to stay reachable.

## Product Purpose

A chat with an AI agent that streams its answers and **stops before any action with side effects** (for example sending an email) until a human approves, edits or rejects it. Success means the operator always knows what will happen, decides in seconds, and never approves something they did not see.

## Positioning

Human approval is the product, not a modal bolted on: the approval request carries the exact tool, a description and the arguments that will run, the operator can edit the arguments before approving, and an approval is bound to the specific tool call they reviewed (a changed call is refused). Tool output is treated as untrusted data.

## Operating Context

- Next.js App Router app (`apps/web`) proxying to the NestJS API; the API key stays server-side.
- Events from the API over SSE: `token`, `tool_result`, `approval_required`, `error`, `done`.
- One thread per session; the tenant comes from configuration (`AGENT_DEMO_TENANT_ID`), there is no login yet.
- Messages are capped at 4000 characters; responses can be long and arrive token by token.

## Capabilities and Constraints

- Send a message, watch the streamed answer, see tool results (tool name and success/error).
- Review a pending side-effect tool call: tool name, description, editable JSON arguments; approve or reject. Invalid edited JSON is refused client-side; the API re-validates.
- While an approval is pending, new messages are blocked.
- Errors from the API are shown without internals.
- Undecided: conversation list/history UI, authentication UI, attachments.

## Brand Commitments

The template should have a strong, recognisable identity that showcases the project on GitHub and in demos. Adopters are expected to replace it with their own brand, so the identity must live in a small, central set of tokens.

## Evidence on Hand

- Agent tools in the template: `search_docs` (read-only, fake corpus) and `send_email` (side effect, simulated).
- No real customers, metrics, testimonials or screenshots exist; none may be invented.

## Product Principles

1. Nothing with side effects happens without a visible, explicit human decision.
2. Say what will happen in plain language first; technical detail is one step away, never missing.
3. Untrusted content (tool output, model text) is always visually distinct from the product's own voice.
4. The operator is never stuck: every state (streaming, waiting for approval, error, empty) tells them what to do next.

## Accessibility & Inclusion

WCAG 2.2 AA: contrast, full keyboard operation, visible focus, screen-reader announcements for streamed content and for approval requests, reduced-motion support. UI strings are centralised and translation-ready; English is the default locale.
