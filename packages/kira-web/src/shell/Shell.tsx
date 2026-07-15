import type { ReactNode } from "react";
import Sidebar, { BottomNav } from "./Sidebar.js";
import TopBar from "./TopBar.js";
import { AppDataProvider } from "./AppDataContext.js";

export default function Shell({ children }: { children: ReactNode }) {
  return (
    <AppDataProvider>
      <div className="flex min-h-screen bg-kira-bg">
        <Sidebar />
        <div className="flex-1 min-w-0">
          <TopBar />
          <main className="p-4 md:p-6 pb-20 md:pb-6">{children}</main>
        </div>
        <BottomNav />
      </div>
    </AppDataProvider>
  );
}
