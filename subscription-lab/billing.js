// Integer cents × days keep proration exact until the displayed running total.
export const DAYS = 30;
export const MAX_EVENTS = 12;
export const TYPES = Object.freeze({
  upgrade: { label: 'Upgrade to Scale', short: 'Upgrade', icon: '↗', detail: '$90 → $180 plan / month' },
  seats: { label: 'Add 2 seats', short: '+2 seats', icon: '+', detail: '$10 per seat / month' },
  pause: { label: 'Pause subscription', short: 'Pause', icon: 'Ⅱ', detail: 'Stop charges, keep the setup' },
  resume: { label: 'Resume subscription', short: 'Resume', icon: '▷', detail: 'Restart with the saved setup' },
  cancel: { label: 'Cancel subscription', short: 'Cancel', icon: '×', detail: 'End service immediately' },
  failure: { label: 'Payment fails', short: 'Payment fails', icon: '!', detail: 'Collection status only' },
});
export const RULES = 'Illustrative September, 30 days, USD. Start: Launch $90/month + 3 seats at $10/seat/month = $120. Scale plan $180/month; add-seats adds 2 seats. Changes take effect at the start of their day. Sort by day then insertion order. Prorate the change in monthly rate by (31 − day)/30. Carry fractional cents; round each running subtotal to the nearest cent, with each line the difference from the prior subtotal. Pause stops all charges and retains plan/seats; resume restores them. Plan/seat changes while paused apply on resume. Cancel is terminal; later service changes are ignored. Payment failure only marks collection failed; it changes no charges or service. No taxes, discounts, retries, real payments, or next-month billing.';
export const money = (cents) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export const EXAMPLES = Object.freeze({
  growth: [{ type: 'upgrade', day: 16 }, { type: 'seats', day: 21 }],
  pause: [{ type: 'pause', day: 11 }, { type: 'seats', day: 15 }, { type: 'resume', day: 21 }],
  failure: [{ type: 'upgrade', day: 16 }, { type: 'failure', day: 20 }, { type: 'cancel', day: 25 }],
});

export function calculate(events) {
  if (!Array.isArray(events) || events.length > MAX_EVENTS) throw new Error('Use up to 12 events.');
  const ids = new Set();
  for (const event of events) {
    if (!Object.hasOwn(TYPES, event.type) || !Number.isInteger(event.day) || event.day < 1 || event.day > DAYS || !Number.isSafeInteger(event.id) || event.id < 1 || ids.has(event.id)) throw new Error('Invalid event.');
    ids.add(event.id);
  }
  const ordered = [...events].sort((a, b) => a.day - b.day || a.id - b.id);
  let plan = 'Launch', seats = 3, status = 'active', collection = 'Not attempted';
  const rate = () => status === 'active' ? (plan === 'Launch' ? 9000 : 18000) + seats * 1000 : 0;
  let numerator = 12000 * DAYS;
  const lines = [{ id: 'base', title: 'Launch · 3 seats', day: 1, amount: 12000, explanation: '$90 plan + 3 × $10 seats. Full September, before adjustments.', total: 12000 }];
  const results = [];
  for (const event of ordered) {
    const before = rate();
    const oldTotal = Math.round(numerator / DAYS);
    let note;
    if (event.type === 'failure') {
      collection = 'Payment failed';
      note = 'Illustrative collection failure. Charges and service are unchanged; no payment was attempted.';
    } else if (status === 'cancelled') {
      note = 'Ignored: the subscription has already been cancelled. Undo or remove the cancellation to explore this change.';
    } else {
      switch (event.type) {
        case 'upgrade': note = plan === 'Scale' ? 'Already on Scale. No additional change.' : 'Scale replaces Launch; the seat price stays $10.'; plan = 'Scale'; break;
        case 'seats': seats += 2; note = `Seat count is now ${seats}.`; break;
        case 'pause': note = status === 'paused' ? 'Already paused. No additional change.' : 'Charges stop; the plan and seats are kept for resuming.'; status = 'paused'; break;
        case 'resume': note = status === 'active' ? 'Already active. No additional change.' : 'Charges restart with the saved plan and seat count.'; status = 'active'; break;
        case 'cancel': status = 'cancelled'; note = 'Charges stop immediately. This subscription cannot resume.'; break;
      }
      if (status === 'paused' && ['seats', 'upgrade'].includes(event.type)) note += ' Saved while paused; billed only after resuming.';
    }
    const after = rate();
    numerator += (after - before) * (DAYS + 1 - event.day);
    const total = Math.round(numerator / DAYS);
    const amount = total - oldTotal;
    const explanation = before !== after
      ? `${note} (${money(after)} − ${money(before)}) × ${DAYS + 1 - event.day}/30 days. Fractional cents carry forward.`
      : note;
    const result = { ...event, title: TYPES[event.type].label, amount, explanation, total, rate: after, status, plan, seats };
    results.push(result);
    lines.push(result);
  }
  return { events: results, lines, total: Math.round(numerator / DAYS), status, plan, seats, collection };
}

export function scenarioText(events, selected = 'base') {
  const bill = calculate(events);
  const selection = bill.lines.find((line) => String(line.id) === String(selected));
  return [
    'Meterwick fictional billing lab. Local calculation; conversation cannot change this invoice.',
    RULES,
    ...bill.events.map((e, i) => `${i + 1}. Sep ${e.day}: ${e.title}; adjustment ${money(e.amount)}; ${e.explanation}`),
    `Total: ${money(bill.total)}. Service: ${bill.status}, ${bill.plan}, ${bill.seats} seats. Collection: ${bill.collection}.`,
    `Selected: ${selection ? `Sep ${selection.day}, ${selection.title}, ${money(selection.amount)}. ${selection.explanation}` : 'whole scenario'}`,
  ].join('\n');
}

export const CONTEXT_MARKER = '\n\n--- Meterwick scenario (local illustration) ---\n';
export function contextualMessage(question, events, selected) {
  return question.split(CONTEXT_MARKER)[0].trim() + CONTEXT_MARKER + scenarioText(events, selected);
}
