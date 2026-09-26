import "./stand-inline.js";
import {
  experiment,
  total,
  metrics,
  valueDifference,
  trail,
  priorities,
  contextSnapshot,
} from "./scenario.js";

const $ = (selector) => document.querySelector(selector);
const chat = $("#decision-chat");
const storageKey = "signalburrow:decision:v1";
let saved = {};
try {
  saved = JSON.parse(sessionStorage.getItem(storageKey) || "{}");
} catch {
  /* Works without storage. */
}
let decision = ["ship", "stop", "investigate"].includes(saved?.decision)
  ? saved.decision
  : "";
let stage =
  Number.isInteger(saved?.stage) && saved.stage >= 0 && saved.stage <= 3
    ? saved.stage
    : 0;
let opened = Math.max(
  stage,
  Number.isInteger(saved?.opened) && saved.opened <= 3 && saved.opened >= 0
    ? saved.opened
    : 0,
);
let priority = Object.hasOwn(priorities, saved?.priority)
  ? saved.priority
  : "activation";
let own = saved?.own === true;
let discussionOpen =
  saved?.discussionOpen === true ||
  chat.client.getSnapshot().messages.length > 0;
let lastShared =
  typeof saved?.lastShared === "string" ? saved.lastShared.slice(0, 750) : "";
let replayIndex = 0;
let replayTimer;

function save() {
  try {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        decision,
        stage,
        opened,
        priority,
        own,
        discussionOpen,
        lastShared,
      }),
    );
  } catch {
    /* Storage may be denied. */
  }
}
function textElement(tag, value, className = "") {
  const el = document.createElement(tag);
  el.textContent = value;
  el.className = className;
  return el;
}
const control = total(experiment.control),
  variant = total(experiment.variant);
const a = metrics(control),
  b = metrics(variant);
const pct = (n) => `${Number(n.toFixed(2))}%`;
const definitions = [
  {
    label: "Signup rate",
    key: "signup",
    change: "+20% relative lift",
    className: "positive",
    counts: "1,000 → 1,200 signups / 5,000 visitors per arm",
  },
  {
    label: "Activation / signup",
    key: "activation",
    change: "−12 percentage points",
    className: "negative",
    counts: "600 / 1,000 → 576 / 1,200 signups activated",
  },
  {
    label: "Reached value / visitor",
    key: "value",
    change: "−0.48 percentage points",
    className: "negative",
    counts: "600 → 576 activated / 5,000 visitors per arm",
  },
];
for (const metric of definitions) {
  const card = textElement("article", "", "metric");
  card.append(
    textElement("h3", metric.label),
    textElement("p", pct(b[metric.key]), "metric-value"),
    textElement("p", metric.change, `metric-delta ${metric.className}`),
  );
  const max = Math.max(a[metric.key], b[metric.key]) * 1.12;
  for (const [label, value, className] of [
    ["A", a[metric.key], "control"],
    ["B", b[metric.key], "variant"],
  ]) {
    const row = textElement("div", "", `bar-row ${className}`);
    const track = textElement("span", "", "track");
    track.setAttribute("aria-hidden", "true");
    const bar = textElement("span", "", "bar");
    bar.style.display = "block";
    bar.style.width = `${(value / max) * 100}%`;
    track.append(bar);
    row.append(
      textElement("span", label),
      track,
      textElement("span", pct(value), "bar-label"),
    );
    card.append(row);
  }
  card.append(textElement("p", metric.counts, "metric-count"));
  $("#metrics").append(card);
}
for (const device of ["desktop", "mobile"]) {
  const c = experiment.control[device],
    v = experiment.variant[device];
  const row = document.createElement("tr");
  const heading = textElement(
    "th",
    device === "desktop" ? "Desktop" : "Mobile",
  );
  heading.scope = "row";
  row.append(heading);
  for (const value of [
    c.visitors.toLocaleString("en-US"),
    `${c.signups} → ${v.signups}`,
    `${c.activated} → ${v.activated}`,
    `${pct(metrics(c).activation)} → ${pct(metrics(v).activation)}`,
  ])
    row.append(textElement("td", value));
  $("#segments tbody").append(row);
}
const interval = valueDifference();
$("#interval").textContent =
  `${interval.low.toFixed(2)} to +${interval.high.toFixed(2)}`;

