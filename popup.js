const jobLinkInput = document.getElementById("jobLink");
const dateAppliedInput = document.getElementById("dateApplied");
const saveBtn = document.getElementById("saveBtn");
const openSheetBtn = document.getElementById("openSheetBtn");
const statusEl = document.getElementById("status");
const settingsToggle = document.getElementById("settingsToggle");
const settingsPanel = document.getElementById("settingsPanel");
const sheetIdInput = document.getElementById("sheetId");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");

// Centralised display names — future renames edit these two lines only.
const APP_NAME = "RekodJa";
const APP_FULL_NAME = "RekodJa: Job Tracker";

let activeTabId = null;
let selectedSheetTab = "";
let sheetTabsLoaded = false;

// --------------------------------------------------
// INIT
// --------------------------------------------------

init();

async function init() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  const tab = tabs[0];

  if (tab) {
    activeTabId = tab.id;

    if (tab.url && tab.url.startsWith("http")) {
      jobLinkInput.value = tab.url;
    }
  }

  const stored = await chrome.storage.sync.get([
    "sheetId",
    "sheetTabName"
  ]);

  if (stored.sheetId) {
    sheetIdInput.value = stored.sheetId;
    selectedSheetTab = stored.sheetTabName || "";
  } else {
    settingsPanel.style.display = "block";
    setStatus(
      "Set your Google Sheet ID in Settings first.",
      "error"
    );
  }
}

// --------------------------------------------------
// SETTINGS
// --------------------------------------------------

settingsToggle.addEventListener("click", async () => {
  const isOpening =
    settingsPanel.style.display !== "block";

  settingsPanel.style.display =
    isOpening ? "block" : "none";

  if (
    isOpening &&
    sheetIdInput.value.trim() &&
    !sheetTabsLoaded
  ) {
    try {
      setStatus("Loading sheet tabs...", "");

      const token = await getAuthToken();
      await loadSheetTabs(
        token,
        sheetIdInput.value.trim()
      );

      setStatus("", "");
    } catch (err) {
      console.error(err);
      setStatus(
        "Couldn't load sheet tabs: " +
          (err.message || err),
        "error"
      );
    }
  }
});

saveSettingsBtn.addEventListener(
  "click",
  async () => {
    const id = sheetIdInput.value.trim();

    if (!id) {
      setStatus(
        "Enter a Sheet ID first.",
        "error"
      );
      return;
    }

    saveSettingsBtn.disabled = true;
    setStatus("Connecting to Google Sheet...", "");

    try {
      const token = await getAuthToken();

      // Load all available tabs
      await loadSheetTabs(token, id);

      const select =
        document.getElementById("sheetTabSelect");

      if (!select || !select.value) {
        throw new Error(
          "No sheet tabs were found in this spreadsheet."
        );
      }

      selectedSheetTab = select.value;

      await chrome.storage.sync.set({
        sheetId: id,
        sheetTabName: selectedSheetTab
      });

      try {
        await ensureHeaders(
          token,
          id,
          selectedSheetTab
        );
      } catch (headerErr) {
        console.warn(
          "Could not set headers:",
          headerErr
        );
      }

      try {
        await applyConditionalColors(
          token,
          id,
          selectedSheetTab
        );
      } catch (colorErr) {
        console.warn(
          "Could not apply status colours:",
          colorErr
        );
      }

      setStatus(
        "Sheet connected!",
        "success"
      );

      settingsPanel.style.display = "none";
    } catch (err) {
      console.error(err);

      setStatus(
        "Couldn't connect: " +
          (err.message || err),
        "error"
      );
    } finally {
      saveSettingsBtn.disabled = false;
    }
  }
);

// --------------------------------------------------
// SAVE JOB
// --------------------------------------------------

saveBtn.addEventListener(
  "click",
  handleSave
);

openSheetBtn.addEventListener(
  "click",
  async () => {
    const stored =
      await chrome.storage.sync.get(["sheetId"]);

    const sheetId = (
      sheetIdInput.value.trim() ||
      stored.sheetId ||
      ""
    ).trim();

    if (!sheetId) {
      setStatus(
        "Set your Google Sheet ID in Settings first.",
        "error"
      );

      settingsPanel.style.display = "block";
      return;
    }

    const url =
      "https://docs.google.com/spreadsheets/d/" +
      encodeURIComponent(sheetId) +
      "/edit";

    await chrome.tabs.create({ url });
  }
);

