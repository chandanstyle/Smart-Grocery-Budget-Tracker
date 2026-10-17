// Smart Grocery Budget Planner
// Login + data via Firebase (Auth + Firestore). Each user sees only their own data.

const OLD_KEYS = ["grocery-planner-v2"]; // local data from the earlier no-login version

function currentMonthKey() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

// state = { current: "2026-10", months: { "2026-10": { budget, items: [] } } }
// Cloud path: users/{uid}/months/{YYYY-MM}
let state = { current: currentMonthKey(), months: {} };

// ---------- Firebase ----------
const firebaseReady = typeof firebaseConfig !== "undefined" &&
  firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith("PASTE");

let auth = null, db = null, user = null, unsubscribe = null;
if (firebaseReady) {
  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();
}

function monthsCol() {
  return db.collection("users").doc(user.uid).collection("months");
}

// Save one month to the cloud (works offline too, syncs later)
function persist(key) {
  if (!user || !state.months[key]) return;
  monthsCol().doc(key).set(state.months[key]).catch((e) => showSyncError(e));
}

function removeMonthCloud(key) {
  if (!user) return;
  monthsCol().doc(key).delete().catch((e) => showSyncError(e));
}

function showSyncError(e) {
  console.error(e);
  alert("Could not save: " + (e.message || e) + "\nCheck your internet or the Firestore rules.");
}

let budgetTimer = null;
function persistSoon(key) {
  clearTimeout(budgetTimer);
  budgetTimer = setTimeout(() => persist(key), 500);
}

// The month being edited. It is only stored once it has a budget or items.
function cur() {
  return state.months[state.current] || { budget: 0, items: [] };
}

function ensureCur() {
  if (!state.months[state.current]) state.months[state.current] = { budget: 0, items: [] };
  return state.months[state.current];
}

function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);

function rupees(n) {
  return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function lineTotal(item) {
  return item.qty * item.price;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------- Calculations ----------
function totals(month) {
  month = month || cur();
  let total = 0, must = 0, bought = 0;
  const byCategory = {};
  for (const it of month.items) {
    const t = lineTotal(it);
    total += t;
    if (it.priority === "must") must += t;
    if (it.bought) bought += 1;
    byCategory[it.category] = (byCategory[it.category] || 0) + t;
  }
  return { total, must, optional: total - must, bought, byCategory };
}

function tipText(t) {
  const budget = cur().budget;
  if (!budget) return "Enter your monthly budget to start tracking.";
  if (!cur().items.length) return "Add your first item to see how much budget it uses.";

  const remaining = budget - t.total;
  const percent = Math.round((t.total / budget) * 100);

  if (remaining < 0) {
    const over = -remaining;
    if (t.optional >= over) {
      return "You are " + rupees(over) + " over budget. Skip some 'Can wait' items (worth " +
        rupees(t.optional) + " in total) and you are back within budget.";
    }
    return "You are " + rupees(over) + " over budget. Even without the 'Can wait' items you are " +
      rupees(over - t.optional) + " over. Try smaller quantities or cheaper options.";
  }
  if (percent >= 80) {
    return "You have used " + percent + "% of your budget. Only " + rupees(remaining) +
      " left, so think twice before adding more 'Can wait' items.";
  }
  return "On track. You have used " + percent + "% and " + rupees(remaining) + " is still free.";
}

// ---------- Rendering ----------
function render() {
  const t = totals();
  const budget = cur().budget;

  // Budget number + meter
  const page = document.body;
  page.classList.remove("state-warn", "state-over");

  let ratio = 0;
  if (budget > 0) {
    ratio = t.total / budget;
    $("remaining").textContent = rupees(Math.abs(budget - t.total));
    $("remaining-label").textContent = budget - t.total >= 0 ? "left to spend" : "over budget";
    if (ratio > 1) page.classList.add("state-over");
    else if (ratio >= 0.8) page.classList.add("state-warn");
  } else {
    $("remaining").textContent = "—";
    $("remaining-label").textContent = "Set a budget to begin";
  }

  const shown = Math.min(ratio, 1) * 100;
  $("meter-fill").style.width = shown + "%";
  $("meter").setAttribute("aria-valuenow", String(Math.round(shown)));

  // The state classes are on <body>, but styles target .state-* ancestors, so this works for the whole page.
  $("planned").textContent = rupees(t.total);
  $("weekly").textContent = rupees(budget / 4);
  $("bought").textContent = t.bought + " of " + cur().items.length + " items";
  $("tip").textContent = tipText(t);

  renderBreakdown(t);
  renderList();
  renderHistory();
}

function renderBreakdown(t) {
  const ul = $("breakdown");
  ul.replaceChildren();
  const rows = Object.entries(t.byCategory)
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1]);

  $("breakdown-empty").hidden = rows.length > 0;

  for (const [name, amount] of rows) {
    const pct = t.total ? Math.round((amount / t.total) * 100) : 0;
    const li = el("li");
    const line = el("div", "line");
    line.append(el("span", "", name), el("span", "", rupees(amount) + " (" + pct + "%)"));
    const track = el("div", "track");
    const fill = el("div", "fill");
    fill.style.width = pct + "%";
    track.append(fill);
    li.append(line, track);
    ul.append(li);
  }
}

