import { PluelyApiSetup } from "./components";
import { PageLayout } from "@/layouts";

const Dashboard = () => {
  return (
    <PageLayout
      title="Dashboard"
      description="Naukri Lelo — free, open-source AI interview assistant. Configure your BYOK API keys to get started."
    >
      <PluelyApiSetup />
    </PageLayout>
  );
};

export default Dashboard;
