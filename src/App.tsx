import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/layout/app-shell";
import { OnboardingGate } from "@/components/onboarding/onboarding-gate";
import { CommandPalette } from "@/components/command-palette/command-palette";
import { SearchPage } from "@/routes/search";
import { ResultsPage } from "@/routes/results";
import { PipelinePage } from "@/routes/pipeline";
import { CompliancePage } from "@/routes/compliance";
import { SettingsPage } from "@/routes/settings";
import { AboutPage } from "@/routes/about";

function App() {
  return (
    <HashRouter>
      <OnboardingGate>
        <AppShell>
          <Routes>
            <Route path="/" element={<Navigate to="/search" replace />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/results" element={<ResultsPage />} />
            <Route path="/pipeline" element={<PipelinePage />} />
            <Route path="/compliance" element={<CompliancePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/about" element={<AboutPage />} />
          </Routes>
        </AppShell>
        <CommandPalette />
      </OnboardingGate>
      <Toaster />
    </HashRouter>
  );
}

export default App;
