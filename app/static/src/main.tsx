import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "katex/dist/katex.min.css";
import "./styles/global.css";

const host = document.getElementById("root");
if (!host) throw new Error("#root tidak ditemukan");

createRoot(host).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
