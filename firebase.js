import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-database.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-storage.js";
import { firebaseConfig } from "./config.js";

const firebaseApp = initializeApp(firebaseConfig);
const fallbackDatabaseUrl = firebaseConfig.projectId
  ? `https://${firebaseConfig.projectId}-default-rtdb.firebaseio.com`
  : "";
const realtimeDatabaseUrl = String(firebaseConfig.databaseURL || fallbackDatabaseUrl).trim();

export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);
export const rtdb = getDatabase(firebaseApp, realtimeDatabaseUrl || undefined);
