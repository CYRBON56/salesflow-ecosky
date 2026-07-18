import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import MobileSummary from "./MobileSummary.jsx";

const isMobileView = window.location.pathname.replace(/\/+$/, "") === "/mobile";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isMobileView ? <MobileSummary /> : <App />}
  </React.StrictMode>
);