chat.setAttribute(
  "prompt",
  "This is Signalburrow, a fictional product analytics demo. Discuss the visitor’s experiment decision with them using the visible snapshot attached to their message. All supplied experiment counts and the event trail are illustrative. Do not claim causal certainty, statistical significance, a universally correct verdict, or access to real analytics. Explore the user’s priorities and what evidence would change their mind. Only discuss evidence they have opened; ask before moving ahead. If they describe their own product, keep its facts separate from the sample. You cannot change this page. You are the real Stand demo responder, not Signalburrow staff.",
);
chat.strings = {
  placeholder: "Why this direction? What would change your mind?",
  errors: {
    uncertain:
      "Stand may have received the first request, but we could not confirm it. Starting again may create another conversation. Your message is kept for review.",
  },
};
function attachContext() {
  // A visible, removable quote; no API call happens here.
  chat.quote = contextSnapshot({ decision, stage: opened, priority, own });
  $("#context-status").textContent = own
    ? "Next message: your own product. Sample metrics are excluded."
    : `Next message: ${decision || "undecided"} · ${opened + 1}/4 evidence cards · your assumption.`;
  $("#shared-context").hidden = !lastShared;
  $("#shared-context-text").textContent = lastShared
    ? `Last shared with this thread: ${lastShared}`
    : "";
  save();
}
function renderDecision() {
  chat.setAttribute(
    "placeholder",
    own
      ? "What are you deciding? What do you know so far?"
      : "Why this direction? What would change your mind?",
  );
  for (const input of document.querySelectorAll('[name="decision"]'))
    input.checked = input.value === decision;
  $("#priority").value = priority;
  $("#open-discussion").disabled = !decision;
  $("#chat-intro").hidden = discussionOpen;
  $("#chat-area").hidden = !discussionOpen;
  $("#own-product").textContent = own
    ? "Return to the sample experiment ↗"
    : "Now, about your product ↗";
  attachContext();
}
$("#choices").addEventListener("change", (event) => {
  decision = event.target.value;
  own = false;
  renderDecision();
});
$("#priority").addEventListener("change", () => {
  priority = $("#priority").value;
  attachContext();
});
$("#open-discussion").addEventListener("click", () => {
  discussionOpen = true;
  renderDecision();
  chat.focus();
});
$("#own-product").addEventListener("click", () => {
  own = !own;
  discussionOpen = true;
  renderDecision();
  chat.focus();
});
$("#retry-chat").addEventListener("click", () => void chat.client.retry());
function reflectConnection(state) {
  const labels = {
    loading: "Checking availability…",
    available:
      state.host.kind === "standin"
        ? "AI Stand-in available"
        : "Human available",
    active:
      state.connection === "online"
        ? state.host.kind === "standin"
          ? "Connected · AI"
          : "Connected · human"
        : "Reconnecting…",
    ended: "Conversation ended",
    uncertain: "Start not confirmed",
    unavailable: state.error ? "Connection unavailable" : "Nobody available",
  };
  $("#connection-status").textContent =
    labels[state.phase] || "Checking availability…";
}
chat.client.subscribe(reflectConnection);
reflectConnection(chat.client.getSnapshot());
chat.addEventListener("stand-inline-message", (event) => {
  if (event.detail.from !== "visitor") return;
  // Derive this label from the sent transcript, never from a later local choice.
  const quote = event.detail.text
    .split("\n")
    .filter((line) => line.startsWith("> "))
    .map((line) => line.slice(2))
    .join(" ");
  if (quote) lastShared = quote;
  $("#shared-context-text").textContent = lastShared
    ? `Last shared with this thread: ${lastShared}`
    : "Message sent without a sample context quote.";
  $("#shared-context").hidden = false;
  $("#context-status").textContent =
    "Context shared. Change a choice or open evidence to attach an update.";
  save();
});
const nextLabels = [
  "Look at the segments",
  "Follow a session",
  "Read the fine print",
  "Discuss the tradeoffs",
];
function renderEvidence(focus = false) {
  for (const panel of document.querySelectorAll("[data-panel]"))
    panel.hidden = Number(panel.dataset.panel) !== stage;
  for (const button of document.querySelectorAll("[data-stage]")) {
    const index = Number(button.dataset.stage);
    button.disabled = index > opened;
    if (index === stage) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  }
  $("#progress-label").textContent = `${opened + 1} of 4 evidence cards opened`;
  $("#next-evidence").replaceChildren(
    document.createTextNode(nextLabels[stage]),
    textElement("span", "→"),
  );
  attachContext();
  if (focus) $("#evidence-content").focus({ preventScroll: true });
}
for (const button of document.querySelectorAll("[data-stage]"))
  button.addEventListener("click", () => {
    stopReplay();
    stage = Number(button.dataset.stage);
    renderEvidence();
  });
$("#next-evidence").addEventListener("click", () => {
  if (stage < 3) {
    stopReplay();
    stage++;
    opened = Math.max(opened, stage);
    renderEvidence(true);
  } else {
    discussionOpen = true;
    renderDecision();
    $("#decision-title").scrollIntoView({ block: "center" });
    chat.focus({ preventScroll: true });
  }
});
$("#reset").addEventListener("click", () => {
  stopReplay();
  stage = opened = replayIndex = 0;
  decision = "";
  own = false;
  priority = "activation";
  renderEvidence();
  renderReplay();
  renderDecision();
  $("#context-status").textContent =
    "Evidence reset locally. The conversation and your draft are kept.";
});
function stopReplay() {
  clearInterval(replayTimer);
  replayTimer = undefined;
  $("#play-replay").textContent = "▶ Play trail";
}
function renderReplay() {
  const item = trail[replayIndex];
  for (const [id, value] of Object.entries({
    "replay-time": `${item.time} / SYNTHETIC MOBILE SESSION`,
    "replay-heading": item.heading,
    "replay-description": item.detail,
    "replay-screen": item.screen,
    "replay-button": item.button,
    "replay-event": item.event,
  }))
    $(`#${id}`).textContent = value;
  for (const [index, button] of [...$("#trail-steps").children].entries()) {
    if (index === replayIndex) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  }
}
trail.forEach((item, index) => {
  const button = textElement("button", String(index + 1));
  button.type = "button";
  button.setAttribute("aria-label", `${item.time}: ${item.event}`);
  button.addEventListener("click", () => {
    stopReplay();
    replayIndex = index;
    renderReplay();
  });
  $("#trail-steps").append(button);
});
$("#play-replay").addEventListener("click", () => {
  if (replayTimer) {
    stopReplay();
    return;
  }
  if (replayIndex === trail.length - 1) replayIndex = 0;
  renderReplay();
  $("#play-replay").textContent = "Ⅱ Pause trail";
  replayTimer = setInterval(() => {
    replayIndex++;
    renderReplay();
    if (replayIndex === trail.length - 1) stopReplay();
  }, 1800);
});
$("#reset-replay").addEventListener("click", () => {
  stopReplay();
  replayIndex = 0;
  renderReplay();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopReplay();
});
renderEvidence();
renderDecision();
renderReplay();
