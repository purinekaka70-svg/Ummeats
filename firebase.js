import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-functions.js";
import { firebaseConfig } from "./config.js";

const firebaseApp = initializeApp(firebaseConfig);

export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const functions = getFunctions(firebaseApp);