async function handleSave() {
  const link = jobLinkInput.value.trim();
  const dateText =
    dateAppliedInput.value.trim();

  if (!link || !link.startsWith("http")) {
    setStatus(
      "Enter a valid job link.",
      "error"
    );
    return;
  }

  const stored =
    await chrome.storage.sync.get([
      "sheetId",
      "sheetTabName"
    ]);

  const sheetId = stored.sheetId;

  if (!sheetId) {
    setStatus(
      "Set your Google Sheet ID in Settings first.",
      "error"
    );

    settingsPanel.style.display = "block";
    return;
  }

  let dateValue = "";

  if (dateText) {
    const parsed =
      parseRelativeDate(dateText);

    if (!parsed) {
      setStatus(
        'Couldn\'t understand "' +
          dateText +
          '". Try "3 days ago", "2 weeks ago", "1 month ago", "today", "yesterday", or a date like "8 Sep 2026".',
        "error"
      );

      return;
    }

    dateValue =
      formatDateISO(parsed);
  }

  saveBtn.disabled = true;
  setStatus("Saving...", "");

  try {
    const token =
      await getAuthToken();

    // Make sure we know which tab to use.
    let sheetTabName =
      selectedSheetTab ||
      stored.sheetTabName ||
      "";

    /*
      If the user hasn't selected a tab yet,
      automatically load the available tabs.
    */
    if (!sheetTabName) {
      sheetTabName =
        await loadSheetTabs(
          token,
          sheetId
        );
    }

    if (!sheetTabName) {
      throw new Error(
        "No sheet tab selected."
      );
    }

    // Save selected tab for future use.
    await chrome.storage.sync.set({
      sheetTabName: sheetTabName
    });

    await ensureHeaders(
      token,
      sheetId,
      sheetTabName
    );

    try {
      await applyConditionalColors(
        token,
        sheetId,
        sheetTabName
      );
    } catch (colorErr) {
      console.warn(
        "Could not apply status colours:",
        colorErr
      );
    }

    const details =
      await extractJobDetails(
        activeTabId,
        link
      );

    const row = [
      dateValue,
      details.company || "",
      details.role || "",
      link,
      "Applied",
      details.source || "",
      "",
      "",
      ""
    ];

    let appendResult;

    try {
      appendResult =
        await appendRow(
          token,
          sheetId,
          row,
          sheetTabName
        );
    } catch (err) {
      /*
        If the selected tab was deleted/renamed,
        refresh the tabs and retry once.
      */
      console.warn(
        "Append failed. Refreshing sheet tabs...",
        err
      );

      sheetTabsLoaded = false;

      sheetTabName =
        await loadSheetTabs(
          token,
          sheetId
        );

      await chrome.storage.sync.set({
        sheetTabName: sheetTabName
      });

      await ensureHeaders(
        token,
        sheetId,
        sheetTabName
      );

      try {
        await applyConditionalColors(
          token,
          sheetId,
          sheetTabName
        );
      } catch (colorErr) {
        console.warn(
          "Could not apply status colours:",
          colorErr
        );
      }

      appendResult =
        await appendRow(
          token,
          sheetId,
          row,
          sheetTabName
        );
    }

    const updatedRange =
      appendResult?.updates?.updatedRange || "";

    const updatedRow =
      extractRowNumber(updatedRange);

    if (updatedRow) {
      if (dateValue) {
        await writeDaysSinceFormula(
          token,
          sheetId,
          updatedRow,
          sheetTabName
        );
      }

      await fixCellFormats(
        token,
        sheetId,
        updatedRow,
        sheetTabName
      );
    }

    setStatus(
      "Saved to tracker!",
      "success"
    );

    dateAppliedInput.value = "";
  } catch (err) {
    console.error(err);

    setStatus(
      "Failed: " +
        (err.message || err),
      "error"
    );
  } finally {
    saveBtn.disabled = false;
  }
}

// --------------------------------------------------
// STATUS MESSAGE
// --------------------------------------------------

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = kind || "";
}

// --------------------------------------------------
// GOOGLE AUTH
// --------------------------------------------------

function getAuthToken() {
  return new Promise(
    (resolve, reject) => {
      chrome.identity.getAuthToken(
        {
          interactive: true
        },
        (token) => {
          if (
            chrome.runtime.lastError ||
            !token
          ) {
            reject(
              new Error(
                chrome.runtime.lastError
                  ? chrome.runtime.lastError.message
                  : "No token"
              )
            );

            return;
          }

          resolve(token);
        }
      );
    }
  );
}

// --------------------------------------------------
// GOOGLE SHEETS — TAB MANAGEMENT
// --------------------------------------------------

