async function fetchPoints() {
  try {
    const res = await fetch("/api/data");
    if (!res.ok) throw new Error("Cannot fetch /api/data");
    return await res.json();
  } catch (err) {
    console.error(err);
    alert("Something went wrong while loading measurement points.");
    return [];
  }
}
let allPoints = [];

// ---- NO2 (µg/m³) input rules ----
const MEASUREMENT_MIN = 0;
const MEASUREMENT_MAX = 200; // pas aan als je strakker wil

function normalizeValue(inputString) {
  if (!inputString) return null;

  const cleaned = inputString.replace(",", ".");
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;

  return num;
}

function computeStats(points) {
  let totalMeasurements = 0;
  let minDate = null;
  let maxDate = null;

  points.forEach((p) => {
    const measurements = Array.isArray(p.measurements) ? p.measurements : [];
    totalMeasurements += measurements.length;

    measurements.forEach((m) => {
      const d = new Date(m.date);
      if (Number.isNaN(d.getTime())) return;
      if (!minDate || d < minDate) minDate = d;
      if (!maxDate || d > maxDate) maxDate = d;
    });
  });

  let yearsLabel = "–";
  if (minDate && maxDate) {
    const minYear = minDate.getFullYear();
    const maxYear = maxDate.getFullYear();
    yearsLabel = minYear === maxYear ? String(minYear) : `${minYear} – ${maxYear}`;
  }

  return {
    totalPoints: points.length,
    totalMeasurements,
    yearsLabel,
  };
}

function renderStats(points) {
  const { totalPoints, totalMeasurements, yearsLabel } = computeStats(points);
  document.getElementById("stat-points").textContent = totalPoints;
  document.getElementById("stat-measurements").textContent = totalMeasurements;
  document.getElementById("stat-years").textContent = yearsLabel;
}

function renderPointsTable(points) {
  const tbody = document.getElementById("points-tbody");
  const emptyState = document.getElementById("beheer-empty");
  const tableCount = document.getElementById("table-count");

  if (!tbody || !emptyState || !tableCount) return;

  tbody.innerHTML = "";

  const source = Array.isArray(points) ? points : (Array.isArray(allPoints) ? allPoints : []);

  if (!source.length) {
    emptyState.classList.remove("hidden");
    tableCount.textContent = "0 results";
    return;
  } else {
    emptyState.classList.add("hidden");
  }

  // Active points first, then inactive, both groups sorted by name
  const sortedPoints = source.slice().sort((a, b) => {
    const aActive = a && a.active !== false; // default: active
    const bActive = b && b.active !== false;

    if (aActive !== bActive) return aActive ? -1 : 1;

    const aName = (
      (a && (a.location || a.description || a.name || a.stationName)) || ""
    ).toLowerCase();
    const bName = (
      (b && (b.location || b.description || b.name || b.stationName)) || ""
    ).toLowerCase();
    return aName.localeCompare(bName);
  });

  sortedPoints.forEach((p, index) => {
    const tr = document.createElement("tr");

    const measurements = Array.isArray(p && p.measurements) ? p.measurements : [];

    let firstDate = null;
    let lastDate = null;
    measurements.forEach((m) => {
      const d = new Date(m.date);
      if (Number.isNaN(d.getTime())) return;
      if (!firstDate || d < firstDate) firstDate = d;
      if (!lastDate || d > lastDate) lastDate = d;
    });

    const name =
      (p && (p.location || p.description || p.name || p.stationName)) ||
      `Point ${index + 1}`;

    const coords = (p && p.coordinates) || {};
    const lat = typeof coords.lat === "number" ? coords.lat.toFixed(4) : "–";
    const lon = typeof coords.lon === "number" ? coords.lon.toFixed(4) : "–";

    const id = (p && p._id && (p._id.$oid || p._id)) || "";
    const isActive = !p || p.active !== false; // default: active

    tr.dataset.search = [
      name,
      lat,
      lon,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    tr.innerHTML = `
      <td data-label="Name">${name}</td>
      <td data-label="Coordinates">Lat: ${lat}<br>Lon: ${lon}</td>
      <td data-label="Number of measurements">${measurements.length}</td>
      <td data-label="First date">${firstDate ? firstDate.toISOString().slice(0, 10) : "–"}</td>
      <td data-label="Last date">${lastDate ? lastDate.toISOString().slice(0, 10) : "–"}</td>
      <td data-label="Status">${isActive ? "Active" : "Inactive"}</td>
      <td data-label="Actions"></td>
    `;

    const actionsCell = tr.querySelector('td[data-label="Actions"]');
    if (actionsCell && id) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-secondary point-toggle-btn";
      btn.dataset.id = id;
      btn.dataset.active = isActive ? "1" : "0";
      btn.textContent = isActive ? "Deactivate" : "Activate";
      actionsCell.appendChild(btn);
    }

    tbody.appendChild(tr);
  });

  tableCount.textContent = `${source.length} results`;

  // Attach toggle handlers
  const buttons = tbody.querySelectorAll(".point-toggle-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const currentlyActive = btn.dataset.active === "1";
      if (!id) return;
      updatePointActive(id, !currentlyActive);
    });
  });
}

