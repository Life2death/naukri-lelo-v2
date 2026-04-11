// Naukri Lelo: License system removed. Use BYOK (your own API keys) via the
// Providers page, or configure a custom AI/STT provider in the Dev settings.
import { Header } from "@/components";

export const PluelyApiSetup = () => {
  return (
    <div id="api-setup" className="space-y-3 -mt-2 pt-2">
      <Header
        title="Bring Your Own Key (BYOK)"
        description="Naukri Lelo is 100% free and open-source. Configure your own AI and STT providers using the Providers page. Supports OpenAI, Anthropic, Gemini, Groq, Ollama and any OpenAI-compatible endpoint."
      />
      <div className="p-3 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
        <p className="text-sm text-green-700 dark:text-green-400">
          All features are unlocked — no license, no subscription, no paywalls. Ever.
        </p>
      </div>
    </div>
  );
};
