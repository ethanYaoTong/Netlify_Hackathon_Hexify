// Subscription Graveyard frontend. Plain JS, no build step.

const SPOOKY_ERROR = "The spirits couldn't read this file. Try another bank statement CSV.";
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const SUMMON_MS = REDUCED_MOTION ? 300 : 1500; // minimum time the summoning animation plays
const RISE_STAGGER_MS = 300;

const FREQUENCY_UNIT = { weekly: "week", fortnightly: "fortnight", monthly: "month", quarterly: "quarter", yearly: "year" };
const ROT_LABEL = ["Fresh", "Rotting", "Putrid", "Ancient"];

// 14×16 pixel-art zombie head. Colours come from CSS variables so rot level can recolour it.
// H hair, S skin, D shade, K black, E eye, T teeth, B blood, . transparent
const ZOMBIE_PIXELS = [
  "....HHHHHH....",
  "..HHHSHHHHHH..",
  ".HSSSSSSSSSSH.",
  ".SSSSSSSSSSSS.",
  ".SDDDSSSSDDDS.",
  ".SKEKSSSSKEKS.",
  ".SKKKSSSSKKKS.",
  ".SSSSSDDSSSSD.",
  ".SSDSSKKSSSSD.",
  ".SSSDSSSSSSSS.",
  ".SKTKTKTKTKKS.",
  ".SSKKKKKKKKSS.",
  "..SBSSSSSSSS..",
  "...BSSSSSSS...",
  "....DSSSSD....",
  ".....DDDD.....",
];
const PIXEL_FILL = { H: "var(--hair)", S: "var(--skin)", D: "var(--shade)", K: "#000", E: "var(--eye)", T: "#e8e0d0", B: "#c0262d" };

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

/** Turns ZOMBIE_PIXELS into a reusable <symbol id="zombie-sprite">, one rect per horizontal run. */
function buildSprite() {
  const rects = [];
  ZOMBIE_PIXELS.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const c = row[x];
      let run = 1;
      while (row[x + run] === c) run++;
      if (PIXEL_FILL[c]) rects.push(`<rect x="${x}" y="${y}" width="${run}" height="1" style="fill:${PIXEL_FILL[c]}"/>`);
      x += run;
    }
  });
  const defs = document.createElement("div");
  defs.setAttribute("aria-hidden", "true");
  defs.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  defs.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><symbol id="zombie-sprite" viewBox="0 0 14 16">${rects.join("")}</symbol></svg>`;
  document.body.prepend(defs);
}

function spriteSvg() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "sprite");
  svg.setAttribute("viewBox", "0 0 14 16");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#zombie-sprite");
  svg.append(use);
  return svg;
}

function showScreen(name) {
  for (const [key, screen] of Object.entries(screens)) screen.hidden = key !== name;
  document.body.dataset.screen = name;
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
    throw new Error("The spirits are unreachable. Check your connection and try again.");
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
    // Let the static play for the full summoning time even if the API is fast.
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
      : `${active.length} zombie${active.length === 1 ? " is" : "s are"} draining ${money(totalYearly)} a year`;
  $("summary-sub").textContent =
    subscriptions.length === 0
      ? "Your graveyard is quiet. Try a longer statement to catch more."
      : dormant.length
        ? `Plus ${dormant.length} asleep that stopped charging you.`
        : "Strongest first. Slay them to save.";

  // HP bars are relative to the most expensive zombie.
  const maxYearly = Math.max(...subscriptions.map((s) => s.yearlyCost), 1);

  // Active zombies first (most expensive first), dormant ones at the back.
  const cards = [...active, ...dormant].map((s, i) => {
    const card = zombieCard(s, maxYearly);
    card.style.animationDelay = `${i * RISE_STAGGER_MS}ms`;
    return card;
  });
  $("zombies").replaceChildren(...cards);
}

function zombieCard(s, maxYearly) {
  const card = el("article", "zombie");
  card.dataset.rot = s.rotLevel;
  card.dataset.id = s.id;
  const asleep = s.status === "dormant";
  if (asleep) card.classList.add("dormant");

  const heading = el("div");
  heading.append(el("h3", "zombie-name", s.name), el("p", "zombie-level", `Lv ${s.rotLevel} ${ROT_LABEL[s.rotLevel] ?? ""}`));
  const top = el("div", "zombie-top");
  top.append(spriteSvg(), heading);

  const yearly = el("p", "zombie-yearly", money(s.yearlyCost));
  yearly.append(el("span", "", " a year"));

  const hp = el("div", "hp");
  hp.setAttribute("role", "img");
  hp.setAttribute("aria-label", `${Math.round((s.yearlyCost / maxYearly) * 100)}% of your most expensive subscription`);
  const fill = el("div", "hp-fill");
  fill.style.width = `${Math.max(4, (s.yearlyCost / maxYearly) * 100)}%`;
  hp.append(fill);

  const statuses = el("div", "statuses");
  if (s.priceHike) statuses.append(el("span", "status status-mutated", `Mutated +${money(s.priceHike.to - s.priceHike.from)}`));
  if (asleep) statuses.append(el("span", "status status-asleep", "zZ Asleep"));

  card.append(
    top,
    el("p", "zombie-price", `${money(s.amount)} / ${FREQUENCY_UNIT[s.frequency] ?? s.frequency}`),
    yearly,
    hp,
    el(
      "p",
      "zombie-since",
      asleep
        ? `Stopped charging in ${monthYear(s.lastCharged)}`
        : `Haunting you since ${monthYear(s.firstCharged)}`
    )
  );
  if (statuses.childElementCount) card.append(statuses);
  return card;
}

// ---- Event wiring ----

buildSprite();

$("demo-btn").addEventListener("click", () =>
  summon(async () => {
    const res = await fetch("/demo-transactions.csv").catch(() => null);
    if (!res || !res.ok) throw new Error("The demo graveyard won't open. Try again in a moment.");
    return res.text();
  })
);

// The upload label acts as a menu button, so let keyboard users open the picker too.
$("upload-btn").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    $("file-input").click();
  }
});

$("file-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // allow re-selecting the same file later
  if (file) summon(() => file.text());
});

$("back-btn").addEventListener("click", () => showScreen("landing"));
