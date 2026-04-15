import { AIProviders, STTProviders, JobDiscoveryConfig } from "./components";
import Contribute from "@/components/Contribute";
import { useSettings } from "@/hooks";
import { PageLayout } from "@/layouts";

const DevSpace = () => {
  const settings = useSettings();

  return (
    <PageLayout title="Dev Space" description="Manage your dev space">
      <Contribute />
      {/* Provider Selection */}
      <AIProviders {...settings} />

      {/* STT Providers */}
      <STTProviders {...settings} />

      {/* Job Discovery */}
      <JobDiscoveryConfig />
    </PageLayout>
  );
};

export default DevSpace;
