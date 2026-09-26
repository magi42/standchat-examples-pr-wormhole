// All counts and replay events are invented, deterministic sample data.
export const experiment = Object.freeze({
  name: "Quickstart signup",
  days: 10,
  targetPerArm: 10000,
  control: {
    desktop: { visitors: 3000, signups: 600, activated: 360 },
    mobile: { visitors: 2000, signups: 400, activated: 240 },
  },
  variant: {
    desktop: { visitors: 3000, signups: 720, activated: 432 },
    mobile: { visitors: 2000, signups: 480, activated: 144 },
  },
});
export function total(arm) {
  return Object.values(arm).reduce(
    (a, row) => ({
      visitors: a.visitors + row.visitors,
      signups: a.signups + row.signups,
      activated: a.activated + row.activated,
    }),
    { visitors: 0, signups: 0, activated: 0 },
  );
}
export function metrics(row) {
  return {
    signup: (row.signups / row.visitors) * 100,
    activation: (row.activated / row.signups) * 100,
    value: (row.activated / row.visitors) * 100,
  };
}
// Descriptive, unadjusted normal interval for independent visitor proportions.
// Not an experiment stopping rule, and not a conditional-activation interval.
export function valueDifference(
  a = total(experiment.control),
  b = total(experiment.variant),
) {
  const p = a.activated / a.visitors,
    q = b.activated / b.visitors;
  const delta = (q - p) * 100;
  const margin =
    1.96 *
    Math.sqrt((p * (1 - p)) / a.visitors + (q * (1 - q)) / b.visitors) *
    100;
  return { delta, low: delta - margin, high: delta + margin };
}
export const trail = [
  {
    time: "00:00",
    event: "landing_view",
    heading: "A promising start.",
    detail: "A synthetic mobile visitor lands on the variant.",
    screen: "A little less setup.",
    button: "Try the workspace",
  },
  {
    time: "00:08",
    event: "signup_opened",
    heading: "One field. No detour.",
    detail: "The visitor opens the shorter signup form.",
    screen: "Your work email",
    button: "Create workspace",
  },
  {
    time: "00:19",
    event: "signup_completed",
    heading: "The signup counter goes up.",
    detail: "A workspace is created. No useful activity has happened yet.",
    screen: "You’re in.",
    button: "Connect a source",
  },
  {
    time: "00:31",
    event: "source_connect_opened",
    heading: "Now the actual work.",
    detail: "A connection step opens in a narrow mobile viewport.",
    screen: "Connect your first source",
    button: "Authorize connection",
  },
  {
    time: "00:44",
    event: "connection_error",
    heading: "One very unhelpful error.",
    detail:
      "The illustrative trail records a failed connection. Its cause is unknown.",
    screen: "Connection interrupted",
    button: "Try again",
  },
  {
    time: "01:12",
    event: "session_exit",
    heading: "A signup. Not an activation.",
    detail:
      "This sample trail ends without a first dashboard. One trail cannot estimate how often this happens.",
    screen: "No first dashboard event",
    button: "Session ended",
  },
];
export const priorities = {
  activation: "Optimize activated visitors within 24h",
  signup: "Prioritize signup growth; tolerate activation risk",
  evidence: "Require more evidence before deciding",
};
export function contextSnapshot({
  decision = "",
  stage = 0,
  priority = "activation",
  own = false,
}) {
  if (own)
    return "Own product discussion. Visitor will describe their actual decision and assumptions. Signalburrow sample metrics are fictional and must not be applied to their product.";
  const parts = [
    "Fictional sample: Quickstart signup; 10 days; 5,000 visitors/arm. Control→variant: signups 1,000→1,200; activated within 24h 600→576. Activation/signup 60%→48%.",
    `My choice: ${decision || "undecided"}. Assumption: ${priorities[priority] || priorities.activation}.`,
  ];
  if (stage >= 1)
    parts.push(
      "Device counts (visitors/signups/activated), C→V: desktop 3000/600/360→3000/720/432; mobile 2000/400/240→2000/480/144.",
    );
  if (stage >= 2)
    parts.push(
      "Synthetic mobile trail: signup, connection error, exit. Not causal proof.",
    );
  if (stage >= 3)
    parts.push(
      "Half of planned sample; unadjusted 95% interval for activated/visitor delta: −1.74 to +0.78pp.",
    );
  return parts.join(" ");
}
