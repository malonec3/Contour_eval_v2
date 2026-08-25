import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ContourApp from "../app/components/ContourApp";
import "../app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root element was not found.");

createRoot(root).render(
  <StrictMode>
    <ContourApp />
  </StrictMode>,
);