function renderList() {
  const ul = $("list");
  ul.replaceChildren();
  const items = cur().items;
  $("list-empty").hidden = items.length > 0;
  $("clear").hidden = items.length === 0;

  for (const it of items) {
    const li = el("li", "item" + (it.bought ? " done" : ""));

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = !!it.bought;
    check.setAttribute("aria-label", "Mark " + it.name + " as bought");
    check.addEventListener("change", () => {
      it.bought = check.checked;
      persist(state.current);
      render();
    });

    const info = el("div");
    info.append(
      el("div", "name", it.name),
      el("div", "meta", it.qty + " × " + rupees(it.price) + " · " + it.category)
    );

    const amount = el("div", "amount", rupees(lineTotal(it)));

    const actions = el("div", "actions");
    const tag = el("button", "tag " + it.priority, it.priority === "must" ? "Must buy" : "Can wait");
    tag.type = "button";
    tag.title = "Tap to change priority";
    tag.addEventListener("click", () => {
      it.priority = it.priority === "must" ? "wait" : "must";
      persist(state.current);
      render();
    });

    const del = el("button", "del", "Delete");
    del.type = "button";
    del.addEventListener("click", () => {
      const m = cur();
      m.items = m.items.filter((x) => x.id !== it.id);
      persist(state.current);
      render();
    });

    actions.append(tag, del);
    li.append(check, info, amount, actions);
    ul.append(li);
  }
}

// ---------- Events ----------
$("budget").addEventListener("input", (e) => {
  ensureCur().budget = Math.max(0, Number(e.target.value) || 0);
  persistSoon(state.current);
  render();
});

$("item-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("name").value.trim();
  const qty = Number($("qty").value);
  const price = Number($("price").value);
  if (!name || !(qty > 0) || !(price >= 0)) return;

  ensureCur().items.push({
    id: Date.now() + Math.random(),
    name,
    category: $("category").value,
    qty,
    price,
    priority: $("priority").value,
    bought: false
  });
  persist(state.current);
  render();

  $("name").value = "";
  $("price").value = "";
  $("qty").value = "1";
  $("name").focus();
});

$("clear").addEventListener("click", () => {
  if (confirm("Remove all items of " + monthLabel(state.current) + "? Budget will stay.")) {
    ensureCur().items = [];
    persist(state.current);
    render();
  }
});


// ---------- All budgets (history) ----------
function renderHistory() {
  const ul = $("history");
  ul.replaceChildren();
  const keys = Object.keys(state.months)
    .filter((k) => state.months[k].budget > 0 || state.months[k].items.length > 0)
    .sort().reverse(); // newest month first

  $("history-empty").hidden = keys.length > 0;
  $("history-count").textContent = keys.length ? keys.length + (keys.length === 1 ? " month" : " months") : "";

  for (const key of keys) {
    const m = state.months[key];
    const t = totals(m);
    const left = m.budget - t.total;
    let status = "ok", statusText = "Within budget";
    if (!m.budget) { status = "none"; statusText = "No budget set"; }
    else if (left < 0) { status = "over"; statusText = "Over by " + rupees(-left); }
    else if (t.total / m.budget >= 0.8) { status = "warn"; statusText = rupees(left) + " left"; }
    else statusText = rupees(left) + " left";

    const li = el("li", "month-card " + status + (key === state.current ? " active" : ""));
    const head = el("div", "month-head");
    const title = el("div");
    title.append(el("div", "month-name", monthLabel(key)),
      el("div", "meta", m.items.length + " items · " + t.bought + " bought"));
    head.append(title, el("span", "badge " + status, statusText));

    const nums = el("dl", "month-nums");
    for (const [label, val] of [["Budget", rupees(m.budget)], ["Planned", rupees(t.total)]]) {
      const d = el("div");
      d.append(el("dt", "", label), el("dd", "", val));
      nums.append(d);
    }

    const details = el("details", "month-items");
    details.append(el("summary", "", "View full list"));
    if (m.items.length) {
      const inner = el("ul", "mini-list");
      for (const it of m.items) {
        const row = el("li", it.bought ? "done" : "");
        row.append(
          el("span", "", (it.bought ? "✓ " : "") + it.name + " (" + it.qty + " × " + rupees(it.price) + ")"),
          el("span", "mini-amt", rupees(lineTotal(it)))
        );
        inner.append(row);
      }
      details.append(inner);
    } else {
      details.append(el("p", "muted", "No items in this month."));
    }

    const actions = el("div", "month-actions");
    const open = el("button", "btn small", key === state.current ? "Editing now" : "Open / Edit");
    open.type = "button";
    open.disabled = key === state.current;
    open.addEventListener("click", () => { switchMonth(key); window.scrollTo({ top: 0, behavior: "smooth" }); });
    const del = el("button", "del", "Delete month");
    del.type = "button";
    del.addEventListener("click", () => {
      if (!confirm(monthLabel(key) + " - delete the whole budget and list for this month?")) return;
      delete state.months[key];
      removeMonthCloud(key);
      $("budget").value = cur().budget || "";
      render();
    });
    actions.append(open, del);

    li.append(head, nums, details, actions);
    ul.append(li);
  }
}