async function updatePointActive(pointId, makeActive) {
  if (!pointId) return;

  try {
    const res = await fetch(`/api/points/${encodeURIComponent(pointId)}/active`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ active: !!makeActive }),
    });

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }

    if (!res.ok || (data && data.error)) {
      throw new Error((data && data.error) || "Failed to update point status.");
    }

    // Update local cache
    if (Array.isArray(allPoints)) {
      allPoints = allPoints.map((p) => {
        const id = p && p._id && (p._id.$oid || p._id) || "";
        if (id === pointId) {
          return Object.assign({}, p, { active: !!makeActive });
        }
        return p;
      });
    }

    renderStats(allPoints);
    renderPointsTable(allPoints);
    renderBatchRows(allPoints);
  } catch (err) {
    console.error(err);
    alert("Could not update point status.");
  }
}

function setupSearch() {
  const input = document.getElementById("search-input");
  const tbody = document.getElementById("points-tbody");
  const tableCount = document.getElementById("table-count");

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();

    let visible = 0;
    Array.from(tbody.rows).forEach((row) => {
      const haystack = row.dataset.search || "";
      const match = !q || haystack.includes(q);
      row.style.display = match ? "" : "none";
      if (match) visible++;
    });

    tableCount.textContent = `${visible} results`;
  });
}

/* ---------- Users section ---------- */

async function fetchUsers() {
  try {
    const res = await fetch("/api/users");
    if (!res.ok) throw new Error("Cannot fetch /api/users");
    return await res.json();
  } catch (err) {
    console.error(err);
    return [];
  }
}

function renderUsers(users) {
  const tbody = document.getElementById("users-tbody");
  const emptyState = document.getElementById("users-empty");

  tbody.innerHTML = "";

  if (!users.length) {
    emptyState.classList.remove("hidden");
    return;
  } else {
    emptyState.classList.add("hidden");
  }

  users.forEach((user) => {
    const tr = document.createElement("tr");
    const created = user.createdAt
      ? new Date(user.createdAt).toISOString().slice(0, 10)
      : "–";

    tr.innerHTML = `
      <td data-label="E-mail">${user.email}</td>
      <td data-label="Created">${created}</td>
      <td data-label="Actions">
        <button type="button" class="user-delete-btn" data-id="${user._id}">Remove</button>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

function setupUsersSection() {
  const form = document.getElementById("user-add-form");
  const emailInput = document.getElementById("user-email-input");
  const errorEl = document.getElementById("user-add-error");
  const tbody = document.getElementById("users-tbody");

  if (!form) return;

  async function refreshUsers() {
    const users = await fetchUsers();
    renderUsers(users);
  }

  refreshUsers();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";

    const email = (emailInput.value || "").trim();
    if (!email) {
      errorEl.textContent = "Please enter an e-mail address.";
      return;
    }

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to add user.");
      }

      emailInput.value = "";
      await refreshUsers();
    } catch (err) {
      console.error(err);
      errorEl.textContent = err.message || "Could not add user.";
    }
  });

  tbody.addEventListener("click", async (e) => {
    const btn = e.target.closest(".user-delete-btn");
    if (!btn) return;

    const id = btn.dataset.id;
    if (!id) return;

    if (!confirm("Remove this user?")) return;

    try {
      const res = await fetch(`/api/users/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to remove user.");
      }
      await refreshUsers();
    } catch (err) {
      console.error(err);
      alert("Could not remove user.");
    }
  });
}

