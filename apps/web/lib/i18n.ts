/**
 * Every user-facing string of the chat. To translate, add a locale object with the same keys and pick it
 * in `messagesFor`. Functions receive values so word order can change per language.
 */

/** Plain-language names for the agent's tools. Add one entry per tool you register in the API. */
const toolNames: Record<string, { action: string; done: string }> = {
  search_docs: { action: 'Search the documents', done: 'Searched the documents' },
  send_email: { action: 'Send an email', done: 'Sent an email' },
};

const humanize = (id: string) => {
  const words = id.replaceAll(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const en = {
  appName: 'Agent chat',
  thread: 'Thread',
  noThread: 'New',
  tenant: 'Tenant',
  newThread: 'New thread',
  newThreadHint: 'Start over with an empty conversation',
  strips: 'Strips',
  closeBoard: 'Close strips',

  /** What the tool does, in the operator's words. */
  toolAction: (tool: string) => toolNames[tool]?.action ?? humanize(tool),
  /** The same tool once it has run. */
  toolDone: (tool: string) => toolNames[tool]?.done ?? `Finished: ${humanize(tool)}`,

  emptyTitle: 'Ask the agent',
  emptyBody:
    'It can look things up on its own. Anything that changes something, like sending an email, waits on the board until you approve it.',
  suggestionsLabel: 'Try one of these',
  suggestions: [
    { text: 'What is the refund policy?', kind: 'lookup' },
    { text: 'Send an email to ops@example.com saying the report is ready', kind: 'action' },
  ] as const,
  suggestionKind: { lookup: 'Looks something up', action: 'Needs your approval' },

  you: 'You',
  agent: 'Agent',
  replying: 'The agent is writing…',
  replyDone: 'The agent finished replying.',
  toolFailed: (action: string) => `Failed: ${action}`,
  stripRef: (strip: string) => `strip ${strip}`,

  composerLabel: 'Message to the agent',
  composerPlaceholder: 'Write a message. Enter sends, Shift+Enter adds a line.',
  composerBlocked: 'Approve or reject the waiting action first.',
  send: 'Send',
  sending: 'Sending',
  charactersLeft: (left: number) => `${left} characters left`,

  board: 'Strip board',
  awaitingTitle: 'Waiting for your approval',
  awaitingDocked: 'The waiting action is shown above the message box.',
  awaitingEmpty: 'Empty slot. Actions that change something stop here before they run.',
  logTitle: 'Strip log',
  logEmpty: 'No tools used yet in this thread.',
  kindLookup: 'Lookup',
  kindAction: 'Action',
  status: {
    done: 'Done',
    failed: 'Failed',
    awaiting: 'Waiting for you',
    cleared: 'Approved',
    rejected: 'Rejected',
  },
  argumentsTitle: 'What it will use',
  noArguments: 'No arguments.',
  moreBelow: 'Scroll for all details',
  editArguments: 'Edit arguments as JSON',
  resetArguments: 'Undo edits',
  invalidJson: 'These arguments are not valid JSON. Fix them or undo your edits.',
  approve: 'Approve and run',
  reject: 'Reject',
  approvalAnnouncement: (action: string) => `Approval needed: ${action}.`,
  decisionNotice: (decision: 'approve' | 'reject', action: string) =>
    decision === 'approve' ? `You approved: ${action}.` : `You rejected: ${action}. It will not run.`,

  requestFailed: (status: number) => `The request failed (${status}).`,
  somethingWrong: 'Something went wrong. Check your connection and try again.',
  runFailed: 'The agent could not finish this reply. Try again.',
};

export type Messages = typeof en;

const locales: Record<string, Messages> = { en };

export function messagesFor(locale = 'en'): Messages {
  return locales[locale] ?? en;
}
