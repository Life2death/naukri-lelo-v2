import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  Textarea,
} from "@/components";
import { SparklesIcon } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/contexts";
import { fetchAIResponse } from "@/lib";

interface GenerateSystemPromptProps {
  onGenerate: (prompt: string, promptName: string) => void;
}

export const GenerateSystemPrompt = ({
  onGenerate,
}: GenerateSystemPromptProps) => {
  const { selectedAIProvider, allAiProviders } = useApp();
  const [userPrompt, setUserPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const handleGenerate = async () => {
    if (!userPrompt.trim()) {
      setError("Please describe what you want");
      return;
    }

    const provider = allAiProviders.find((p) => p.id === selectedAIProvider.provider);
    if (!provider) {
      setError(
        "No AI provider configured. Go to API Settings and add your API key first."
      );
      return;
    }

    try {
      setIsGenerating(true);
      setError(null);

      // Ask the AI to write only the system prompt text
      const instruction =
        `Write a detailed, effective system prompt for an AI assistant based on this description:\n\n` +
        `"${userPrompt.trim()}"\n\n` +
        `Output ONLY the system prompt text — no headings, no explanation, no commentary. ` +
        `The prompt should be clear, specific, and ready to use as-is.`;

      let generatedPrompt = "";
      for await (const chunk of fetchAIResponse({
        provider,
        selectedProvider: selectedAIProvider,
        systemPrompt: undefined,
        history: [],
        userMessage: instruction,
        imagesBase64: [],
      })) {
        generatedPrompt += chunk;
      }

      const finalPrompt = generatedPrompt.trim();
      if (!finalPrompt) {
        setError("AI returned an empty response. Try again.");
        return;
      }

      // Derive a short name from the user's description (first 50 chars, sentence-cased)
      const rawName = userPrompt.trim().substring(0, 50);
      const promptName =
        rawName.charAt(0).toUpperCase() + rawName.slice(1) + (rawName.length < userPrompt.trim().length ? "..." : "");

      onGenerate(finalPrompt, promptName);
      setIsOpen(false);
      setUserPrompt("");
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to generate prompt";
      setError(errorMessage);
      console.error("Error generating system prompt:", err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          aria-label="Generate with AI"
          size="sm"
          variant="outline"
          className="w-fit"
        >
          <SparklesIcon className="h-4 w-4" /> Generate with AI
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        className="w-96 p-4 border shadow-lg"
      >
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium mb-1">Generate a system prompt</p>
            <p className="text-xs text-muted-foreground">
              Describe the AI behaviour you want and we'll generate a system
              prompt using your configured AI provider.
            </p>
          </div>

          <Textarea
            placeholder="e.g., I want an AI that helps me with code reviews and focuses on best practices..."
            className="min-h-[100px] resize-none border-1 border-input/50 focus:border-primary/50 transition-colors"
            value={userPrompt}
            onChange={(e) => {
              setUserPrompt(e.target.value);
              setError(null);
            }}
            disabled={isGenerating}
          />

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button
            className="w-full"
            onClick={handleGenerate}
            disabled={!userPrompt.trim() || isGenerating}
          >
            {isGenerating ? (
              <>
                <SparklesIcon className="h-4 w-4 animate-pulse" />
                Generating...
              </>
            ) : (
              <>
                <SparklesIcon className="h-4 w-4" />
                Generate
              </>
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
