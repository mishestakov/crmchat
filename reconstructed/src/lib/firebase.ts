import * as Sentry from "@sentry/react";
import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
  initializeAuth,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAP-8AiIZ5ZDvEx7KvTiEUuezSAhn0IpXM",
  authDomain: "hints-crm.web.app",
  databaseURL: "https://hints-crm-default-rtdb.firebaseio.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "hints-crm",
  storageBucket: "hints-crm.appspot.com",
  messagingSenderId: "689016021448",
  appId: "1:689016021448:web:d18f1ca26b5f9f910a60fd",
  measurementId: "G-5T0M4TYF03",
};

function isWebKit() {
  const ua = navigator.userAgent;
  // As far as I can tell, Chromium-based desktop browsers are the only browsers
  // that pretend to be WebKit-based but aren't.
  return (
    (/AppleWebKit/.test(ua) && !/Chrome/.test(ua)) ||
    /\b(iPad|iPhone|iPod)\b/.test(ua)
  );
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = initializeAuth(app, {
  // Remove indexedDB persistence to avoid issues in Safari
  // https://github.com/firebase/firebase-js-sdk/issues/8019
  persistence: [browserLocalPersistence, browserSessionPersistence],
});

const firestore = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  localCache: isWebKit()
    ? memoryLocalCache()
    : persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
});

const emulatorHost = import.meta.env.VITE_DEV_HOST;
if (emulatorHost) {
  connectAuthEmulator(auth, `http://${emulatorHost}:9099`);
  connectFirestoreEmulator(firestore, emulatorHost, 8080);
  // connectFunctionsEmulator(functions, emulatorHost, 5001);
}

function measureSnapshot<T>(
  name: string,
  fn: (span: { end: () => void }) => T,
  op: string = "firestore.snapshot"
) {
  const span = Sentry.startInactiveSpan({ name, op });

  const timerName = `[${op}] ${name}`;
  console.time(timerName);

  let ended = false;
  return fn({
    end: () => {
      if (!ended) {
        ended = true;
        span.end();
        console.timeEnd(timerName);
      }
    },
  });
}

export { auth, app as firebaseApp, firestore, measureSnapshot };
