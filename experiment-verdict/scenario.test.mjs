import test from "node:test";
import assert from "node:assert/strict";
import {
  experiment,
  total,
  metrics,
  valueDifference,
  contextSnapshot,
  priorities,
  trail,
} from "./scenario.js";

test("sample outcomes reconcile across devices, arms and funnel denominators", () => {
  const c = total(experiment.control),
    v = total(experiment.variant);
  assert.deepEqual(c, { visitors: 5000, signups: 1000, activated: 600 });
  assert.deepEqual(v, { visitors: 5000, signups: 1200, activated: 576 });
  for (const arm of [experiment.control, experiment.variant])
    for (const row of Object.values(arm)) {
      assert.ok(row.activated <= row.signups && row.signups <= row.visitors);
      assert.ok(
        Math.abs(
          (metrics(row).signup * metrics(row).activation) / 100 -
            metrics(row).value,
        ) < 1e-12,
      );
    }
  assert.equal(metrics(v).activation - metrics(c).activation, -12);
  assert.ok(Math.abs((v.signups / c.signups - 1) * 100 - 20) < 1e-12);
  assert.equal(v.activated - c.activated, -24);
  assert.equal(
    experiment.variant.desktop.activated - experiment.control.desktop.activated,
    72,
  );
  assert.equal(
    experiment.variant.mobile.activated - experiment.control.mobile.activated,
    -96,
  );
});
test("unadjusted visitor-level interval uses both independent arms and includes zero", () => {
  const result = valueDifference();
  assert.equal(result.delta.toFixed(2), "-0.48");
  assert.equal(result.low.toFixed(2), "-1.74");
  assert.equal(result.high.toFixed(2), "0.78");
  assert.ok(result.low < 0 && result.high > 0);
  const same = valueDifference(
    total(experiment.control),
    total(experiment.control),
  );
  assert.equal(same.delta, 0);
  assert.equal(same.low, -same.high);
});
test("all contextual snapshots fit the visible quote without truncation and reveal evidence in order", () => {
  for (const decision of ["ship", "stop", "investigate", ""])
    for (const priority of Object.keys(priorities))
      for (let stage = 0; stage <= 3; stage++) {
        const context = contextSnapshot({ decision, stage, priority });
        assert.ok(
          context.length <= 600,
          `Snapshot is ${context.length} characters`,
        );
        assert.equal(context.includes("Device counts"), stage >= 1);
        assert.equal(context.includes("Synthetic mobile"), stage >= 2);
        assert.equal(context.includes("95% interval"), stage >= 3);
        assert.ok(context.includes(priorities[priority]));
      }
  assert.ok(!contextSnapshot({ own: true }).includes("600→576"));
});
test("the synthetic replay ends without a successful activation event", () => {
  assert.equal(trail.length, 6);
  assert.equal(trail[2].event, "signup_completed");
  assert.equal(trail[4].event, "connection_error");
  assert.equal(trail.at(-1).event, "session_exit");
  assert.ok(
    trail.every(
      (item, index) => index === 0 || item.time > trail[index - 1].time,
    ),
  );
});
