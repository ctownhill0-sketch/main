import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/layout/app-shell";
import { SearchPage } from "@/routes/search";
import { ResultsPage } from "@/routes/results";
import { PipelinePage } from "@/routes/pipeline";
import { CompliancePage } from "@/routes/compliance";
import { SettingsPage } from "@/routes/settings";

function App() {
  return (
    <HashRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/search" replace />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/compliance" element={<CompliancePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </AppShell>
      <Toaster />
    </HashRouter>
  );
}

export default App;
