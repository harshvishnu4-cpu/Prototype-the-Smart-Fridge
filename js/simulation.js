/*
 * Fridge stock simulation — pure logic, no DOM.
 * Every number the learner sees (recording, calibration, fix, households)
 * comes from simulateWeek(), so the evidence always matches the rules.
 *
 * One day, in order:
 *   1. Morning delivery arrives (orders arrive two days after they are queued).
 *   2. Yesterday's queued order is sent to the shop.
 *      With `recheck`, the fridge looks again first and cancels if stock is no longer low.
 *   3. Morning check: if stock <= threshold and no order is waiting, queue one.
 *   4. The household uses milk. Not enough milk = a run-out day.
 *   5. Evening events (for example, Papa bringing cartons home).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FridgeSim = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  const DEFAULTS = {
    start: 4,        // cartons on Monday morning
    use: 1,          // cartons used per day (number or 7-item array)
    pack: 4,         // cartons in one delivery
    freshLimit: 4,   // more than this can't be finished while fresh
    threshold: 2,    // order when stock is at or below this number
    recheck: false,  // look again just before sending the order
    events: {}       // { Wed: { add: 2, by: "papa" } }
  };

  function simulateWeek(options) {
    const o = Object.assign({}, DEFAULTS, options);
    const usage = Array.isArray(o.use) ? o.use : DAYS.map(() => o.use);
    let stock = o.start;
    let order = null;
    const days = [];

    DAYS.forEach((name, d) => {
      const day = {
        index: d, day: name, dayName: DAY_NAMES[d],
        delivered: 0, queued: false, sent: false, cancelled: false,
        waiting: false, recheckStock: null, runOut: false,
        used: 0, added: 0, addedBy: null
      };

      if (order && order.status === "sent" && order.arriveDay === d) {
        stock += o.pack; day.delivered = o.pack; order = null;
      }

      if (order && order.status === "queued" && order.queuedDay === d - 1) {
        if (o.recheck) day.recheckStock = stock;
        if (o.recheck && stock > o.threshold) {
          day.cancelled = true; order = null;
        } else {
          order.status = "sent"; order.arriveDay = d + 1; day.sent = true;
        }
      }

      day.morning = stock;
      if (!order && stock <= o.threshold) {
        order = { queuedDay: d, status: "queued" }; day.queued = true;
      } else if (order && !day.sent) {
        day.waiting = true;
      }

      const need = usage[d];
      if (stock < need) { day.runOut = true; day.used = stock; stock = 0; }
      else { stock -= need; day.used = need; }

      const event = o.events[name] || o.events[d];
      if (event && event.add) { stock += event.add; day.added = event.add; day.addedBy = event.by || null; }

      day.evening = stock;
      day.over = Math.max(0, day.morning - o.freshLimit);
      days.push(day);
    });

    const runOutDays = days.filter(day => day.runOut);
    const peakDay = days.reduce((best, day) => (day.morning > best.morning ? day : best), days[0]);
    const peak = Math.max(peakDay.morning, ...days.map(day => day.evening));
    const extraCartons = Math.max(0, peak - o.freshLimit);
    const outcome = runOutDays.length ? "runout" : extraCartons ? "excess" : "balanced";

    return { days, runOutDays, peak, peakDay, extraCartons, outcome, options: o };
  }

  /* The scenarios the mission uses. */
  const scenarios = {
    normalWeek: threshold => simulateWeek({ threshold }),
    recordedWeek: () => simulateWeek({ threshold: 2, events: { Wed: { add: 2, by: "papa" } } }),
    fixedWeek: () => simulateWeek({ threshold: 2, recheck: true, events: { Wed: { add: 2, by: "papa" } } }),
    households: () => [
      { id: "meera", title: "Meera’s home", detail: "4 people · 1 carton a day", result: simulateWeek({ threshold: 2, use: 1 }) },
      { id: "big", title: "Big joint family", detail: "8 people · 2 cartons a day", result: simulateWeek({ threshold: 2, use: 2 }) },
      { id: "small", title: "Grandparents", detail: "2 people · 1 carton every 2 days", result: simulateWeek({ threshold: 2, use: [1, 0, 1, 0, 1, 0, 1] }) }
    ]
  };

  return { DAYS, DAY_NAMES, DEFAULTS, simulateWeek, scenarios };
});