async function loadSheetTabs(
  token,
  spreadsheetId
) {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;

  const res = await fetch(url, {
    headers: {
      Authorization:
        "Bearer " + token
    }
  });

  if (!res.ok) {
    const text =
      await res.text();

    throw new Error(
      "Sheets API error fetching sheet tabs (" +
        res.status +
        "): " +
        text
    );
  }

  const data =
    await res.json();

  const sheets =
    (data.sheets || [])
      .map((sheet) => ({
        title:
          sheet.properties.title,
        sheetId:
          sheet.properties.sheetId
      }))
      .filter(
        (sheet) =>
          sheet.title
      );

  if (!sheets.length) {
    throw new Error(
      "This Google Sheet has no available tabs."
    );
  }

  createSheetTabSelector(
    sheets
  );

  const stored =
    await chrome.storage.sync.get([
      "sheetTabName"
    ]);

  let chosenTab = "";

  // First priority:
  // previously selected tab
  if (
    stored.sheetTabName &&
    sheets.some(
      (sheet) =>
        sheet.title ===
        stored.sheetTabName
    )
  ) {
    chosenTab =
      stored.sheetTabName;
  }

  // Second priority:
  // current selected tab
  if (
    !chosenTab &&
    selectedSheetTab &&
    sheets.some(
      (sheet) =>
        sheet.title ===
        selectedSheetTab
    )
  ) {
    chosenTab =
      selectedSheetTab;
  }

  // Third priority:
  // first tab in spreadsheet
  if (!chosenTab) {
    chosenTab =
      sheets[0].title;
  }

  selectedSheetTab =
    chosenTab;

  const select =
    document.getElementById(
      "sheetTabSelect"
    );

  if (select) {
    select.value =
      chosenTab;
  }

  await chrome.storage.sync.set({
    sheetTabName: chosenTab
  });

  sheetTabsLoaded = true;

  return chosenTab;
}

// --------------------------------------------------
// CREATE TAB DROPDOWN
// --------------------------------------------------

function createSheetTabSelector(
  sheets
) {
  let existing =
    document.getElementById(
      "sheetTabWrapper"
    );

  if (existing) {
    existing.remove();
  }

  const wrapper =
    document.createElement("div");

  wrapper.id =
    "sheetTabWrapper";

  wrapper.style.marginTop =
    "10px";

  const label =
    document.createElement("label");

  label.textContent =
    "Sheet tab";

  label.style.display =
    "block";

  label.style.marginBottom =
    "5px";

  label.style.fontWeight =
    "500";

  const select =
    document.createElement("select");

  select.id =
    "sheetTabSelect";

  select.style.width =
    "100%";

  select.style.padding =
    "8px";

  select.style.boxSizing =
    "border-box";

  sheets.forEach(
    (sheet) => {
      const option =
        document.createElement(
          "option"
        );

      option.value =
        sheet.title;

      option.textContent =
        sheet.title;

      select.appendChild(
        option
      );
    }
  );

  select.addEventListener(
    "change",
    async () => {
      selectedSheetTab =
        select.value;

      await chrome.storage.sync.set({
        sheetTabName:
          selectedSheetTab
      });

      setStatus(
        'Using tab "' +
          selectedSheetTab +
          '".',
        "success"
      );
    }
  );

  wrapper.appendChild(label);
  wrapper.appendChild(select);

  /*
    Put the dropdown underneath
    the Sheet ID field.
  */
  if (
    sheetIdInput &&
    sheetIdInput.parentElement
  ) {
    sheetIdInput.parentElement.appendChild(
      wrapper
    );
  } else {
    settingsPanel.appendChild(
      wrapper
    );
  }
}

// --------------------------------------------------
// GOOGLE SHEETS — APPEND
// --------------------------------------------------

async function appendRow(
  token,
  sheetId,
  row,
  sheetTabName
) {
  const safeTabName =
    quoteSheetTabName(
      sheetTabName
    );

  const range =
    encodeURIComponent(
      safeTabName + "!A:I"
    );

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res =
    await fetch(url, {
      method: "POST",

      headers: {
        Authorization:
          "Bearer " + token,

        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        values: [row]
      })
    });

  if (!res.ok) {
    const text =
      await res.text();

    throw new Error(
      "Sheets API error (" +
        res.status +
        "): " +
        text
    );
  }

  return res.json();
}

// --------------------------------------------------
// GOOGLE SHEETS — HEADERS
// --------------------------------------------------

const HEADER_ROW = [
  "Date Applied",
  "Company",
  "Role",
  "Job Link",
  "Status",
  "Source",
  "Days Since Applied",
  "Notes",
  "Email Sender"
];

