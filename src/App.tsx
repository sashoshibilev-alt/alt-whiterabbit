import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexProvider } from "convex/react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { convex } from "@/lib/convex";
import { ThemeProvider } from "@/hooks/use-theme";
import Notes from "./pages/Notes";
import AddNote from "./pages/AddNote";
import NoteDetail from "./pages/NoteDetail";
import V0Initiatives from "./pages/V0Initiatives";
import InitiativeDetail from "./pages/InitiativeDetail";
import InternalReport from "./pages/InternalReport";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <ThemeProvider>
  <ConvexProvider client={convex}>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Layout>
            <Routes>
              {/* Redirect root to notes */}
              <Route path="/" element={<Navigate to="/notes" replace />} />
              
              {/* Notes routes */}
              <Route path="/notes" element={<Notes />} />
              <Route path="/notes/new" element={<AddNote />} />
              <Route path="/notes/:id" element={<NoteDetail />} />
              
              {/* Initiatives routes */}
              <Route path="/initiatives" element={<V0Initiatives />} />
              <Route path="/initiatives/:id" element={<InitiativeDetail />} />
              
              {/* Internal report */}
              <Route path="/report" element={<InternalReport />} />
              
              {/* Settings */}
              <Route path="/settings" element={<Settings />} />
              
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Layout>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ConvexProvider>
  </ThemeProvider>
);

export default App;
