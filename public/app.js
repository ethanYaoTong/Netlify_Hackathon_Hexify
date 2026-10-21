// Subscription Graveyard frontend. Plain JS, no build step.

const SPOOKY_ERROR = "The spirits couldn't read this file… Try another bank statement CSV.";
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const SUMMON_MS = REDUCED_MOTION ? 300 : 1500; // minimum time the summoning animation plays
const RISE_STAGGER_MS = 300;

const FREQUENCY_UNIT = { weekly: "week", fortnightly: "fortnight", monthly: "month", quarterly: "quarter", yearly: "year" };
const ROT_LABEL = ["Fresh", "Rotting", "Putrid", "Ancient"];

const $ = (id) => document.getElementById(id);
const screens = { landing: $("landing"), graveyard: $("graveyard") };

const money = (n) =>
  n.toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
const monthYear = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { month: "short", year: "numeric", timeZone: "UTC" });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Tiny DOM helper. Uses textContent so merchant names from user CSVs can't inject HTML. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showScreen(name) {
  for (const [key, screen] of Object.entries(screens)) screen.hidden = key !== name;
  window.scrollTo(0, 0);
}

function showError(message) {
  const error = $("landing-error");
  error.textContent = message;
  error.hidden = false;
}

function setSummoning(on) {
  $("demo-btn").disabled = on;
  $("file-input").disabled = on;
  $("summoning").hidden = !on;
  document.body.classList.toggle("shaking", on);
}

/** Sends CSV text to the detection engine and returns its JSON. */
async function detect(csvText) {
  let res;
  try {
    res = await fetch("/api/detect", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: csvText,
    });
  } catch {
    throw new Error("The spirits are unreachable… Check your connection and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(data?.error || SPOOKY_ERROR);
  return data;
}

async function summon(getCsvText) {
  $("landing-error").hidden = true;
  setSummoning(true);
  try {
    const csvText = await getCsvText();
    // Let the ground shake for the full summoning time even if the API is fast.
    const [result] = await Promise.all([detect(csvText), delay(SUMMON_MS)]);
    renderGraveyard(result);
    showScreen("graveyard");
  } catch (err) {
    showError(err.message || SPOOKY_ERROR);
  } finally {
    setSummoning(false);
  }
}

function renderGraveyard({ subscriptions, totalYearly }) {
  const active = subscriptions.filter((s) => s.status === "active");
  const dormant = subscriptions.filter((s) => s.status === "dormant");

  $("summary").textContent =
    subscriptions.length === 0
      ? "No zombies found"
      : `${active.length} zombie${active.length === 1 ? " is" : "s are"} draining ${money(totalYearly)} per year`;
  $("summary-sub").textContent =
    subscriptions.length === 0
      ? "Your graveyard is peaceful… for now."
      : dormant.length
        ? `Plus ${dormant.length} dormant zombie${dormant.length === 1 ? "" : "s"} that stopped feeding on you.`
        : "Most expensive first. Slay them to save.";

  // Active zombies first (most expensive first), dormant ones at the back.
  const cards = [...active, ...dormant].map((s, i) => {
    const card = zombieCard(s);
    card.style.animationDelay = `${i * RISE_STAGGER_MS}ms`;
    return card;
  });
  $("zombies").replaceChildren(...cards);
}

function zombieCard(s) {
  const card = el("article", "zombie");
  card.dataset.rot = s.rotLevel;
  card.dataset.id = s.id;
  if (s.status === "dormant") card.classList.add("dormant");

  const yearly = el("p", "zombie-yearly", money(s.yearlyCost));
  yearly.append(el("span", "", "per year"));

  const badges = el("div", "badges");
  if (s.priceHike) badges.append(el("span", "badge badge-mutated", `🧬 MUTATED +${money(s.priceHike.to - s.priceHike.from)}`));
  if (s.status === "dormant") badges.append(el("span", "badge badge-dormant", `💤 DORMANT · last fed ${monthYear(s.lastCharged)}`));
  badges.append(el("span", "badge badge-rot", `☠️ ${ROT_LABEL[s.rotLevel] ?? "Rotting"}`));

  card.append(
    el("div", "zombie-figure", "🧟"),
    el("h3", "zombie-name", s.name),
    el("p", "zombie-price", `${money(s.amount)} / ${FREQUENCY_UNIT[s.frequency] ?? s.frequency}`),
    yearly,
    el("p", "zombie-since", `haunting you since ${monthYear(s.firstCharged)}`),
    badges
  );
  return card;
}

// ---- Event wiring ----

$("demo-btn").addEventListener("click", () =>
  summon(async () => {
    const res = await fetch("/demo-transactions.csv").catch(() => null);
    if (!res || !res.ok) throw new Error("The demo graveyard won't open… Try again in a moment.");
    return res.text();
  })
);

$("file-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // allow re-selecting the same file later
  if (file) summon(() => file.text());
});

$("back-btn").addEventListener("click", () => showScreen("landing"));
