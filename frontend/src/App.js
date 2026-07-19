import React from "react";
import "@/App.css";
import { Toaster } from "sonner";
import Workspace from "@/pages/Workspace";
import { useTheme } from "@/lib/useTheme";

function App() {
  const { theme } = useTheme();
  return (
    <div className="App">
      <Workspace />
      <Toaster
        theme={theme}
        richColors
        position="bottom-right"
        toastOptions={{ className: "font-sans" }}
      />
    </div>
  );
}

export default App;