/*
  Makes sure row 1 has the standard header
  columns. Only fills blank cells — it never
  overwrites what the user already has there.
*/
async function ensureHeaders(
  token,
  sheetId,
  sheetTabName
) {
  const safeTabName =
    quoteSheetTabName(
      sheetTabName
    );

  const range =
    encodeURIComponent(
      safeTabName + "!A1:I1"
    );

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;

  const res =
    await fetch(url, {
      headers: {
        Authorization:
          "Bearer " + token
      }
    });

  if (!res.ok) {
    const text =
      await res.text();

    throw new Error(
      "Sheets API error reading headers (" +
        res.status +
        "): " +
        text
    );
  }

  const data =
    await res.json();

  const existing =
    (data.values &&
      data.values[0]) ||
    [];

  const current =
    existing.map(
      (cell) =>
        String(cell ?? "").trim()
    );

  // Already exactly right — nothing to do.
  if (
    HEADER_ROW.every(
      (header, i) =>
        current[i] &&
        current[i].toLowerCase() ===
          header.toLowerCase()
    )
  ) {
    return;
  }

  /*
    If row 1 is not empty but none of our
    headers are there, it's the user's own
    layout — leave it alone.
  */
  const allBlank =
    current.every(
      (cell) => !cell
    );

  const hasAnyHeader =
    HEADER_ROW.some(
      (header, i) =>
        current[i] &&
        current[i].toLowerCase() ===
          header.toLowerCase()
    );

  if (!allBlank && !hasAnyHeader) {
    return;
  }

  /*
    Fill only blank cells with the
    expected header for that column.
  */
  const updated =
    HEADER_ROW.map(
      (header, i) =>
        current[i] || header
    );

  const putUrl =
    url + "?valueInputOption=RAW";

  const putRes =
    await fetch(putUrl, {
      method: "PUT",

      headers: {
        Authorization:
          "Bearer " + token,

        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        values: [updated]
      })
    });

  if (!putRes.ok) {
    const text =
      await putRes.text();

    throw new Error(
      "Sheets API error writing headers (" +
        putRes.status +
        "): " +
        text
    );
  }
}

// --------------------------------------------------
// GOOGLE SHEETS — STATUS/SOURCE COLOURS
// --------------------------------------------------

const STATUS_COLORS = [
  ["Applied", "#ffe5a0"],
  ["Interview", "#bfe1f6"],
  ["Offer", "#d4edbc"],
  ["Rejected", "#b10202"],
  ["Ghosted", "#473822"],
  ["Withdrawn", "#ffcfc9"],
  ["Replied", "#e8eaed"]
];

const SOURCE_COLORS = [
  ["LinkedIn", "#0a53a8"],
  ["Company Website", "#5a3286"],
  ["Referral", "#3d3d3d"],
  ["JobStreet", "#ff14d6"],
  ["Indeed", "#bfe1f6"]
];

function hexToRgb(hex) {
  const value =
    parseInt(
      hex.replace("#", ""),
      16
    );

  return {
    red: ((value >> 16) & 255) / 255,
    green: ((value >> 8) & 255) / 255,
    blue: (value & 255) / 255
  };
}

function isDarkHex(hex) {
  const { red, green, blue } =
    hexToRgb(hex);

  const lin = (c) =>
    c <= 0.03928
      ? c / 12.92
      : Math.pow(
          (c + 0.055) / 1.055,
          2.4
        );

  return (
    0.2126 * lin(red) +
      0.7152 * lin(green) +
      0.0722 * lin(blue) <
    0.45
  );
}

function buildColorRule(
  gid,
  columnIndex,
  label,
  hex
) {
  const format = {
    backgroundColor:
      hexToRgb(hex)
  };

  // White text on dark colours so it stays readable.
  if (isDarkHex(hex)) {
    format.textFormat = {
      foregroundColor: {
        red: 1,
        green: 1,
        blue: 1
      }
    };
  }

  return {
    ranges: [
      {
        sheetId: gid,
        startColumnIndex:
          columnIndex,
        endColumnIndex:
          columnIndex + 1
      }
    ],

    booleanRule: {
      condition: {
        type: "TEXT_EQ",

        values: [
          {
            userEnteredValue:
              label
          }
        ]
      },

      format
    }
  };
}

/*
  Adds conditional colour rules for the
  Status (E) and Source (F) columns.
  Old rules on those columns are replaced
  so colours never stack up.
*/
const conditionalColorsApplied =
  new Set();

async function applyConditionalColors(
  token,
  sheetId,
  sheetTabName
) {
  const cacheKey =
    sheetId + "::" + sheetTabName;

  if (
    conditionalColorsApplied.has(
      cacheKey
    )
  ) {
    return;
  }

  const gid =
    await getSheetGid(
      token,
      sheetId,
      sheetTabName
    );

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets(properties(sheetId),conditionalFormats)`;

  const res =
    await fetch(url, {
      headers: {
        Authorization:
          "Bearer " + token
      }
    });

  if (!res.ok) {
    const text =
      await res.text();

    throw new Error(
      "Sheets API error reading formats (" +
        res.status +
        "): " +
        text
    );
  }

  const data =
    await res.json();

  const sheet =
    (data.sheets || []).find(
      (s) =>
        s.properties.sheetId ===
        gid
    );

  const existing =
    (sheet &&
      sheet.conditionalFormats) ||
    [];

  const requests = [];

  /*
    Delete our old E/F colour rules first,
    from the last index down so earlier
    deletions don't shift later ones.
  */
  const staleIndexes =
    existing
      .map((rule, index) => ({
        rule,
        index
      }))
      .filter(
        ({ rule }) =>
          rule.booleanRule &&
          (rule.ranges || []).some(
            (range) =>
              range.sheetId === gid &&
              range.startColumnIndex >= 4 &&
              range.endColumnIndex <= 6
          )
      )
      .map(({ index }) => index)
      .sort((a, b) => b - a);

  for (
    const index of staleIndexes
  ) {
    requests.push({
      deleteConditionalFormatRule: {
        sheetId: gid,
        index
      }
    });
  }

  const rules = [];

  STATUS_COLORS.forEach(
    ([label, hex]) =>
      rules.push(
        buildColorRule(
          gid,
          4,
          label,
          hex
        )
      )
  );

  SOURCE_COLORS.forEach(
    ([label, hex]) =>
      rules.push(
        buildColorRule(
          gid,
          5,
          label,
          hex
        )
      )
  );

  // All at index 0 so every insert stays valid.
  rules.forEach((rule) => {
    requests.push({
      addConditionalFormatRule: {
        index: 0,
        rule
      }
    });
  });

  const batchUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`;

  const batchRes =
    await fetch(batchUrl, {
      method: "POST",

      headers: {
        Authorization:
          "Bearer " + token,

        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        requests
      })
    });

  if (!batchRes.ok) {
    const text =
      await batchRes.text();

    throw new Error(
      "Sheets API error writing colours (" +
        batchRes.status +
        "): " +
        text
    );
  }

  conditionalColorsApplied.add(
    cacheKey
  );
}

