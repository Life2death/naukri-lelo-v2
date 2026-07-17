import { Button, Input } from "@/components";
import { STORAGE_KEYS } from "@/config/constants";
import { safeLocalStorage } from "@/lib";
import { UseSettingsReturn } from "@/types";
import { CheckIcon, SaveIcon, TrashIcon } from "lucide-react";
import { useEffect, useState } from "react";

const DEFAULT_GROQ_STT_MODEL = "whisper-large-v3-turbo";

export const Providers = ({
  selectedSttProvider,
  onSetSelectedSttProvider,
}: UseSettingsReturn) => {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_GROQ_STT_MODEL);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">(
    "idle"
  );
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    if (selectedSttProvider.provider !== "groq") return;

    setApiKey(selectedSttProvider.variables?.api_key || "");
    setModel(
      selectedSttProvider.variables?.model || DEFAULT_GROQ_STT_MODEL
    );
  }, [selectedSttProvider]);

  const hasSavedApiKey = Boolean(
    selectedSttProvider.provider === "groq" &&
      selectedSttProvider.variables?.api_key
  );

  const clearSaveState = () => {
    setSaveState("idle");
    setSaveMessage("");
  };

  const persistSelection = (nextSelection: {
    provider: string;
    variables: Record<string, string>;
  }) => {
    const serializedSelection = JSON.stringify(nextSelection);
    onSetSelectedSttProvider(nextSelection);
    safeLocalStorage.setItem(
      STORAGE_KEYS.SELECTED_STT_PROVIDER,
      serializedSelection
    );
    return (
      safeLocalStorage.getItem(STORAGE_KEYS.SELECTED_STT_PROVIDER) ===
      serializedSelection
    );
  };

  const saveSettings = () => {
    const trimmedApiKey = apiKey.trim();
    const trimmedModel = model.trim();

    if (!trimmedApiKey || !trimmedModel) {
      setSaveState("error");
      setSaveMessage("Enter both the Groq API key and model.");
      return;
    }

    const saved = persistSelection({
      provider: "groq",
      variables: { api_key: trimmedApiKey, model: trimmedModel },
    });

    if (!saved) {
      setSaveState("error");
      setSaveMessage("The settings could not be saved. Please try again.");
      return;
    }

    setSaveState("saved");
    setSaveMessage("Groq STT settings saved.");
  };

  const removeApiKey = () => {
    const removed = persistSelection({
      provider: "groq",
      variables: { ...selectedSttProvider.variables, api_key: "" },
    });

    setApiKey("");

    if (!removed) {
      setSaveState("error");
      setSaveMessage("The API key could not be removed. Please try again.");
      return;
    }

    setSaveState("idle");
    setSaveMessage("Groq API key removed.");
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border border-green-500/30 bg-green-500/5 p-3">
        <p className="text-xs font-semibold text-green-400">
          Recommended: Groq Whisper - ultra-fast transcription, free tier
          available
        </p>
        <ol className="list-inside list-decimal space-y-1 text-xs text-muted-foreground">
          <li>
            Visit{" "}
            <a
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-400 underline underline-offset-2"
            >
              console.groq.com/keys
            </a>{" "}
            and sign up for free (no credit card needed)
          </li>
          <li>
            Click <strong>Create API Key</strong>, copy it
          </li>
          <li>Paste it in the API Key field below</li>
        </ol>
        <p className="text-xs text-muted-foreground">
          Model is pre-filled as{" "}
          <code className="text-green-300">{DEFAULT_GROQ_STT_MODEL}</code> -
          the fastest option on Groq&apos;s free tier.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
        <h3 className="text-sm font-semibold">Groq</h3>

        <div className="space-y-1.5">
          <label htmlFor="groq-stt-api-key" className="text-xs font-medium">
            API Key
          </label>
          <Input
            id="groq-stt-api-key"
            type="password"
            placeholder="gsk_..."
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              clearSaveState();
            }}
            className="h-11"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="groq-stt-model" className="text-xs font-medium">
            Model
          </label>
          <Input
            id="groq-stt-model"
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
              clearSaveState();
            }}
            className="h-11"
          />
        </div>

        <div className="flex min-h-9 items-center justify-between gap-3">
          <p
            role="status"
            className={`text-xs ${
              saveState === "error" ? "text-destructive" : "text-green-500"
            }`}
          >
            {saveMessage}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="destructive"
              onClick={removeApiKey}
              disabled={!hasSavedApiKey}
              title="Remove the saved Groq API key"
            >
              <TrashIcon className="h-4 w-4" />
              Remove
            </Button>
            <Button type="button" onClick={saveSettings}>
              {saveState === "saved" ? (
                <CheckIcon className="h-4 w-4" />
              ) : (
                <SaveIcon className="h-4 w-4" />
              )}
              {saveState === "saved" ? "Saved" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
