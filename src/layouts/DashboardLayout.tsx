import { Sidebar } from "@/components";
import { Outlet } from "react-router-dom";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorLayout } from "./ErrorLayout";
import { useExpandedLayout } from "@/contexts";

export const DashboardLayout = () => {
  const { isExpanded } = useExpandedLayout();

  return (
    <ErrorBoundary
      fallbackRender={() => {
        return <ErrorLayout />;
      }}
      resetKeys={["dashboard-error"]}
      onReset={() => {
        console.log("Reset");
      }}
    >
      <div className="relative flex h-screen w-screen overflow-hidden bg-background">
        {/* Draggable region */}
        <div
          className="absolute left-0 right-0 top-0 z-50 h-10 select-none"
          data-tauri-drag-region={true}
        />

        {/* Sidebar — hidden in expanded mode */}
        {!isExpanded && <Sidebar />}

        {/* Main Content */}
        <main
          className={`flex flex-1 flex-col overflow-hidden ${
            isExpanded ? "px-4" : "px-8"
          }`}
        >
          <Outlet />
        </main>
      </div>
    </ErrorBoundary>
  );
};