// --------------------------------------------------
// GOOGLE SHEETS — DAYS SINCE FORMULA
// --------------------------------------------------

async function writeDaysSinceFormula(
  token,
  sheetId,
  row,
  sheetTabName
) {
  const safeTabName =
    quoteSheetTabName(
      sheetTabName
    );

  const range =
    encodeURIComponent(
      safeTabName +
        "!G" +
        row
    );

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=USER_ENTERED`;

  /*
    Tolerate text dates too. Real dates are numbers, so the simple
    subtraction works. If the cell holds text like "18-09-2026" or
    "2026-09-18" (typed manually), parse it by hand so the formula
    never shows #VALUE!. Anything unreadable stays blank.
  */
  const formula =
    '=IF(A' + row + '="","",' +
    'IF(ISNUMBER(A' + row + '),TODAY()-A' + row + ',' +
    'IF(MID(A' + row + ',3,1)="-",TODAY()-DATE(RIGHT(A' + row + ',4),MID(A' + row + ',4,2),LEFT(A' + row + ',2)),' +
    'IF(MID(A' + row + ',5,1)="-",TODAY()-DATE(LEFT(A' + row + ',4),MID(A' + row + ',6,2),MID(A' + row + ',9,2)),' +
    'IFERROR(TODAY()-DATEVALUE(A' + row + '),""))))' +
    ')';

  const res =
    await fetch(url, {
      method: "PUT",

      headers: {
        Authorization:
          "Bearer " + token,

        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        values: [[formula]]
      })
    });

  if (!res.ok) {
    const text =
      await res.text();

    throw new Error(
      "Sheets API error writing formula (" +
        res.status +
        "): " +
        text
    );
  }
}

// --------------------------------------------------
// EXTRACT ROW NUMBER
// --------------------------------------------------

function extractRowNumber(
  updatedRange
) {
  /*
    Example:
    'My Applications!A17:F17'
    or
    "'My Applications'!A17:F17"
  */

  const match =
    updatedRange.match(
      /![A-Z]+(\d+):/
    );

  return match
    ? parseInt(
        match[1],
        10
      )
    : null;
}

// --------------------------------------------------
// SHEET TAB NAME HELPERS
// --------------------------------------------------

function quoteSheetTabName(
  name
) {
  /*
    Google Sheets A1 notation:
    'My Sheet'!A:F

    If the tab contains an apostrophe,
    it must be doubled:

    Bob's Jobs
    becomes
    'Bob''s Jobs'
  */

  const escaped =
    String(name)
      .replace(/'/g, "''");

  return "'" +
    escaped +
    "'";
}

// --------------------------------------------------
// SHEET GID CACHE
// --------------------------------------------------

const sheetGidCache = {};

async function getSheetGid(
  token,
  spreadsheetId,
  sheetTabName
) {
  const cacheKey =
    spreadsheetId +
    "::" +
    sheetTabName;

  if (
    sheetGidCache[
      cacheKey
    ]
  ) {
    return sheetGidCache[
      cacheKey
    ];
  }

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;

  const res =
    await fetch(url, {
      headers: {
        Authorization:
          "Bearer " + token
      }
    });

  if (!res.ok) {
    const text =
      await res.text();

    throw new Error(
      "Sheets API error fetching sheet metadata (" +
        res.status +
        "): " +
        text
    );
  }

  const data =
    await res.json();

  const sheet =
    (data.sheets || [])
      .find(
        (s) =>
          s.properties.title ===
          sheetTabName
      );

  if (!sheet) {
    throw new Error(
      'Tab "' +
        sheetTabName +
        '" not found in this spreadsheet.'
    );
  }

  sheetGidCache[
    cacheKey
  ] =
    sheet.properties.sheetId;

  return sheet.properties.sheetId;
}

// --------------------------------------------------
// FORMATTING + DROPDOWNS
// --------------------------------------------------

async function fixCellFormats(
  token,
  sheetId,
  row,
  sheetTabName
) {
  let gid;

  try {
    gid =
      await getSheetGid(
        token,
        sheetId,
        sheetTabName
      );
  } catch (err) {
    console.error(
      "Could not get sheet GID:",
      err
    );

    return;
  }

  const requests = [

    // ----------------------------------------------
    // Date Applied (A)
    // ----------------------------------------------

    {
      repeatCell: {
        range: {
          sheetId: gid,

          startRowIndex:
            row - 1,

          endRowIndex:
            row,

          startColumnIndex:
            0,

          endColumnIndex:
            1
        },

        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: "DATE",
              pattern:
                "yyyy-mm-dd"
            }
          }
        },

        fields:
          "userEnteredFormat.numberFormat"
      }
    },

    // ----------------------------------------------
    // Days Since Applied (G)
    // ----------------------------------------------

    {
      repeatCell: {
        range: {
          sheetId: gid,

          startRowIndex:
            row - 1,

          endRowIndex:
            row,

          startColumnIndex:
            6,

          endColumnIndex:
            7
        },

        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: "NUMBER",
              pattern: "0"
            }
          }
        },

        fields:
          "userEnteredFormat.numberFormat"
      }
    },

    // ----------------------------------------------
    // Reset row formatting
    // ----------------------------------------------

    {
      repeatCell: {
        range: {
          sheetId: gid,

          startRowIndex:
            row - 1,

          endRowIndex:
            row,

          startColumnIndex:
            0,

          endColumnIndex:
            8
        },

        cell: {
          userEnteredFormat: {
            backgroundColor: {
              red: 1,
              green: 1,
              blue: 1
            },

            textFormat: {
              bold: false,

              foregroundColor: {
                red: 0,
                green: 0,
                blue: 0
              }
            }
          }
        },

        fields:
          "userEnteredFormat.backgroundColor,userEnteredFormat.textFormat"
      }
    },

    // ----------------------------------------------
    // Status dropdown (E)
    // ----------------------------------------------

    {
      setDataValidation: {
        range: {
          sheetId: gid,

          startRowIndex:
            row - 1,

          endRowIndex:
            row,

          startColumnIndex:
            4,

          endColumnIndex:
            5
        },

        rule: {
          condition: {
            type:
              "ONE_OF_LIST",

            values: [
              "Applied",
              "Interview",
              "Offer",
              "Rejected",
              "Ghosted",
              "Withdrawn",
              "Replied"
            ].map(
              (v) => ({
                userEnteredValue:
                  v
              })
            )
          },

          showCustomUi:
            true,

          strict:
            true
        }
      }
    },

    // ----------------------------------------------
    // Source dropdown (F)
    // ----------------------------------------------

    {
      setDataValidation: {
        range: {
          sheetId: gid,

          startRowIndex:
            row - 1,

          endRowIndex:
            row,

          startColumnIndex:
            5,

          endColumnIndex:
            6
        },

        rule: {
          condition: {
            type:
              "ONE_OF_LIST",

            values: [
              "LinkedIn",
              "Company Website",
              "Referral",
              "JobStreet",
              "Indeed",
              "Glints",
              "Recruiter",
              "Other"
            ].map(
              (v) => ({
                userEnteredValue:
                  v
              })
            )
          },

          showCustomUi:
            true,

          strict:
            true
        }
      }
    }
  ];

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`;

  const res =
    await fetch(url, {
      method: "POST",

      headers: {
        Authorization:
          "Bearer " + token,

        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        requests
      })
    });

  if (!res.ok) {
    const text =
      await res.text();

    /*
      Row is already saved.
      Formatting failure should not
      make the whole save look like
      it failed.
    */

    console.error(
      "Sheets API error fixing formats (" +
        res.status +
        "): " +
        text
    );
  }
}

