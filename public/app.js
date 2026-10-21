// Subscription Graveyard frontend. Plain JS, no build step.

const SPOOKY_ERROR = "The spirits couldn't read this file… Try another bank statement CSV.";

const $ = (id) => document.getElementById(id);
const screens = { landing: $("landing"), graveyard: $("graveyard") };

const money = (n) =>
  n.toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
  window.scrollTo(0, 0);
}

function showError(message) {
  const el = $("landing-error");
  el.textContent = message;
  el.hidden = false;
}

function setBusy(busy) {
  $("demo-btn").disabled = busy;
  $("file-input").disabled = busy;
  $("demo-btn").textContent = busy ? "🪦 Summoning…" : "🧟 Summon demo graveyard";
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
  setBusy(true);
  try {
    const csvText = await getCsvText();
    const result = await detect(csvText);
    renderGraveyard(result);
    showScreen("graveyard");
  } catch (err) {
    showError(err.message || SPOOKY_ERROR);
  } finally {
    setBusy(false);
  }
}

function renderGraveyard({ subscriptions, totalYearly }) {
  const active = subscriptions.filter((s) => s.status === "active");
  $("summary").textContent =
    subscriptions.length === 0
      ? "No zombies found. Your graveyard is peaceful… for now."
      : `${active.length} zombie${active.length === 1 ? " is" : "s are"} draining ${money(totalYearly)} per year`;

  const list = $("zombie-list");
  list.replaceChildren(
    ...subscriptions.map((s) => {
      const li = document.createElement("li");
      if (s.status === "dormant") li.classList.add("dormant");
      const hike = s.priceHike ? ` · 🧬 MUTATED +${money(s.priceHike.to - s.priceHike.from)}` : "";
      const dormant = s.status === "dormant" ? " · dormant" : "";
      li.textContent = `${s.name} — ${money(s.amount)} / ${s.frequency} — ${money(s.yearlyCost)} per year${hike}${dormant}`;
      return li;
    })
  );
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