/* ---------- Batch measurements ---------- */

function initBatchMetaDefaults() {
  const yearInput = document.getElementById("batch-year");
  const monthSelect = document.getElementById("batch-month");

  // Default = previous month (required by design).
  // If today is January, default becomes December of the previous year.
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth() + 1; // 1–12

  m -= 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }

  if (yearInput) {
    yearInput.value = String(y);
  }

  if (monthSelect) {
    monthSelect.value = String(m);
  }
}

function renderBatchRows(points) {
  const container = document.getElementById("batch-points-list");
  if (!container) return;

  container.innerHTML = "";

  const source = Array.isArray(points) ? points : (Array.isArray(allPoints) ? allPoints : []);

  const activePoints = source.filter((p) => p && p.active !== false);

  if (!activePoints.length) {
    container.innerHTML = "<p>No active measurement points.</p>";
    return;
  }

  // Sort active points by name for a stable order
  const sorted = activePoints.slice().sort((a, b) => {
    const aName = (a.location || a.description || a.name || a.stationName || "").toLowerCase();
    const bName = (b.location || b.description || b.name || b.stationName || "").toLowerCase();
    return aName.localeCompare(bName);
  });

  sorted.forEach((p, index) => {
    const row = document.createElement("div");
    row.className = "batch-row";

    const name =
      p.location ||
      p.description ||
      p.name ||
      p.stationName ||
      `Point ${index + 1}`;

    const id = (p._id && (p._id.$oid || p._id)) || "";

    row.dataset.pointId = id;

    row.innerHTML = `
      <div class="batch-row-name">${name}</div>
      <div class="batch-row-inputs">
        <label>
          <span>Value (µg/m³)</span>
          <input
            type="text"
            class="batch-value-input"
            inputmode="decimal"
            placeholder="e.g. 25,5"
          />
        </label>
        <label class="batch-no-measurement">
          <input type="checkbox" class="batch-no-measurement-checkbox" />
          <span>No measurement possible</span>
        </label>
      </div>
    `;

    const valueInput = row.querySelector(".batch-value-input");
    const noCheckbox = row.querySelector(".batch-no-measurement-checkbox");

    noCheckbox.addEventListener("change", () => {
      valueInput.disabled = noCheckbox.checked;
      if (noCheckbox.checked) {
        valueInput.value = "";
      }
    });

    container.appendChild(row);
  });
}