// --------------------------------------------------
// PAGE EXTRACTION
// --------------------------------------------------

async function extractJobDetails(
  tabId,
  link
) {
  const source =
    detectSource(link);

  if (!tabId) {
    return {
      company: "",
      role: "",
      source
    };
  }

  try {
    const [
      { result }
    ] =
      await chrome.scripting.executeScript(
        {
          target: {
            tabId
          },

          func:
            extractFromPage
        }
      );

    return {
      company:
        result.company,

      role:
        result.role,

      source
    };
  } catch (err) {
    /*
      Page isn't scriptable
      (chrome://, restricted page,
      permission issue, etc.)

      Not fatal.
    */

    return {
      company: "",
      role: "",
      source
    };
  }
}

// --------------------------------------------------
// EXTRACT JOB DETAILS FROM PAGE
// --------------------------------------------------

function extractFromPage() {
  function decodeEntities(
    str
  ) {
    const el =
      document.createElement(
        "textarea"
      );

    el.innerHTML =
      str;

    return el.value;
  }

  let company = "";
  let role = "";

  const rawTitle =
    document.title || "";

  // ------------------------------------------------
  // JOBSTREET
  // ------------------------------------------------

  if (
    window.location.hostname.indexOf(
      "jobstreet"
    ) !== -1
  ) {
    const titleEl =
      document.querySelector(
        '[data-automation="job-detail-title"]'
      );

    const companyEl =
      document.querySelector(
        '[data-automation="advertiser-name"]'
      );

    if (
      titleEl &&
      titleEl.textContent.trim()
    ) {
      role =
        titleEl.textContent.trim();
    }

    if (
      companyEl &&
      companyEl.textContent.trim()
    ) {
      company =
        companyEl.textContent.trim();
    }
  }

  // ------------------------------------------------
  // LINKEDIN
  // ------------------------------------------------

  if (
    window.location.hostname.indexOf(
      "linkedin.com"
    ) !== -1
  ) {
    const companyLinkEl =
      document.querySelector(
        'a[href*="/company/"]'
      );

    if (
      companyLinkEl &&
      companyLinkEl.textContent.trim()
    ) {
      company =
        companyLinkEl.textContent.trim();
    }

    if (
      company &&
      rawTitle
    ) {
      const escapedCompany =
        company.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );

      const anchoredMatch =
        rawTitle.match(
          new RegExp(
            "^" +
              escapedCompany +
              "\\s+hiring\\s+(.*?)\\s+in\\s+.+$",
            "i"
          )
        );

      if (anchoredMatch) {
        role =
          anchoredMatch[1].trim();
      }
    }
  }

  // ------------------------------------------------
  // JSON-LD
  // ------------------------------------------------

  if (
    !company ||
    !role
  ) {
    const scripts =
      document.querySelectorAll(
        'script[type="application/ld+json"]'
      );

    for (
      const s of scripts
    ) {
      try {
        const data =
          JSON.parse(
            s.textContent
          );

        const postings =
          Array.isArray(data)
            ? data
            : [data];

        for (
          const item of postings
        ) {
          if (
            item["@type"] ===
            "JobPosting"
          ) {
            if (
              !company &&
              item.hiringOrganization &&
              item.hiringOrganization.name
            ) {
              company =
                item
                  .hiringOrganization
                  .name;
            }

            if (
              !role &&
              item.title
            ) {
              role =
                item.title;
            }
          }
        }
      } catch (e) {
        // Invalid JSON.
      }
    }
  }

  // ------------------------------------------------
  // LINKEDIN TITLE FALLBACK
  // ------------------------------------------------

  if (
    !company ||
    !role
  ) {
    const linkedInMatch =
      rawTitle.match(
        /^(.*?)\s+hiring\s+(.*?)\s+in\s+.+$/i
      );

    if (linkedInMatch) {
      if (!company) {
        company =
          linkedInMatch[1].trim();
      }

      if (!role) {
        role =
          linkedInMatch[2].trim();
      }
    }
  }

  // ------------------------------------------------
  // "ROLE AT COMPANY"
  // ------------------------------------------------

  if (
    !company ||
    !role
  ) {
    const atMatch =
      rawTitle.match(
        /^(.*?)\s+(?:at|@)\s+(.*)$/i
      );

    if (atMatch) {
      if (!role) {
        role =
          atMatch[1].trim();
      }

      if (!company) {
        company =
          atMatch[2].trim();
      }
    }
  }

  // ------------------------------------------------
  // OG META
  // ------------------------------------------------

  if (
    !role ||
    !company
  ) {
    const ogTitleEl =
      document.querySelector(
        'meta[property="og:title"]'
      );

    const ogSiteEl =
      document.querySelector(
        'meta[property="og:site_name"]'
      );

    if (
      !role &&
      ogTitleEl
    ) {
      role =
        decodeEntities(
          ogTitleEl.content
        );
    }

    if (
      !company &&
      ogSiteEl
    ) {
      company =
        decodeEntities(
          ogSiteEl.content
        );
    }
  }

  // ------------------------------------------------
  // GENERIC TITLE FALLBACK
  // ------------------------------------------------

  if (
    !role &&
    rawTitle
  ) {
    const parts =
      rawTitle.split(
        /\s[-|–—]\s/
      );

    role =
      parts[0].trim();

    if (
      !company &&
      parts.length > 1
    ) {
      const candidate =
        parts[1].trim();

      if (
        !/^(linkedin( jobs)?|indeed|jobstreet|glints)$/i.test(
          candidate
        )
      ) {
        company =
          candidate;
      }
    }
  }

  return {
    company:
      decodeEntities(
        company || ""
      ),

    role:
      decodeEntities(
        role || ""
      )
  };
}

