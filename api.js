const DEFAULT_BASE_URL = localStorage.getItem("apiBase") || "http://127.0.0.1:5000";

async function request(endpoint, { method = "GET", body, headers } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${DEFAULT_BASE_URL}${endpoint}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers
      },
      body,
      signal: controller.signal
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Błąd serwera (${response.status}): ${text}`);
    }
    const data = await response.json();
    if (data.status && data.status !== "ok") {
      throw new Error(data.error || "Nieznany błąd API");
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWorkbook() {
  return request("/get_xlsx");
}

async function updateWorkbook(records, sheetName) {
  return request("/update_xlsx", {
    method: "POST",
    body: JSON.stringify({ records, sheetName })
  });
}

export { DEFAULT_BASE_URL, fetchWorkbook, updateWorkbook };