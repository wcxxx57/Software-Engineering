import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import { applyDesignTokens } from "./designTokens.js";
import "./styles.css";

applyDesignTokens();
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