function setupBatchForm(points) {
  const form = document.getElementById("batch-form");
  const statusEl = document.getElementById("batch-status");
  if (!form) return;

  const yearInput = document.getElementById("batch-year");
  const monthSelect = document.getElementById("batch-month");

  renderBatchRows(points);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (statusEl) statusEl.textContent = "";

    const year = yearInput ? Number(String(yearInput.value || "").trim()) : NaN;
    const month = monthSelect ? Number(String(monthSelect.value || "").trim()) : NaN;

    
  if (!Number.isFinite(year) || year < 2000 || year > 2100 || !Number.isFinite(month) || month < 1 || month > 12) {
    if (statusEl) statusEl.textContent = "Please select a valid year and month.";
    return;
  }

    const entries = [];
    const rows = document.querySelectorAll("#batch-points-list .batch-row");
    let hasRowError = false;

    rows.forEach((row) => {
      const pointId = row.dataset.pointId;
      if (!pointId) return;

      const valueInput = row.querySelector(".batch-value-input");
      const noCheckbox = row.querySelector(".batch-no-measurement-checkbox");

      const rawValue = (valueInput.value || "").trim();
      const noMeasurement = !!noCheckbox.checked;

      // reset eventuele oude error-styling
      row.classList.remove("batch-row-error");

      // Regel: bij elk meetpunt óf een waarde, óf "no measurement"
      if (!rawValue && !noMeasurement) {
        hasRowError = true;
        row.classList.add("batch-row-error");
        return;
      }

      // Regel: niet allebei tegelijk
      if (rawValue && noMeasurement) {
        hasRowError = true;
        row.classList.add("batch-row-error");
        return;
      }

      let numericValue = null;
      if (!noMeasurement && rawValue) {
        numericValue = normalizeValue(rawValue);

        // Invalid or out-of-range value → markeer rij als error
        if (
          numericValue === null ||
          numericValue < MEASUREMENT_MIN ||
          numericValue > MEASUREMENT_MAX
        ) {
          hasRowError = true;
          row.classList.add("batch-row-error");
          return;
        }
      }

      entries.push({
        pointId,
        value: numericValue,
        noMeasurement,
      });
    });

    if (hasRowError) {
      if (statusEl) {
        statusEl.textContent =
          `Vul bij elk meetpunt een waarde in (${MEASUREMENT_MIN}–${MEASUREMENT_MAX} µg/m³) of vink 'No measurement possible' aan.`;
      }
      return;
    }

    if (!entries.length) {
      if (statusEl) statusEl.textContent = "No measurements to save.";
      return;
    }

    if (statusEl) statusEl.textContent = "Saving measurements...";

    try {
      const res = await fetch("/api/measurements/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ year, month, entries }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save measurements.");
      }

      if (statusEl) statusEl.textContent = "Measurements saved.";
    } catch (err) {
      console.error(err);
      if (statusEl) statusEl.textContent = "Error while saving measurements.";
    }
  });
}

function setupAddPointButton() {
  const btn = document.getElementById("add-point-btn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const description = prompt("Name / description of the new point:");
    if (!description) return;

    const latStr = prompt("Latitude (e.g. 6.695):");
    if (latStr === null) return;

    const lonStr = prompt("Longitude (e.g. -1.6163):");
    if (lonStr === null) return;

    const startDate = prompt("Start date (YYYY-MM-DD):");
    if (!startDate) return;

    const firstValueStr = prompt(
      `First measurement value (${MEASUREMENT_MIN}–${MEASUREMENT_MAX} µg/m³) (optional, leave empty for none):`
    );

    const payload = {
      description: description.trim(),
      lat: String(latStr).trim(),
      lon: String(lonStr).trim(),
      startDate: String(startDate).trim(),
    };

    if (firstValueStr && String(firstValueStr).trim() !== "") {
      payload.firstValue = String(firstValueStr).trim();
    }

    try {
      const res = await fetch("/api/points", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      let data = null;
      try {
        data = await res.json();
      } catch (e) {
        data = null;
      }

      if (!res.ok || (data && data.error)) {
        throw new Error((data && data.error) || "Failed to create measurement point.");
      }

      const newPoint = (data && (data.point || data)) || null;
      if (newPoint) {
        if (!Array.isArray(allPoints)) {
          allPoints = [];
        }
        allPoints.push(newPoint);
        renderStats(allPoints);
        renderPointsTable(allPoints);
        renderBatchRows(allPoints);
      }
    } catch (err) {
      console.error(err);
      alert("Could not create measurement point.");
    }
  });
}

/* ---------- Init ---------- */

document.addEventListener("DOMContentLoaded", async () => {
  const points = await fetchPoints();
  allPoints = Array.isArray(points) ? points : [];

  renderStats(allPoints);
  renderPointsTable(allPoints);
  setupSearch();

  setupUsersSection();
  initBatchMetaDefaults();
  setupBatchForm(allPoints);
  setupAddPointButton();
});
