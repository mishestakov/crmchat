import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";

import App from "./app";
import { LoadingScreen } from "./components/LoadingScreen";
import "./i18n";

ReactDOM.createRoot(document.querySelector("#root")!).render(
  <React.StrictMode>
    <Suspense fallback={<LoadingScreen />}>
      <App />
    </Suspense>
  </React.StrictMode>
);