function switchMonth(key) {
  if (!key) return;
  state.current = key;
  $("month").value = key;
  $("budget").value = cur().budget || "";
  render();
}

$("month").addEventListener("change", (e) => switchMonth(e.target.value));

// ---------- Login / Logout ----------
let signupMode = false;

function setAuthMode(signup) {
  signupMode = signup;
  $("auth-title").textContent = signup ? "New account" : "Login";
  $("auth-submit").textContent = signup ? "Create account" : "Login";
  $("toggle-mode").textContent = signup ? "Already have an account? Login" : "Create a new account";
  $("password").autocomplete = signup ? "new-password" : "current-password";
  showAuthError("");
}

function showAuthError(msg) {
  $("auth-error").textContent = msg;
  $("auth-error").hidden = !msg;
}

function friendlyAuthError(e) {
  const map = {
    "auth/invalid-email": "Email is not valid.",
    "auth/missing-password": "Enter a password.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/email-already-in-use": "An account with this email already exists. Please login.",
    "auth/invalid-credential": "Email or password is wrong.",
    "auth/user-not-found": "No account found for this email.",
    "auth/wrong-password": "Wrong password.",
    "auth/too-many-requests": "Too many attempts, try again later.",
    "auth/popup-closed-by-user": "Google window was closed.",
    "auth/unauthorized-domain": "This website is not in Firebase Authorized domains.",
    "auth/operation-not-allowed": "This login method is not enabled in Firebase.",
    "auth/network-request-failed": "Check your internet connection."
  };
  return map[e.code] || (e.message || "Something went wrong.");
}

$("toggle-mode").addEventListener("click", (e) => { e.preventDefault(); setAuthMode(!signupMode); });

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!firebaseReady) return;
  showAuthError("");
  const email = $("email").value.trim();
  const pass = $("password").value;
  try {
    if (signupMode) await auth.createUserWithEmailAndPassword(email, pass);
    else await auth.signInWithEmailAndPassword(email, pass);
  } catch (err) { showAuthError(friendlyAuthError(err)); }
});

$("google").addEventListener("click", async () => {
  if (!firebaseReady) return;
  showAuthError("");
  try { await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); }
  catch (err) { showAuthError(friendlyAuthError(err)); }
});

$("forgot").addEventListener("click", async (e) => {
  e.preventDefault();
  const email = $("email").value.trim();
  if (!email) return showAuthError("Enter your email above first, then click Forgot password.");
  try {
    await auth.sendPasswordResetEmail(email);
    showAuthError("Reset link sent to your email (check spam too).");
  } catch (err) { showAuthError(friendlyAuthError(err)); }
});

$("logout").addEventListener("click", () => auth && auth.signOut());

// ---------- Start ----------
function showApp(loggedIn) {
  $("auth").hidden = loggedIn;
  $("app").hidden = !loggedIn;
  $("userbar").hidden = !loggedIn;
}

// One-time: if this browser has data from the old no-login version, upload it
async function importOldLocalData() {
  try {
    const snap = await monthsCol().limit(1).get();
    if (!snap.empty) return;
    for (const k of OLD_KEYS) {
      const old = JSON.parse(localStorage.getItem(k));
      if (old && old.months && Object.keys(old.months).length &&
          confirm("Found old data (without login) in this browser. Copy it to your account?")) {
        for (const [key, m] of Object.entries(old.months)) await monthsCol().doc(key).set(m);
        return;
      }
    }
  } catch (e) { /* ignore */ }
}

function startListening() {
  unsubscribe = monthsCol().onSnapshot((snap) => {
    const months = {};
    snap.forEach((d) => { months[d.id] = { budget: Number(d.data().budget) || 0, items: d.data().items || [] }; });
    // keep an empty current month locally so the form works before the first save
    state.months = months;
    if (document.activeElement !== $("budget")) $("budget").value = cur().budget || "";
    render();
  }, (e) => showSyncError(e));
}

if (!firebaseReady) {
  showApp(false);
  $("setup-warning").hidden = false;
} else {
  auth.onAuthStateChanged((u) => {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    user = u;
    if (!u) {
      state = { current: currentMonthKey(), months: {} };
      $("password").value = "";
      showApp(false);
      return;
    }
    $("user-email").textContent = u.email || u.displayName || "";
    state = { current: currentMonthKey(), months: {} };
    $("month").value = state.current;
    $("budget").value = "";
    showApp(true);
    render();
    importOldLocalData().then(startListening);
  });
}