// --------------------------------------------------
// SOURCE DETECTION
// --------------------------------------------------

function detectSource(
  url
) {
  const host =
    url.toLowerCase();

  if (
    host.indexOf(
      "linkedin.com"
    ) !== -1
  ) {
    return "LinkedIn";
  }

  if (
    host.indexOf(
      "indeed.com"
    ) !== -1
  ) {
    return "Indeed";
  }

  if (
    host.indexOf(
      "jobstreet"
    ) !== -1
  ) {
    return "JobStreet";
  }

  if (
    host.indexOf(
      "glints.com"
    ) !== -1
  ) {
    return "Glints";
  }

  if (
    host.indexOf(
      "myworkdayjobs.com"
    ) !== -1 ||
    host.indexOf(
      "greenhouse.io"
    ) !== -1 ||
    host.indexOf(
      "lever.co"
    ) !== -1 ||
    host.indexOf(
      "smartrecruiters.com"
    ) !== -1
  ) {
    return "Company Website";
  }

  return "Other";
}

// --------------------------------------------------
// DATE PARSING
// --------------------------------------------------

function parseRelativeDate(
  text
) {
  const trimmed =
    String(text)
      .trim()
      .toLowerCase();

  if (!trimmed) {
    return null;
  }

  if (
    trimmed === "today"
  ) {
    return dateOnly(
      new Date()
    );
  }

  if (
    trimmed === "yesterday"
  ) {
    return dateOnly(
      addDays(
        new Date(),
        -1
      )
    );
  }

  const relativeMatch =
    trimmed.match(
      /^(\d+)\s*(day|days|week|weeks|month|months)\s+ago$/
    );

  if (relativeMatch) {
    const amount =
      Number(
        relativeMatch[1]
      );

    const unit =
      relativeMatch[2];

    const now =
      new Date();

    if (
      unit.startsWith(
        "day"
      )
    ) {
      return dateOnly(
        addDays(
          now,
          -amount
        )
      );
    }

    if (
      unit.startsWith(
        "week"
      )
    ) {
      return dateOnly(
        addDays(
          now,
          -amount * 7
        )
      );
    }

    if (
      unit.startsWith(
        "month"
      )
    ) {
      return dateOnly(
        new Date(
          now.getFullYear(),
          now.getMonth() -
            amount,
          now.getDate()
        )
      );
    }
  }

  const months = {
    january: 0,
    jan: 0,

    february: 1,
    feb: 1,

    march: 2,
    mar: 2,

    april: 3,
    apr: 3,

    may: 4,

    june: 5,
    jun: 5,

    july: 6,
    jul: 6,

    august: 7,
    aug: 7,

    september: 8,
    sep: 8,
    sept: 8,

    october: 9,
    oct: 9,

    november: 10,
    nov: 10,

    december: 11,
    dec: 11
  };

  // ----------------------------------------------
  // 8 sep 2026
  // 8 September 2026
  // ----------------------------------------------

  let match =
    trimmed.match(
      /^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/
    );

  if (
    match &&
    months[
      match[2]
    ] !== undefined
  ) {
    return createValidDate(
      Number(
        match[3]
      ),

      months[
        match[2]
      ],

      Number(
        match[1]
      )
    );
  }

  // ----------------------------------------------
  // 8/09/2026
  // 8-09-2026
  // 8.09.2026
  // ----------------------------------------------

  match =
    trimmed.match(
      /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/
    );

  if (match) {
    return createValidDate(
      Number(
        match[3]
      ),

      Number(
        match[2]
      ) - 1,

      Number(
        match[1]
      )
    );
  }

  // ----------------------------------------------
  // 2026-09-08
  // ----------------------------------------------

  match =
    trimmed.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/
    );

  if (match) {
    return createValidDate(
      Number(
        match[1]
      ),

      Number(
        match[2]
      ) - 1,

      Number(
        match[3]
      )
    );
  }

  return null;
}

// --------------------------------------------------
// VALID DATE
// --------------------------------------------------

function createValidDate(
  year,
  month,
  day
) {
  const date =
    new Date(
      year,
      month,
      day
    );

  if (
    date.getFullYear() !==
      year ||
    date.getMonth() !==
      month ||
    date.getDate() !==
      day
  ) {
    return null;
  }

  return dateOnly(
    date
  );
}

// --------------------------------------------------
// DATE ONLY
// --------------------------------------------------

function dateOnly(
  date
) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
}

// --------------------------------------------------
// ADD DAYS
// --------------------------------------------------

function addDays(
  date,
  days
) {
  const result =
    new Date(date);

  result.setDate(
    result.getDate() +
      days
  );

  return result;
}

// --------------------------------------------------
// FORMAT DATE
// --------------------------------------------------

function formatDateISO(
  date
) {
  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      date.getDate()
    ).padStart(2, "0");

  return (
    year +
    "-" +
    month +
    "-" +
    day
  );
}