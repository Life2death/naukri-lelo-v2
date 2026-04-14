import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Input,
  Textarea,
} from "@/components";
import { useApp } from "@/contexts";
import { extractTextFromFile, fetchAIResponse } from "@/lib";
import { InterviewProfileDocument } from "@/types";
import {
  Loader2,
  PaperclipIcon,
  SparklesIcon,
  Trash2,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useRef, useState } from "react";

export interface ProfileFormData {
  id?: string;
  name: string;
  firstName: string;
  persona: string;
  resumeText: string;
  resumeFileName: string;
  goals: string;
  documents: InterviewProfileDocument[];
}

interface ProfileFormDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  form: ProfileFormData;
  setForm: React.Dispatch<React.SetStateAction<ProfileFormData>>;
  onSave: () => void;
  isEditing?: boolean;
  isSaving?: boolean;
}

export const ProfileFormDialog = ({
  isOpen,
  onOpenChange,
  form,
  setForm,
  onSave,
  isEditing = false,
  isSaving = false,
}: ProfileFormDialogProps) => {
  const { selectedAIProvider, allAiProviders } = useApp();
  const isValid = form.name.trim().length > 0;

  const resumeInputRef = useRef<HTMLInputElement>(null);
  const docsInputRef = useRef<HTMLInputElement>(null);

  const [isExtractingResume, setIsExtractingResume] = useState(false);
  const [isExtractingDoc, setIsExtractingDoc] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [isGeneratingPersona, setIsGeneratingPersona] = useState(false);
  const [personaError, setPersonaError] = useState<string | null>(null);

  const handleResumeFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtractError(null);
    setIsExtractingResume(true);
    try {
      const text = await extractTextFromFile(file);
      setForm((f) => ({ ...f, resumeText: text, resumeFileName: file.name }));
    } catch (err: any) {
      setExtractError(err?.message ?? "Failed to read file");
    } finally {
      setIsExtractingResume(false);
      if (resumeInputRef.current) resumeInputRef.current.value = "";
    }
  };

  const handleRemoveResume = () => {
    setForm((f) => ({ ...f, resumeText: "", resumeFileName: "" }));
  };

  const handleDocFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setExtractError(null);
    setIsExtractingDoc(true);
    try {
      const newDocs: InterviewProfileDocument[] = [];
      for (const file of files) {
        if (form.documents.some((d) => d.name === file.name)) continue;
        const text = await extractTextFromFile(file);
        newDocs.push({ name: file.name, text });
      }
      if (newDocs.length > 0) {
        setForm((f) => ({ ...f, documents: [...f.documents, ...newDocs] }));
      }
    } catch (err: any) {
      setExtractError(err?.message ?? "Failed to read document");
    } finally {
      setIsExtractingDoc(false);
      if (docsInputRef.current) docsInputRef.current.value = "";
    }
  };

  const handleRemoveDoc = (name: string) => {
    setForm((f) => ({ ...f, documents: f.documents.filter((d) => d.name !== name) }));
  };

  /** Generates an interview persona using the user's configured AI provider */
  const handleGeneratePersona = async () => {
    const firstName = form.firstName.trim() || form.name.trim().split(" ")[0];
    if (!firstName) {
      setPersonaError("Enter a first name or profile name first.");
      return;
    }
    if (!form.resumeText.trim()) {
      setPersonaError("Upload a resume first so the AI can personalise the persona.");
      return;
    }

    const provider = allAiProviders.find((p) => p.id === selectedAIProvider.provider);
    if (!provider) {
      setPersonaError(
        "No AI provider configured. Go to API Settings and add your API key first."
      );
      return;
    }

    setIsGeneratingPersona(true);
    setPersonaError(null);
    // Clear current persona so the user sees streaming
    setForm((f) => ({ ...f, persona: "" }));

    const userMessage =
      `Based on the resume below, write a concise first-person interview introduction (150–250 words) for ${firstName}.\n\n` +
      `Requirements:\n` +
      `- Start with "I am ${firstName}..."\n` +
      `- Written entirely in first person as ${firstName}\n` +
      `- Highlight the 2-3 most impressive skills, experiences, and achievements\n` +
      `- Sound natural and conversational, as if speaking in a real interview\n` +
      `- End with a sentence about what kind of role or opportunity they're looking for\n` +
      (form.goals.trim() ? `\nTarget Role:\n${form.goals.trim().substring(0, 500)}\n` : "") +
      `\nResume:\n${form.resumeText.trim().substring(0, 8000)}\n\n` +
      `Write only the persona text. No headings, no commentary.`;

    try {
      let generated = "";
      for await (const chunk of fetchAIResponse({
        provider,
        selectedProvider: selectedAIProvider,
        systemPrompt: undefined,
        history: [],
        userMessage,
        imagesBase64: [],
      })) {
        generated += chunk;
        setForm((f) => ({ ...f, persona: generated }));
      }
    } catch (err: any) {
      setPersonaError(err?.message ?? "Failed to generate persona. Try again.");
    } finally {
      setIsGeneratingPersona(false);
    }
  };

  // Can we show the Generate Persona button?
  const canGeneratePersona =
    (form.firstName.trim() || form.name.trim()) && form.resumeText.trim();

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="mt-4 px-6 shrink-0">
          <DialogTitle>
            {isEditing ? "Edit Profile" : "Create Interview Profile"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update your profile details and persona."
              : "Add your name, resume and goals to create a personalised interview persona."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 px-6 overflow-y-auto flex-1">
          {/* Profile Name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Profile Name</label>
            <Input
              placeholder="e.g., Senior React Engineer at Stripe"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              disabled={isSaving}
              className="h-11"
            />
          </div>

          {/* First Name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Your First Name{" "}
              <span className="text-muted-foreground font-normal text-xs">
                (used in the interview persona)
              </span>
            </label>
            <Input
              placeholder="e.g., Vikram"
              value={form.firstName}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
              disabled={isSaving}
              className="h-11"
            />
          </div>

          {/* Goals / Job Description */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Goals / Job Description</label>
            <Textarea
              placeholder="Paste the job description, or describe the role you're targeting..."
              className="min-h-[100px] resize-none"
              value={form.goals}
              onChange={(e) => setForm((f) => ({ ...f, goals: e.target.value }))}
              disabled={isSaving}
            />
          </div>

          {/* Resume Upload */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Resume{" "}
              <span className="text-muted-foreground font-normal text-xs">
                (PDF or Word)
              </span>
            </label>

            {form.resumeFileName ? (
              <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                <PaperclipIcon className="size-4 text-primary shrink-0" />
                <span className="text-sm flex-1 truncate text-primary font-medium">
                  {form.resumeFileName}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {form.resumeText.length.toLocaleString()} chars
                </span>
                <button
                  onClick={handleRemoveResume}
                  disabled={isSaving}
                  className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                  title="Remove resume"
                >
                  <XIcon className="size-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={isSaving || isExtractingResume}
                onClick={() => resumeInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input hover:border-primary/40 hover:bg-accent/50 transition-colors py-6 text-sm text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isExtractingResume ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Reading file...
                  </>
                ) : (
                  <>
                    <UploadIcon className="size-4" />
                    Click to upload resume (.pdf, .doc, .docx)
                  </>
                )}
              </button>
            )}

            <input
              ref={resumeInputRef}
              type="file"
              accept=".pdf,.doc,.docx"
              className="hidden"
              onChange={handleResumeFileChange}
            />
          </div>

          {/* Generate Persona Section */}
          <div className="space-y-2 rounded-lg border border-dashed border-primary/30 bg-primary/3 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Interview Persona</p>
                <p className="text-xs text-muted-foreground">
                  AI generates a first-person introduction used as your identity during interviews.
                  {!canGeneratePersona && " Upload a resume to enable."}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canGeneratePersona || isGeneratingPersona || isSaving}
                onClick={handleGeneratePersona}
                className="shrink-0 gap-1.5"
                title="Generate persona from resume using AI"
              >
                {isGeneratingPersona ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <SparklesIcon className="size-3.5" />
                    {form.persona ? "Regenerate" : "Generate Persona"}
                  </>
                )}
              </Button>
            </div>

            {personaError && (
              <p className="text-xs text-destructive">{personaError}</p>
            )}

            <Textarea
              placeholder={
                canGeneratePersona
                  ? 'Click "Generate Persona" to create your interview introduction, or write it manually...'
                  : "Upload your resume first, then generate or write your persona here..."
              }
              className="min-h-[120px] resize-none text-xs"
              value={form.persona}
              onChange={(e) => setForm((f) => ({ ...f, persona: e.target.value }))}
              disabled={isSaving || isGeneratingPersona}
            />

            {form.persona && (
              <p className="text-[10px] text-muted-foreground/60">
                You can edit this text directly. It will be used as your identity in AI-assisted interview sessions.
              </p>
            )}
          </div>

          {/* Custom Documents */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Custom Documents{" "}
              <span className="text-muted-foreground font-normal text-xs">
                (Q&amp;A prep, certifications — used as AI memory)
              </span>
            </label>

            {form.documents.length > 0 && (
              <div className="space-y-1.5">
                {form.documents.map((doc) => (
                  <div
                    key={doc.name}
                    className="flex items-center gap-2 rounded-lg border px-3 py-2 bg-muted/30"
                  >
                    <PaperclipIcon className="size-4 text-muted-foreground shrink-0" />
                    <span className="text-sm flex-1 truncate">{doc.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {doc.text.length.toLocaleString()} chars
                    </span>
                    <button
                      onClick={() => handleRemoveDoc(doc.name)}
                      disabled={isSaving}
                      className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                      title="Remove document"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              disabled={isSaving || isExtractingDoc}
              onClick={() => docsInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-input hover:border-primary/40 hover:bg-accent/50 transition-colors py-3 text-sm text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExtractingDoc ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Reading document...
                </>
              ) : (
                <>
                  <UploadIcon className="size-4" />
                  Add document (.pdf, .doc, .docx)
                </>
              )}
            </button>

            <input
              ref={docsInputRef}
              type="file"
              accept=".pdf,.doc,.docx"
              multiple
              className="hidden"
              onChange={handleDocFilesChange}
            />

            {extractError && (
              <p className="text-xs text-destructive">{extractError}</p>
            )}
          </div>
        </div>

        <DialogFooter className="px-6 pb-6 shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={onSave} disabled={!isValid || isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {isEditing ? "Updating..." : "Creating..."}
              </>
            ) : isEditing ? (
              "Update"
            ) : (
              "Create Profile"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
