import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { deleteSnippetFiles } from "./lib/cleanupSnippets";

// Make cleanup function available in console for one-time cleanup
if (typeof window !== 'undefined') {
  (window as any).cleanupSchematicSnippets = deleteSnippetFiles;
}

createRoot(document.getElementById("root")!).render(<App />);
