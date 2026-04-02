import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

const firebaseApp = initializeApp(firebaseConfig);

export const db = getFirestore(firebaseApp);
