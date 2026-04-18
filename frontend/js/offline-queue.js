const DB_NAME = "fmn-offline";
const DB_VERSION = 1;
const STORE = "pending";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      if (!e.target.result.objectStoreNames.contains(STORE)) {
        e.target.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function notifyChange() {
  window.dispatchEvent(new CustomEvent("fmn:queue-changed"));
}

export async function enqueueAction({ url, method, body, description }) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      url,
      method,
      body: body !== undefined ? JSON.stringify(body) : null,
      description,
    });
    tx.oncomplete = res;
    tx.onerror = (e) => rej(e.target.error);
  });
  notifyChange();
}

async function removeAction(id) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = res;
    tx.onerror = (e) => rej(e.target.error);
  });
}

export async function getPending() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () =>
      res((req.result || []).sort((a, b) => a.timestamp - b.timestamp));
    req.onerror = (e) => rej(e.target.error);
  });
}

export async function pendingCount() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => res(req.result);
    req.onerror = (e) => rej(e.target.error);
  });
}

// Envía todas las acciones pendientes en orden. Detiene al primer error.
// Retorna cuántas se enviaron.
export async function flushQueue(apiRequestFn) {
  const actions = await getPending();
  if (!actions.length) return 0;

  let sent = 0;
  for (const action of actions) {
    try {
      await apiRequestFn(action.url, {
        method: action.method,
        body: action.body ? JSON.parse(action.body) : undefined,
      });
      await removeAction(action.id);
      sent++;
    } catch {
      break; // preservar orden — parar al primer fallo
    }
  }

  if (sent > 0) notifyChange();
  return sent;
}
