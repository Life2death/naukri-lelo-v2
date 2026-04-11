import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Header,
  Empty,
} from "@/components";
import {
  CheckCircle2,
  Sparkles,
  BotIcon,
} from "lucide-react";
import { useApp } from "@/contexts";
import { safeLocalStorage } from "@/lib";

interface NaukriLeloPrompt {
  title: string;
  prompt: string;
  modelId: string;
  modelName: string;
}

interface NaukriLeloPromptsResponse {
  prompts: NaukriLeloPrompt[];
  total: number;
  last_updated?: string;
}

interface Model {
  provider: string;
  name: string;
  id: string;
  model: string;
  description: string;
  modality: string;
  isAvailable: boolean;
}

const SELECTED_NAUKRI_LELO_PROMPT_STORAGE_KEY = "selected_naukri_lelo_prompt";

export const NaukriLeloPrompts = () => {
  const {
    setSystemPrompt,
    naukriLeloApiEnabled,
  } = useApp();

  const [prompts, setPrompts] = useState<NaukriLeloPrompt[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const initialCheckDone = useRef(false);

  // Fetch prompts from API
  const fetchPrompts = async () => {
    if (!naukriLeloApiEnabled) return;
    
    setIsLoading(true);
    setError(null);
    try {
      const response = await invoke<NaukriLeloPromptsResponse>("fetch_prompts");
      setPrompts(response.prompts || []);
    } catch (err) {
      console.error("Failed to fetch prompts:", err);
      setError("Failed to load prompts");
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch available models
  const fetchModels = async () => {
    if (!naukriLeloApiEnabled) return;
    
    try {
      const response = await invoke<{ models: Model[] }>("fetch_models");
      setModels(response.models || []);
    } catch (err) {
      console.error("Failed to fetch models:", err);
    }
  };

  // Load saved selection from storage
  const loadSavedSelection = async () => {
    if (!naukriLeloApiEnabled) return;
    
    try {
      const storage = await invoke<{
        selected_model?: string;
      }>("secure_storage_get");

      if (storage.selected_model) {
        const model = JSON.parse(storage.selected_model);
        setSelectedModelId(model.id);
      }
    } catch (error) {
      console.debug("No saved model selection found");
    }
  };

  // Handle prompt selection
  const handleSelectPrompt = async (prompt: NaukriLeloPrompt) => {
    setSelectedPromptId(prompt.modelId + prompt.title);
    setSystemPrompt(prompt.prompt);
    
    // Save to localStorage
    safeLocalStorage.setItem(
      SELECTED_NAUKRI_LELO_PROMPT_STORAGE_KEY,
      JSON.stringify(prompt)
    );
  };

  // Handle model selection
  const handleSelectModel = async (model: Model) => {
    setSelectedModelId(model.id);
    
    try {
      await invoke("secure_storage_save", {
        items: [
          {
            key: "selected_model",
            value: JSON.stringify(model),
          },
        ],
      });
    } catch (error) {
      console.error("Failed to save model selection:", error);
    }
  };

  useEffect(() => {
    if (naukriLeloApiEnabled && !initialCheckDone.current) {
      initialCheckDone.current = true;
      fetchPrompts();
      fetchModels();
      loadSavedSelection();
    }
  }, [naukriLeloApiEnabled]);

  if (!naukriLeloApiEnabled) {
    return (
      <Empty
        icon={BotIcon}
        title="Naukri Lelo API Not Enabled"
        description="Enable Naukri Lelo API in settings to access prompts"
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <Empty
        icon={BotIcon}
        title="Error Loading Prompts"
        description={error}
      />
    );
  }

  if (prompts.length === 0) {
    return (
      <Empty
        icon={BotIcon}
        title="No Prompts Available"
        description="Check back later for new prompts"
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Naukri Lelo Prompts"
        description="Select from available prompts"
      />
      
      {/* Model Selection */}
      {models.length > 0 && (
        <div className="px-4 py-2 border-b">
          <h3 className="text-sm font-medium mb-2">Select Model</h3>
          <div className="flex flex-wrap gap-2">
            {models.map((model) => (
              <button
                key={model.id}
                onClick={() => handleSelectModel(model)}
                className={`px-3 py-1 rounded-full text-xs ${
                  selectedModelId === model.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted hover:bg-muted/80"
                }`}
              >
                {model.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Prompts List */}
      <div className="flex-1 overflow-auto p-4">
        <div className="grid gap-3">
          {prompts.map((prompt, index) => (
            <Card
              key={index}
              className={`cursor-pointer transition-colors ${
                selectedPromptId === prompt.modelId + prompt.title
                  ? "border-primary"
                  : "hover:bg-muted/50"
              }`}
              onClick={() => handleSelectPrompt(prompt)}
            >
              <CardHeader className="p-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <BotIcon className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-sm">{prompt.title}</CardTitle>
                  </div>
                  {selectedPromptId === prompt.modelId + prompt.title && (
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                  )}
                </div>
                <CardDescription className="text-xs line-clamp-2">
                  {prompt.prompt}
                </CardDescription>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Sparkles className="h-3 w-3" />
                  <span>{prompt.modelName}</span>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};
